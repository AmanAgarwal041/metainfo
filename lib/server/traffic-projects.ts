import { AuthError } from "@/lib/server/auth/accounts";
import type { Signed } from "@/lib/server/auth/session";
import { bareDomain } from "@/lib/research-types";

/** The project as the workspace has it (the synced copy, so the domain can't be made up). */
export async function projectOf(s: Signed, projectId: unknown): Promise<{ id: string; domain: string }> {
  if (typeof projectId !== "string" || !/^[\w-]{1,64}$/.test(projectId)) throw new AuthError("Pick a project first.");
  const row = await s.db.prepare("SELECT value FROM workspace WHERE org_id = ? AND key = 'metainfo:projects:v2'").bind(s.orgId).first<{ value: string }>();
  let projects: { id?: string; domain?: string }[] = [];
  try {
    projects = (JSON.parse(row?.value ?? "null") as { projects?: typeof projects } | null)?.projects ?? [];
  } catch {
    /* unreadable: treated as missing */
  }
  const p = projects.find((x) => x.id === projectId);
  if (!p) throw new AuthError("This project hasn't been saved to your workspace yet. Wait a moment and try again.", 409);
  const domain = bareDomain(p.domain ?? "");
  if (!domain) throw new AuthError("Give this project a domain first (Settings → Projects).");
  return { id: projectId, domain };
}

