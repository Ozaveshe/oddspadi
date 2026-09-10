import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/site-health.mjs", "utf8").replace(/^#!.*\n/, "");

async function runHealth(options: { receipt?: unknown; receiptHttp?: number; admin?: boolean; modelHttp?: number } = {}) {
  const lines: string[] = [];
  const requests: string[] = [];
  const now = new Date().toISOString();
  let exitCode: number | undefined;
  await runInNewContext(`(async () => { ${script}\n })()`, {
    Buffer, AbortSignal, Date,
    console: { log: (line: string) => lines.push(line) },
    process: { argv: [], env: options.admin ? { ODDSPADI_ADMIN_TOKEN: "synthetic-test-token" } : {}, exit: (code: number) => { exitCode = code; } },
    fetch: async (url: string) => {
      requests.push(url);
      const path = new URL(url).pathname;
      let status = 200;
      let payload: unknown = {};
      if (path.startsWith("/api/cron/")) {
        status = options.receiptHttp ?? 200;
        payload = { success: true, data: options.receipt ?? { status: "operational", lastSuccessAt: now } };
      }
      if (url.includes("multi-sport-backtest-run")) {
        status = options.modelHttp ?? 200;
        payload = { success: true, data: { jobs: ["football", "basketball", "tennis"].map(sport => ({ sport, latestBacktest: { exactRuntimeParity: true, realDataOnly: true, createdAt: now, sampleSize: 30 } })) } };
      }
      return {
        ok: status >= 200 && status < 300, status,
        json: async () => payload,
        text: async () => `<rss version="2.0"><pubDate>${new Date().toUTCString()}</pubDate></rss>standings-team`
      };
    }
  });
  return { lines, requests, exitCode };
}

describe("production canary evidence", () => {
  it("accepts the current public success receipt and timestamp", async () => {
    const { lines } = await runHealth();
    expect(lines.find(line => line.includes("scheduled fixture import receipt"))).toMatch(/^OK /);
    expect(lines.find(line => line.includes("serialized model learning receipt"))).toMatch(/^OK /);
  });

  it.each(["delayed", "unavailable", "never-run", "partial"])("keeps %s receipts failing", async status => {
    const { lines, exitCode } = await runHealth({ receipt: { status, lastSuccessAt: new Date().toISOString() } });
    expect(lines.find(line => line.includes("scheduled fixture import receipt"))).toContain(`latest status is ${status}`);
    expect(exitCode).toBe(1);
  });

  it.each([null, "invalid", "2020-01-01T00:00:00Z"])("rejects missing, invalid or stale success time %s", async lastSuccessAt => {
    const { lines } = await runHealth({ receipt: { status: "operational", lastSuccessAt } });
    expect(lines.find(line => line.includes("scheduled fixture import receipt"))).toMatch(/^FAIL /);
  });

  it("rejects an HTTP failure even when its JSON looks successful", async () => {
    const { lines } = await runHealth({ receiptHttp: 503 });
    expect(lines.find(line => line.includes("scheduled fixture import receipt"))).toContain("HTTP 503");
  });

  it("skips protected evidence without credentials and makes no request", async () => {
    const { lines, requests } = await runHealth();
    expect(lines.find(line => line.includes("weekly exact-runtime model evidence"))).toMatch(/^SKIP /);
    expect(requests.some(url => url.includes("multi-sport-backtest-run"))).toBe(false);
  });

  it("fails protected evidence when supplied credentials are rejected", async () => {
    const { lines } = await runHealth({ admin: true, modelHttp: 401 });
    expect(lines.find(line => line.includes("weekly exact-runtime model evidence"))).toContain("HTTP 401");
  });

  it("validates authorized model evidence when available", async () => {
    const { lines } = await runHealth({ admin: true });
    expect(lines.find(line => line.includes("weekly exact-runtime model evidence"))).toMatch(/^OK /);
  });
});
