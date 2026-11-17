// One-click Cloudflare setup for Traffic: with a Cloudflare API token the site owner just created (from a link that
// pre-fills its permissions), MetaInfo uploads the collector worker to their account, with the three secrets
// already set, and puts it on the site's routes. The API token is used for this request only: never stored, never
// logged, never sent anywhere but api.cloudflare.com.

import { COLLECTOR_VERSION, COLLECTOR_WORKER_JS } from "./collector-bundle";

export { cloudflareTokenUrl } from "@/lib/traffic";

const API = "https://api.cloudflare.com/client/v4";
const COMPATIBILITY_DATE = "2025-10-01";

export class CloudflareError extends Error {
  constructor(
    message: string,
    public status = 400,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

async function cf<T>(token: string, method: string, path: string, body?: BodyInit | object): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body && !isForm ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CloudflareError("Couldn't reach Cloudflare. Try again in a moment.", 502);
  }
  const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
  if (!res.ok || !json?.success) {
    const err = json?.errors?.[0];
    if (res.status === 401 || err?.code === 10000 || err?.code === 9109 || err?.code === 1000) {
      throw new CloudflareError(`Cloudflare refused the token for ${method} ${path.split("?")[0]}: ${err?.message ?? "not authorised"}. Create it with the button, which sets the right permissions.`, 400);
    }
    throw new CloudflareError(`Cloudflare: ${err?.message ?? `HTTP ${res.status}`}`, res.status >= 500 ? 502 : 400);
  }
  return json.result;
}

interface Zone {
  id: string;
  name: string;
  account: { id: string; name: string };
}

/** The zone that serves `domain`: the domain itself or the nearest parent the account has. */
async function zoneFor(token: string, domain: string): Promise<Zone> {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join(".");
    const zones = await cf<Zone[]>(token, "GET", `/zones?name=${encodeURIComponent(name)}&status=active`);
    if (zones[0]) return zones[0];
  }
  throw new CloudflareError(
    `${domain} isn't an active zone in the Cloudflare account this token can see. Its DNS has to be on Cloudflare (orange cloud), and the token needs access to that zone.`,
    404,
  );
}

/** One worker per site, so each keeps its own secrets. */
export const workerName = (domain: string) => `metainfo-${domain.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`.slice(0, 63).replace(/-+$/, "");

interface WorkerRoute {
  id: string;
  pattern: string;
  script?: string;
}

export interface DeployPlan {
  account: string;
  zone: string;
  worker: string;
  patterns: string[];
  /** Routes already taken by another worker: a route runs one worker, so these need a decision. */
  conflicts: { pattern: string; script: string }[];
}

export type FullPlan = DeployPlan & { zoneId: string; accountId: string; existing: WorkerRoute[] };

/** Checks the token and works out what would change, without changing anything. */
export async function planDeploy(token: string, domain: string): Promise<FullPlan> {
  if (!/^[\w-]{20,200}$/.test(token)) throw new CloudflareError("That doesn't look like a Cloudflare API token.");
  const zone = await zoneFor(token, domain);
  const worker = workerName(domain);
  const patterns = [`${domain}/*`, ...(zone.name === domain ? [`www.${domain}/*`] : [])];
  const existing = await cf<WorkerRoute[]>(token, "GET", `/zones/${zone.id}/workers/routes`);
  const conflicts = patterns.flatMap((pattern) => {
    const r = existing.find((x) => x.pattern === pattern);
    return r && r.script && r.script !== worker ? [{ pattern, script: r.script }] : [];
  });
  return { account: zone.account.name, accountId: zone.account.id, zone: zone.name, zoneId: zone.id, worker, patterns, conflicts, existing };
}

export interface DeployResult extends DeployPlan {
  version: string;
  routes: { pattern: string; action: "created" | "kept" | "replaced" }[];
}

/**
 * Uploads the collector worker with its three secrets and puts it on the site's routes. The caller checks
 * `plan.conflicts` first: routes held by another worker are taken over only after the person agreed.
 */
export async function deployCollector(opts: { token: string; plan: FullPlan; secrets: { token: string; org: string; site: string; endpoint?: string } }): Promise<DeployResult> {
  const { plan } = opts;

  const bindings = [
    { type: "secret_text", name: "METAINFO_TOKEN", text: opts.secrets.token },
    { type: "secret_text", name: "METAINFO_ORG", text: opts.secrets.org },
    { type: "secret_text", name: "METAINFO_SITE", text: opts.secrets.site },
    ...(opts.secrets.endpoint ? [{ type: "plain_text", name: "METAINFO_ENDPOINT", text: opts.secrets.endpoint }] : []),
  ];
  const form = new FormData();
  form.set(
    "metadata",
    new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: COMPATIBILITY_DATE, bindings, observability: { enabled: true }, tags: ["metainfo-collector", `v-${COLLECTOR_VERSION}`] })], {
      type: "application/json",
    }),
  );
  form.set("worker.js", new Blob([COLLECTOR_WORKER_JS], { type: "application/javascript+module" }), "worker.js");
  await cf(opts.token, "PUT", `/accounts/${plan.accountId}/workers/scripts/${plan.worker}`, form);
  // Only reachable through the site's routes, not on workers.dev. Best effort: older accounts may not support it.
  await cf(opts.token, "POST", `/accounts/${plan.accountId}/workers/scripts/${plan.worker}/subdomain`, { enabled: false, previews_enabled: false }).catch(() => undefined);

  const routes: DeployResult["routes"] = [];
  for (const pattern of plan.patterns) {
    const current = plan.existing.find((x) => x.pattern === pattern);
    if (current?.script === plan.worker) {
      routes.push({ pattern, action: "kept" });
    } else if (current) {
      await cf(opts.token, "PUT", `/zones/${plan.zoneId}/workers/routes/${current.id}`, { pattern, script: plan.worker });
      routes.push({ pattern, action: "replaced" });
    } else {
      await cf(opts.token, "POST", `/zones/${plan.zoneId}/workers/routes`, { pattern, script: plan.worker });
      routes.push({ pattern, action: "created" });
    }
  }
  return { ...publicPlan(plan), version: COLLECTOR_VERSION, routes };
}

export const publicPlan = (p: DeployPlan): DeployPlan => ({ account: p.account, zone: p.zone, worker: p.worker, patterns: p.patterns, conflicts: p.conflicts });
