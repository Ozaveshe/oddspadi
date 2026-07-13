#!/usr/bin/env node
/**
 * Prime the durable data caches after a deploy (or on a schedule) so the
 * first real visitor never pays the provider fan-out.
 *
 *   node scripts/warm-caches.mjs [--site https://oddspadi.com]
 */
const site = (process.argv.includes("--site") ? process.argv[process.argv.indexOf("--site") + 1] : null) ?? process.env.ODDSPADI_SITE_URL ?? "https://oddspadi.com";
const targets = [
  "/",
  "/predictions",
  "/predictions?sport=basketball",
  "/predictions?sport=tennis",
  "/predictions/value-picks",
  "/live-scores",
  "/news",
  "/api/live",
  "/api/sports/predictions?sport=football&view=summary",
  "/api/sports/predictions?sport=basketball&view=summary"
];

for (const path of targets) {
  const started = Date.now();
  try {
    const response = await fetch(`${site}${path}`, { signal: AbortSignal.timeout(60_000) });
    await response.arrayBuffer();
    console.log(`${response.ok ? "warm" : "FAIL"}  ${path} (${response.status}, ${Date.now() - started}ms)`);
  } catch (error) {
    console.log(`FAIL  ${path} — ${error}`);
  }
}
