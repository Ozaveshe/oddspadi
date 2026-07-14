#!/usr/bin/env node
/**
 * Production health sweep. Safe to run any time; read-only.
 *
 *   node scripts/site-health.mjs [--site https://oddspadi.com]
 *
 * Env (optional): ODDSPADI_ADMIN_TOKEN — unlocks the provider/env section of /api/health.
 * Exit code 0 = healthy, 1 = at least one check failed.
 */
const site = (process.argv.includes("--site") ? process.argv[process.argv.indexOf("--site") + 1] : null) ?? process.env.ODDSPADI_SITE_URL ?? "https://oddspadi.com";
const adminToken = process.env.ODDSPADI_ADMIN_TOKEN?.trim();
let failures = 0;

function report(ok, label, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function timedFetch(path, options = {}) {
  const started = Date.now();
  const response = await fetch(`${site}${path}`, { signal: AbortSignal.timeout(30_000), ...options });
  return { response, ms: Date.now() - started };
}

async function checkPage(path, { maxMs = 4000, maxBytes = 1_500_000 } = {}) {
  try {
    const { response, ms } = await timedFetch(path);
    const bytes = (await response.arrayBuffer()).byteLength;
    report(response.ok && ms <= maxMs && bytes <= maxBytes, `page ${path}`, `${response.status}, ${ms}ms, ${(bytes / 1024).toFixed(0)}KB`);
  } catch (error) {
    report(false, `page ${path}`, String(error));
  }
}

async function checkJson(path, validate, label = path, options = {}) {
  try {
    const { response, ms } = await timedFetch(path, options);
    const payload = await response.json();
    const problem = validate(payload, response);
    report(!problem, label, problem || `${response.status}, ${ms}ms`);
    return payload;
  } catch (error) {
    report(false, label, String(error));
    return null;
  }
}

console.log(`OddsPadi health sweep against ${site}\n`);

await checkPage("/", { maxMs: 6000 });
await checkPage("/predictions", { maxMs: 6000 });
await checkPage("/news");
await checkPage("/community");

await checkJson(
  "/api/health",
  (payload) => {
    if (payload?.status !== "ok") return "status not ok";
    if (!payload?.liveDataReady) {
      const provider = payload?.readiness?.provider ?? "unknown";
      const storage = payload?.readiness?.storage ?? "unknown";
      return `live data configuration incomplete: provider=${provider}, storage=${storage}`;
    }
    return null;
  },
  "api /api/health"
);
if (adminToken) {
  await checkJson(
    "/api/health",
    (payload) => {
      const providers = payload?.providers ?? {};
      const missing = Object.entries(providers).filter(([, ready]) => !ready).map(([name]) => name);
      return missing.length ? `providers not ready: ${missing.join(", ")}` : null;
    },
    "api /api/health (admin)",
    { headers: { authorization: `Bearer ${adminToken}` } }
  );
}

await checkJson("/api/live", (payload) => (Array.isArray(payload?.fixtures) ? null : "no fixtures array"), "api /api/live");
for (const sport of ["football", "basketball", "tennis"]) {
  await checkJson(
    `/api/sports/predictions?sport=${sport}&view=summary`,
    (payload) => (payload?.success && Array.isArray(payload.data) ? null : "bad payload"),
    `api predictions ${sport}`
  );
}
await checkJson("/api/community/posts", (payload) => {
  if (!Array.isArray(payload?.posts)) return "no posts array";
  if (payload.note) return `feed note: ${payload.note}`;
  if (!payload.posts.length) return "feed is empty";
  return null;
}, "api community feed");

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
