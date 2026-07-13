#!/usr/bin/env node
/**
 * Manually trigger editorial story generation on production (same path the
 * 4x-daily schedule uses). Requires ODDSPADI_ADMIN_TOKEN in the environment.
 *
 *   node scripts/run-editorial-sweep.mjs [--site https://oddspadi.com]
 */
const site = (process.argv.includes("--site") ? process.argv[process.argv.indexOf("--site") + 1] : null) ?? process.env.ODDSPADI_SITE_URL ?? "https://oddspadi.com";
const token = process.env.ODDSPADI_ADMIN_TOKEN?.trim();
if (!token) {
  console.error("ODDSPADI_ADMIN_TOKEN is not set. Export it (see .env.local) and retry.");
  process.exit(1);
}

const response = await fetch(`${site}/.netlify/functions/editorial-generation-worker-background`, {
  method: "POST",
  headers: { "x-oddspadi-schedule-token": token },
  signal: AbortSignal.timeout(30_000)
});

// Background functions ack with 202 and finish asynchronously.
console.log(`Worker responded ${response.status}${response.status === 202 ? " (accepted — generation runs in the background)" : ""}`);
const text = await response.text().catch(() => "");
if (text) console.log(text);
process.exit(response.ok || response.status === 202 ? 0 : 1);
