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
    const body = await response.text();
    const bytes = Buffer.byteLength(body);
    report(response.ok && ms <= maxMs && bytes <= maxBytes, `page ${path}`, `${response.status}, ${ms}ms, ${(bytes / 1024).toFixed(0)}KB`);
    return { response, ms, bytes, body };
  } catch (error) {
    report(false, `page ${path}`, String(error));
    return null;
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

async function checkRssFreshness(path, maxAgeMs = 30 * 60 * 60_000) {
  try {
    const { response, ms } = await timedFetch(path);
    const body = await response.text();
    const published = body.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1] ?? null;
    const publishedAt = published ? Date.parse(published) : Number.NaN;
    const fresh = Number.isFinite(publishedAt) && Date.now() - publishedAt <= maxAgeMs;
    report(response.ok && body.includes('<rss version="2.0"') && fresh, "daily editorial RSS freshness", !response.ok ? `${response.status}, ${ms}ms` : !published ? "no RSS item has a publication date" : !fresh ? `latest item is ${((Date.now() - publishedAt) / 3_600_000).toFixed(1)}h old` : `${response.status}, ${ms}ms`);
  } catch (error) {
    report(false, "daily editorial RSS freshness", String(error));
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

function tipsIdentityProblem(payload) {
  const fixtures = tipsFixtures(payload)
    .map((row) => row?.fixture)
    .filter((fixture) => fixture && Date.parse(fixture.kickoffAt ?? "") >= Date.now());
  if (!fixtures.length) return null;
  const teams = fixtures.flatMap((fixture) => [fixture.homeTeam, fixture.awayTeam]).filter(Boolean);
  const incomplete = teams.filter((team) => !team.id || !team.name);
  if (incomplete.length) return `${incomplete.length} upcoming team identity row(s) are incomplete`;
  const placeholderCountries = teams.filter((team) => !team.country || ["world", "unknown"].includes(String(team.country).trim().toLowerCase()));
  const coverage = teams.length ? (teams.length - placeholderCountries.length) / teams.length : 1;
  if (coverage < 0.9) return `${placeholderCountries.length}/${teams.length} upcoming teams still use placeholder countries`;
  const crests = teams.filter((team) => typeof team.logo === "string" && team.logo.length > 0).length;
  if (crests / teams.length < 0.35) return `provider crest coverage is ${crests}/${teams.length}`;
  return null;
}

async function checkLatestRun(path, maxAgeMs, label, acceptedStatuses = ["completed", "partial", "empty"]) {
  return checkJson(path, (payload) => {
    const run = payload?.data;
    if (!run) return "no stored run receipt";
    if (!acceptedStatuses.includes(run.status)) return `latest status is ${run.status ?? "missing"}`;
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

function checkTipsSurfaceConsistency(page, payload, label) {
  if (!page || !payload) return;
  const providerStatus = payload?.data?.slate?.provider?.status ?? "missing";
  const fixtures = tipsFixtures(payload);
  const renderedUnavailable = /stored provider slate is unavailable|No stored provider response was read/i.test(page.body);
  const firstFixture = fixtures[0]?.fixture;
  const firstMatchRendered = !firstFixture || [
    firstFixture.fixtureId,
    firstFixture.homeTeam?.name,
    firstFixture.awayTeam?.name
  ].filter(Boolean).some((value) => page.body.includes(value));
  const problem = ["completed", "empty"].includes(providerStatus) && renderedUnavailable
    ? `HTML is unavailable while API provider status is ${providerStatus} with ${fixtures.length} fixture(s)`
    : fixtures.length && !firstMatchRendered
      ? `HTML does not contain the API's first fixture (${firstFixture?.fixtureId ?? "unknown"})`
      : null;
  report(!problem, label, problem ?? `${fixtures.length} fixture(s), provider ${providerStatus}`);
}

console.log(`OddsPadi health sweep against ${site}\n`);

const homePage = await checkPage("/", { maxMs: 6000 });
const predictionsPage = await checkPage("/predictions", { maxMs: 6000 });
const todayPage = await checkPage("/predictions/today", { maxMs: 6000 });
const weeklyPage = await checkPage("/predictions/week", { maxMs: 6000 });
await checkPage("/predictions/history", { maxMs: 6000 });
await checkPage("/news");
await checkPage("/community");
await checkRssFreshness("/news/rss.xml");

const todayTips = await checkJson("/api/tips/today", tipsFreshnessProblem, "api today's tips freshness");
await checkJson("/api/tips/tomorrow", tipsFreshnessProblem, "api tomorrow's tips freshness");
const weeklyTips = await checkJson("/api/tips/week", (payload) => {
  const problem = tipsFreshnessProblem(payload);
  if (problem) return problem;
  if (payload?.data?.days?.length !== 7) return "weekly product does not contain seven days";
  return tipsFixtures(payload).length ? null : "weekly product has no provider-backed fixtures";
}, "api weekly tips freshness");
const identityProblem = tipsIdentityProblem(weeklyTips);
report(!identityProblem, "upcoming fixture identity coverage", identityProblem ?? `${tipsFixtures(weeklyTips).length} fixture(s) with team names, countries/flags, and crest fallbacks`);
checkTipsSurfaceConsistency(homePage, todayTips, "homepage matches today's tips API");
checkTipsSurfaceConsistency(predictionsPage, todayTips, "predictions page matches today's tips API");
checkTipsSurfaceConsistency(todayPage, todayTips, "today page matches today's tips API");
checkTipsSurfaceConsistency(weeklyPage, weeklyTips, "weekly page matches weekly tips API");
if (todayTips) await checkFixtureAnalysisLinks(todayTips, "analysis links from today's tips");
if (weeklyTips) await checkFixtureAnalysisLinks(weeklyTips, "analysis links from weekly radar");

await checkLatestRun("/api/cron/import-fixtures", 26 * 60 * 60_000, "scheduled fixture import receipt");
await checkLatestRun("/api/cron/refresh-odds", 4 * 60 * 60_000, "scheduled odds refresh receipt");
await checkLatestRun("/api/cron/run-daily-engine", 26 * 60 * 60_000, "scheduled daily engine receipt");
await checkLatestRun("/api/cron/generate-weekly-predictions", 26 * 60 * 60_000, "scheduled weekly engine receipt");
await checkLatestRun("/api/cron/enrich-fixture-identities", 30 * 60 * 60_000, "scheduled fixture identity receipt");
await checkLatestRun("/api/cron/run-model-learning", 30 * 60 * 60_000, "serialized model learning receipt", ["completed"]);

for (const sport of ["football", "basketball", "tennis"]) {
  await checkJson(`/api/sports/decision/training/calibration?sport=${sport}`, (payload) => {
    if (!payload?.success || payload?.data?.status !== "ready") return "calibration snapshot is unavailable";
    const createdAt = Date.parse(payload.data.latestRun?.createdAt ?? "");
    if (!Number.isFinite(createdAt)) return "no stored calibration run";
    const ageMs = Date.now() - createdAt;
    return ageMs > 48 * 60 * 60_000 ? `latest calibration is ${(ageMs / 3_600_000).toFixed(1)}h old` : null;
  }, `governed ${sport} learning receipt`);
}

await checkJson("/api/sports/decision/training/multi-sport-backtest-run?sport=all&minSample=30&limit=50000", (payload) => {
  if (!payload?.success || !Array.isArray(payload?.data?.jobs)) return "runtime backtest preview is unavailable";
  const jobs = payload.data.jobs;
  const problems = [];
  for (const sport of ["football", "basketball", "tennis"]) {
    const backtest = jobs.find((job) => job?.sport === sport)?.latestBacktest;
    if (!backtest) {
      problems.push(`${sport}: no stored runtime replay`);
      continue;
    }
    if (!backtest.exactRuntimeParity || !backtest.realDataOnly) {
      problems.push(`${sport}: ${backtest.compatibility ?? "incompatible"}/${backtest.dataSource ?? "unknown source"}`);
      continue;
    }
    const createdAt = Date.parse(backtest.createdAt ?? "");
    if (!Number.isFinite(createdAt)) {
      problems.push(`${sport}: invalid runtime replay timestamp`);
      continue;
    }
    const ageMs = Date.now() - createdAt;
    if (ageMs > 8 * 24 * 60 * 60_000) problems.push(`${sport}: runtime replay is ${(ageMs / 86_400_000).toFixed(1)}d old`);
    if (backtest.sampleSize < 30) problems.push(`${sport}: runtime replay sample is ${backtest.sampleSize}`);
  }
  return problems.length ? problems.join("; ") : null;
}, "weekly exact-runtime model evidence");

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
