import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BATCH, PROBE_HEADER, createCollector, isPageLoad, toEvent } from "../src/core.ts";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const page = (path = "/pricing", headers: Record<string, string> = {}, method = "GET") =>
  new Request(`https://example.com${path}`, { method, headers: { "user-agent": CHROME, "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", ...headers } });

const IDS = { org: "org_1", site: "https://example.com" };

function fakeMetainfo(status = 202) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    events: () => calls.flatMap((c) => String(c.init.body).split("\n").map((l) => JSON.parse(l))),
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status });
    },
  };
}

function waiter() {
  const promises: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void promises.push(p), settle: () => Promise.all(promises) };
}

test("page loads are reported; assets, sub-requests, prefetches, APIs and probes aren't", () => {
  assert.equal(isPageLoad(page()), true);
  assert.equal(isPageLoad(page("/robots.txt", { "user-agent": "GPTBot/1.1", "sec-fetch-dest": "" })), true);
  assert.equal(isPageLoad(new Request("https://example.com/", { headers: { "user-agent": "ClaudeBot/1.0" } })), true);
  assert.equal(isPageLoad(page("/app.js")), false);
  assert.equal(isPageLoad(page("/_next/static/chunk")), false);
  assert.equal(isPageLoad(page("/", { "sec-fetch-dest": "image" })), false);
  assert.equal(isPageLoad(page("/", { "sec-fetch-dest": "empty" })), false);
  assert.equal(isPageLoad(page("/", { "sec-purpose": "prefetch;prerender" })), false);
  assert.equal(isPageLoad(page("/", { rsc: "1" })), false);
  assert.equal(isPageLoad(page("/api/x", { accept: "application/json" })), false);
  assert.equal(isPageLoad(page("/", { [PROBE_HEADER]: "1" })), false);
  assert.equal(isPageLoad(page("/", {}, "POST")), false);
});

test("an event keeps only what it should", () => {
  const req = page("/pricing?utm_source=chatgpt.com&email=a@b.c", {
    referer: "https://chatgpt.com/c/123?secret=1",
    cookie: "session=1",
    "cf-connecting-ip": "203.0.113.9",
    "signature-agent": '"https://chatgpt.com"',
  });
  const e = toEvent(req, 200, 1000);
  assert.deepEqual(e, {
    v: 1,
    ts: 1000,
    method: "GET",
    host: "example.com",
    path: "/pricing",
    status: 200,
    ua: CHROME,
    referer: "https://chatgpt.com/c/123",
    utm: "chatgpt.com",
    fetchMode: "navigate",
    signatureAgent: '"https://chatgpt.com"',
  });
  assert.ok(!JSON.stringify(e).includes("203.0.113.9"));
  assert.ok(!JSON.stringify(e).includes("session"));
});

test("without batching each page load is sent at once, with the token", async () => {
  const m = fakeMetainfo();
  const c = createCollector({ ...IDS, token: "mtr_x", via: "next", fetch: m.fetch, endpoint: "https://m.test/api/traffic/events" });
  const w = waiter();
  c.observe(page("/a"), 0, w.waitUntil);
  c.observe(page("/a.css"), 200, w.waitUntil);
  await w.settle();
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].url, "https://m.test/api/traffic/events");
  const headers = m.calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer mtr_x");
  assert.equal(headers["x-metainfo-collector"], "next");
  assert.equal(headers["x-metainfo-org"], "org_1");
  assert.equal(headers["x-metainfo-site"], "https://example.com");
  assert.equal(m.events()[0].path, "/a");
});

test("batching waits, then sends everything in one request", async () => {
  const m = fakeMetainfo();
  let wake = () => {};
  const c = createCollector({ ...IDS, token: "mtr_x", via: "w", batch: true, fetch: m.fetch, sleep: () => new Promise<void>((r) => (wake = r)) });
  const w = waiter();
  for (let i = 0; i < 3; i++) c.observe(page(`/p${i}`), 200, w.waitUntil);
  assert.equal(m.calls.length, 0);
  assert.equal(c.pending, 3);
  wake();
  await w.settle();
  assert.equal(m.calls.length, 1);
  assert.deepEqual(m.events().map((e) => e.path), ["/p0", "/p1", "/p2"]);
});

test("a full batch is sent without waiting", async () => {
  const m = fakeMetainfo();
  const c = createCollector({ ...IDS, token: "mtr_x", via: "w", batch: true, fetch: m.fetch, sleep: () => new Promise<void>(() => {}) });
  const w = waiter();
  for (let i = 0; i < MAX_BATCH; i++) c.observe(page(`/p${i}`), 200, w.waitUntil);
  await Promise.race([w.settle(), new Promise((r) => setTimeout(r, 50))]);
  assert.equal(m.calls.length, 1);
  assert.equal(c.pending, 0);
});

test("a batch MetaInfo can't take is kept for the next one; a refused one isn't", async () => {
  const busy = fakeMetainfo(503);
  const c = createCollector({ ...IDS, token: "mtr_x", via: "w", batch: true, fetch: busy.fetch, sleep: async () => {} });
  const w = waiter();
  c.observe(page("/a"), 200, w.waitUntil);
  await w.settle();
  assert.equal(c.pending, 1);

  const refused = fakeMetainfo(401);
  const c2 = createCollector({ ...IDS, token: "mtr_x", via: "w", batch: true, fetch: refused.fetch, sleep: async () => {} });
  c2.observe(page("/a"), 200, w.waitUntil);
  await w.settle();
  assert.equal(c2.pending, 0);
});

test("never throws, even when sending does", async () => {
  const c = createCollector({ ...IDS, token: "mtr_x", via: "w", fetch: async () => { throw new Error("down"); } });
  const w = waiter();
  assert.doesNotThrow(() => c.observe(page(), 200, w.waitUntil));
  await w.settle();
});

test("no token, nothing reported", async () => {
  const m = fakeMetainfo();
  const c = createCollector({ ...IDS, token: undefined, via: "w", fetch: m.fetch });
  const w = waiter();
  c.observe(page(), 200, w.waitUntil);
  await w.settle();
  assert.equal(m.calls.length, 0);
});

test("nothing is reported without the token, the workspace id and the site", async () => {
  const m = fakeMetainfo();
  const w = waiter();
  for (const missing of ["token", "org", "site"] as const) {
    const c = createCollector({ token: "mtr_x", ...IDS, [missing]: undefined, via: "w", fetch: m.fetch });
    c.observe(page(), 200, w.waitUntil);
  }
  await w.settle();
  assert.equal(m.calls.length, 0);
});

test("only the configured site's hosts are reported", async () => {
  const m = fakeMetainfo();
  const c = createCollector({ ...IDS, site: "example.com", token: "mtr_x", via: "w", fetch: m.fetch });
  const w = waiter();
  const at = (host: string) => new Request(`https://${host}/`, { headers: { "user-agent": "GPTBot/1.1" } });
  for (const host of ["example.com", "www.example.com", "docs.example.com", "my-site.pages.dev", "example.com.evil.net"]) c.observe(at(host), 200, w.waitUntil);
  await w.settle();
  assert.deepEqual(m.events().map((e) => e.host), ["example.com", "www.example.com", "docs.example.com"]);
});
