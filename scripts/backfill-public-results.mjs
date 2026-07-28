const execute = process.argv.includes("--run");
const baseUrl = (process.env.ODDSPADI_SITE_URL || process.env.URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const token = process.env.ODDSPADI_ADMIN_TOKEN?.trim();
if (execute && !token) throw new Error("--run requires ODDSPADI_ADMIN_TOKEN.");
// Timeout-bounded and guarded: this was a bare top-level `await fetch` with
// neither, so an unreachable host either hung the script indefinitely or
// produced an unhandled rejection and a raw stack trace.
let response;
try {
  response = await fetch(`${baseUrl}/api/cron/backfill-results`, {
    method: execute ? "POST" : "GET",
    headers: execute ? { "x-oddspadi-admin-token": token, accept: "application/json" } : { accept: "application/json" },
    signal: AbortSignal.timeout(60_000)
  });
} catch (error) {
  console.error(`Could not reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const body = await response.text();
console.log(body);
if (!response.ok) process.exitCode = 1;
