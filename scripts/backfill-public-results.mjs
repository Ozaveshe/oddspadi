const execute = process.argv.includes("--run");
const baseUrl = (process.env.ODDSPADI_SITE_URL || process.env.URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const token = process.env.ODDSPADI_ADMIN_TOKEN?.trim();
if (execute && !token) throw new Error("--run requires ODDSPADI_ADMIN_TOKEN.");
const response = await fetch(`${baseUrl}/api/cron/backfill-results`, {
  method: execute ? "POST" : "GET",
  headers: execute ? { "x-oddspadi-admin-token": token, accept: "application/json" } : { accept: "application/json" }
});
const body = await response.text();
console.log(body);
if (!response.ok) process.exitCode = 1;
