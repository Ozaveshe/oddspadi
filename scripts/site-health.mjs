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

function tipsFixtures(payload) {
  return Array.isArray(payload?.data?.slate?.fixtures) ? payload.data.slate.fixtures : [];
}

function tipsFreshnessProblem(payload) {
  if (!payload?.success || !payload?.data?.slate) return "bad tips payload";
  const providerStatus = payload.data.slate.provider?.status;
  if (!["completed", "empty"].includes(providerStatus)) return `provider status is ${providerStatus ?? "missing"}`;
  const now = Date.now();
  const stale = tipsFixtures(payload).filter((row) => {
    const syncedAt = Date.parse(row?.fixture?.lastSyncedAt ?? "");
    return !Number.isFinite(syncedAt) || now - syncedAt > 6 * 60 * 60_000;
  });
  if (stale.length) return `${stale.length} fixture(s) exceed the six-hour freshness boundary`;
  const impossibleLive = tipsFixtures(payload).filter((row) => {
    const fixture = row?.fixture;
    const kickoff = Date.parse(fixture?.kickoffAt ?? "");
    return fixture?.status === "live" && Number.isFinite(kickoff) && kickoff > now + 15 * 60_000;
  });
  return impossibleLive.length ? `${impossibleLive.length} future fixture(s) are incorrectly marked live` : null;
}

async function checkLatestRun(path, maxAgeMs, label) {
  return checkJson(path, (payload) => {
    const run = payload?.data;
    if (!run) return "no stored run receipt";
    if (!["completed", "partial", "empty"].includes(run.status)) return `latest status is ${run.status ?? "missing"}`;
    const finishedAt = Date.parse(run.finishedAt ?? "");
    if (!Number.isFinite(finishedAt)) return "latest run has no valid completion time";
    const ageMs = Date.now() - finishedAt;
    return ageMs > maxAgeMs ? `latest completion is ${(ageMs / 3_600_000).toFixed(1)}h old` : null;
  }, label);
}

async function checkFixtureAnalysisLinks(payload, label) {
  const fixtureIds = [...new Set(tipsFixtures(payload).map((row) => row?.fixture?.fixtureId).filter(Boolean))];
  const failures = [];
  for (let index = 0; index < fixtureIds.length; index += 4) {
    const batch = fixtureIds.slice(index, index + 4);
    const results = await Promise.all(batch.map(async (fixtureId) => {
      try {
        const response = await fetch(`${site}/predictions/${encodeURIComponent(fixtureId)}`, { signal: AbortSignal.timeout(30_000) });
        const text = await response.text();
        return response.ok && !text.includes("That page has left the pitch") ? null : `${fixtureId} (${response.status})`;
      } catch (error) {
        return `${fixtureId} (${String(error)})`;
      }
    }));
    failures.push(...results.filter(Boolean));
  }
  report(!failures.length, label, failures.length ? failures.slice(0, 5).join(", ") : `${fixtureIds.length} checked`);
}

console.log(`OddsPadi health sweep against ${site}\n`);

await checkPage("/", { maxMs: 6000 });
await checkPage("/predictions", { maxMs: 6000 });
await checkPage("/predictions/history", { maxMs: 6000 });
await checkPage("/news");
await checkPage("/community");

const todayTips = await checkJson("/api/tips/today", tipsFreshnessProblem, "api today's tips freshness");
await checkJson("/api/tips/tomorrow", tipsFreshnessProblem, "api tomorrow's tips freshness");
const weeklyTips = await checkJson("/api/tips/week", (payload) => {
  const problem = tipsFreshnessProblem(payload);
  if (problem) return problem;
  if (payload?.data?.days?.length !== 7) return "weekly product does not contain seven days";
  return tipsFixtures(payload).length ? null : "weekly product has no provider-backed fixtures";
}, "api weekly tips freshness");
if (todayTips) await checkFixtureAnalysisLinks(todayTips, "analysis links from today's tips");
if (weeklyTips) await checkFixtureAnalysisLinks(weeklyTips, "analysis links from weekly radar");

await checkLatestRun("/api/cron/import-fixtures", 26 * 60 * 60_000, "scheduled fixture import receipt");
await checkLatestRun("/api/cron/refresh-odds", 4 * 60 * 60_000, "scheduled odds refresh receipt");
await checkLatestRun("/api/cron/run-daily-engine", 26 * 60 * 60_000, "scheduled daily engine receipt");
await checkLatestRun("/api/cron/generate-weekly-predictions", 26 * 60 * 60_000, "scheduled weekly engine receipt");

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
