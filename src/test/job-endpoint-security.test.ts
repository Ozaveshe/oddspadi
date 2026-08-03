import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every job endpoint authenticates, in code.
 *
 * `projection-refresh-sweep` shipped without a token check. Netlify happens to
 * refuse external invocation of scheduled functions, so it was never
 * exploitable — but that is platform configuration, not a property of the
 * repository. Convert the function to a non-scheduled one, or move hosts, and
 * an anonymous caller could drive unbounded database work.
 *
 * These tests treat "the platform blocks it" as insufficient and hold every
 * function to the same in-code standard.
 */
const FUNCTIONS_DIR = join(process.cwd(), "netlify", "functions");

async function functionFiles(): Promise<string[]> {
  const entries = await readdir(FUNCTIONS_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".ts")).map((entry) => entry.name);
}

describe("scheduled jobs cannot be triggered anonymously", () => {
  it("checks a shared secret in every job function", async () => {
    const files = await functionFiles();
    expect(files.length).toBeGreaterThan(20);

    // Workers do the work and must verify an incoming secret. Sweeps only
    // forward to a worker that verifies, so they are covered transitively —
    // but any function that reaches the database directly must verify itself.
    const unauthenticated: string[] = [];
    for (const file of files) {
      const source = await readFile(join(FUNCTIONS_DIR, file), "utf8");
      const touchesDatabaseDirectly = source.includes("createClient(");
      const isWorker = file.includes("worker-background");
      if (!touchesDatabaseDirectly && !isWorker) continue;
      const verifiesIncoming =
        source.includes("request.headers.get(\"x-oddspadi-schedule-token\")") || source.includes("scheduleToken");
      const comparesSafely = source.includes("timingSafeEqual") || source.includes("tokenMatches");
      if (!verifiesIncoming || !comparesSafely) unauthenticated.push(file);
    }
    expect(unauthenticated, "every function that reaches the database must verify a secret in code").toEqual([]);
  });

  it("compares secrets in constant time, never with ===", async () => {
    for (const file of await functionFiles()) {
      const source = await readFile(join(FUNCTIONS_DIR, file), "utf8");
      // A direct equality check on a secret leaks length and prefix by timing.
      expect(source, `${file} must not compare a token with ===`).not.toMatch(
        /(scheduleToken|adminToken|supplied|expected)\s*===\s*(scheduleToken|adminToken|supplied|expected)/
      );
    }
  });

  it("keeps the unauthenticated response non-revealing", async () => {
    // The check lives on the worker: the sweep is the platform's scheduled
    // entrypoint and has no caller to authenticate.
    const source = await readFile(join(FUNCTIONS_DIR, "projection-refresh-worker-background.ts"), "utf8");
    const rejection = source.slice(source.indexOf("if (!scheduleToken"), source.indexOf("const url ="));
    // A 401 body should not name the job, the database, or the reason.
    for (const leak of ["projection", "supabase", "Supabase", "rpc", "op_refresh"]) {
      expect(rejection, `401 body must not mention ${leak}`).not.toContain(leak);
    }
    expect(rejection).toContain("401");
  });
});

describe("a scheduled entrypoint cannot demand a header the scheduler never sends", () => {
  it("keeps inbound token checks out of scheduled functions", async () => {
    // The regression this exists to prevent, precisely:
    //
    // `projection-refresh-sweep` was given an inbound token check. Netlify's
    // scheduler invokes a scheduled function with no `x-oddspadi-schedule-token`
    // header, because there is no caller to set one — so every tick returned
    // 401 before touching the database. Production stopped refreshing its
    // projections at the minute that check deployed and did not resume; eight
    // and a half hours later every public projection was still serving the
    // payload built just before the deploy.
    //
    // The distinction the earlier check missed: a *worker* is called by our own
    // code and must verify. A *scheduled entrypoint* is called by the platform
    // and must not, because it cannot. Its protection is to hold no privileged
    // logic of its own — it forwards to a worker that does verify.
    const offenders: string[] = [];
    for (const file of await functionFiles()) {
      const source = await readFile(join(FUNCTIONS_DIR, file), "utf8");
      if (!/export const config[^=]*=\s*\{[^}]*schedule/.test(source)) continue;
      const readsInboundToken = /request\.headers\.get\(\s*"x-oddspadi-schedule-token"\s*\)/.test(source);
      if (readsInboundToken) offenders.push(file);
    }
    expect(offenders, "a scheduled function must not gate on an inbound token").toEqual([]);
  });

  it("still keeps scheduled functions away from the database", async () => {
    // The other half of the rule. A scheduled entrypoint that cannot
    // authenticate must also not be the thing holding the service-role key.
    const offenders: string[] = [];
    for (const file of await functionFiles()) {
      const source = await readFile(join(FUNCTIONS_DIR, file), "utf8");
      if (!/export const config[^=]*=\s*\{[^}]*schedule/.test(source)) continue;
      if (source.includes("createClient(")) offenders.push(file);
    }
    expect(offenders, "scheduled entrypoints forward to a worker; they do not reach the database").toEqual([]);
  });
});

describe("state-changing work is never a GET", () => {
  it("drives every worker through POST", async () => {
    for (const file of await functionFiles()) {
      const source = await readFile(join(FUNCTIONS_DIR, file), "utf8");
      if (!source.includes("fetch(")) continue;
      // Any internal call that triggers work must declare POST explicitly.
      if (source.includes("/.netlify/functions/") || source.includes("/api/cron/")) {
        expect(source, `${file} must invoke work with POST`).toContain('method: "POST"');
      }
    }
  });

  it("keeps cron route mutations behind POST handlers only", async () => {
    const cronDir = join(process.cwd(), "src", "app", "api", "cron");
    for (const entry of await readdir(cronDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = await readFile(join(cronDir, entry.name, "route.ts"), "utf8").catch(() => "");
      if (!source) continue;
      // A GET handler may exist, but only to report the last run — it must not
      // be the thing that runs the job.
      const getBlock = source.slice(source.indexOf("export const GET"), source.indexOf("export const POST"));
      if (getBlock) {
        expect(getBlock, `${entry.name} GET must not run the job`).not.toMatch(/run[A-Z]\w*Sweep|persist:\s*true|commit:\s*true/);
      }
      // A read-only receipt route needs no cron secret, but it must not leak
      // the raw run record either — that is covered below.
      if (source.includes("export const POST")) {
        expect(source, `${entry.name} must authorise its POST`).toContain("isCronAuthorized");
      }
    }
  });
});

describe("secrets stay server-side", () => {
  it("keeps admin and service tokens out of client components", async () => {
    const roots = [join(process.cwd(), "src", "components"), join(process.cwd(), "src", "app")];
    const offenders: string[] = [];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "_archived") await walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const source = await readFile(path, "utf8");
        const isClient = source.startsWith('"use client"') || source.startsWith("'use client'");
        if (!isClient) continue;
        // A client component is shipped to the browser: any secret referenced
        // here is a published secret.
        for (const secret of ["ODDSPADI_ADMIN_TOKEN", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"]) {
          if (source.includes(secret)) offenders.push(`${path}: ${secret}`);
        }
      }
    }
    for (const root of roots) await walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("public run receipts are sanitised", () => {
  it("never returns the raw provider run from a public GET", async () => {
    const cronDir = join(process.cwd(), "src", "app", "api", "cron");
    for (const entry of await readdir(cronDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = await readFile(join(cronDir, entry.name, "route.ts"), "utf8").catch(() => "");
      if (!source.includes("readLatestProviderRun")) continue;
      // Publishing the run record leaks the internal run UUID, the internal
      // provider and job names, and an errors array that has carried raw
      // database cancellation text in production.
      expect(source, `${entry.name} must sanitise its receipt`).toContain("toPublicRunReceipt");
      expect(source).not.toMatch(/apiSuccess\(await readLatestProviderRun/);
    }
  });

  it("exposes only a coarse state and a success time", async () => {
    const { toPublicRunReceipt } = await import("@/lib/sports/intelligence/publicRunReceipt");
    const receipt = toPublicRunReceipt({
      runId: "afba54bb-26d3-4a40-a7f2-85b81871a7c8",
      providerName: "oddspadi-model-governance",
      jobType: "outcome-ledger",
      startedAt: "2026-08-02T14:00:00.000Z",
      finishedAt: "2026-08-02T14:00:09.000Z",
      status: "failed",
      fixturesFound: 0,
      oddsFound: 0,
      predictionsGenerated: 0,
      valuePicksPublished: 0,
      errors: ["odds-prune: canceling statement due to statement timeout"]
    });
    expect(Object.keys(receipt).sort()).toEqual(["lastSuccessAt", "status"]);
    const serialised = JSON.stringify(receipt).toLowerCase();
    for (const leak of ["afba54bb", "oddspadi-model-governance", "outcome-ledger", "statement timeout", "canceling"]) {
      expect(serialised, `receipt must not leak "${leak}"`).not.toContain(leak.toLowerCase());
    }
    expect(receipt.status).toBe("unavailable");
  });

  it("reports a never-run job without inventing a state", async () => {
    const { toPublicRunReceipt } = await import("@/lib/sports/intelligence/publicRunReceipt");
    expect(toPublicRunReceipt(null)).toEqual({ status: "never-run", lastSuccessAt: null });
  });
});
