import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isTrainingAdminAuthorized, requireTrainingAdmin, trainingUnauthorized } from "@/lib/sports/training/adminAuth";

/**
 * The line between the public product and private model operations.
 *
 * Not linked from the UI is not the same as private. Probing production on
 * 2026-08-02 as an anonymous stranger returned, with no credentials at all:
 *
 *   GET /api/sports/decision/training/calibration
 *     -> the shadow model's internal key
 *        "football-poisson-v5-shadow-mp-649021fd6576", its run UUID, and its
 *        complete unpublished evaluation — Brier, skill, log loss, ECE, ROI
 *        per probability bucket, and the list of promotion blockers.
 *
 *   GET /api/sports/decision/training/provider-capacity
 *     -> every data supplier and the env var holding its key
 *        (API_FOOTBALL_KEY, API_BASKETBALL_KEY).
 *
 * Consumer-facing transparency is /track-record, built from the publication
 * ledger, where a claim exists only if it was published before kickoff. The
 * operator's view of an unpromoted model is a different thing and stays
 * behind the token.
 */
const OPERATIONAL_DIRS = [
  join("src", "app", "api", "sports", "decision", "training"),
  join("src", "app", "api", "cron")
];
const OPERATIONAL_FILES = [
  join("src", "app", "api", "sports", "decision", "autonomous-cycle", "route.ts"),
  join("src", "app", "api", "sports", "decision", "autonomous-settlement", "route.ts")
];

async function operationalRoutes(): Promise<Array<{ path: string; source: string }>> {
  const out: Array<{ path: string; source: string }> = [];
  for (const dir of OPERATIONAL_DIRS) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name, "route.ts");
      const source = await readFile(path, "utf8").catch(() => "");
      if (source) out.push({ path, source });
    }
  }
  for (const path of OPERATIONAL_FILES) out.push({ path, source: await readFile(path, "utf8") });
  return out;
}

/** Slice each exported handler so a guard in POST cannot vouch for GET. */
function handlers(source: string): Array<{ method: string; body: string }> {
  const marks = [...source.matchAll(/export\s+(?:const|async function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => ({
    method: m[1],
    at: m.index ?? 0
  }));
  return marks.map((m, i) => ({
    method: m.method,
    body: source.slice(m.at, i + 1 < marks.length ? marks[i + 1].at : source.length)
  }));
}

const GUARD = /requireTrainingAdmin|isTrainingAdminAuthorized|isCronAuthorized/;

/**
 * The cron GETs are a deliberate exception: they publish a coarse "is the site
 * updating" receipt for the status page, already sanitised through
 * `toPublicRunReceipt` and covered by job-endpoint-security.
 */
function isPublicRunReceipt(path: string, body: string): boolean {
  return path.includes(join("api", "cron")) && body.includes("toPublicRunReceipt");
}

describe("operational endpoints are private in code, not by obscurity", () => {
  it("guards every handler, reads included", async () => {
    const unguarded: string[] = [];
    for (const { path, source } of await operationalRoutes()) {
      for (const handler of handlers(source)) {
        if (GUARD.test(handler.body)) continue;
        if (isPublicRunReceipt(path, handler.body)) continue;
        unguarded.push(`${handler.method} ${path}`);
      }
    }
    expect(unguarded, "an unauthenticated read of an operational route is a leak").toEqual([]);
  });

  it("authorises before it validates", async () => {
    // Production answered an anonymous POST to provider-capacity with a 400
    // explaining that `run=1` was missing. That confirms the route exists and
    // teaches its interface to someone holding no credentials.
    const offenders: string[] = [];
    for (const { path, source } of await operationalRoutes()) {
      for (const handler of handlers(source)) {
        if (!/POST|PUT|PATCH|DELETE/.test(handler.method)) continue;
        const guardAt = handler.body.search(GUARD);
        const rejectAt = handler.body.search(/return apiError\([^)]*,\s*4[0-9]{2}\)/);
        if (guardAt >= 0 && rejectAt >= 0 && rejectAt < guardAt) offenders.push(`${handler.method} ${path}`);
      }
    }
    expect(offenders, "the auth check must come before any other rejection").toEqual([]);
  });

  it("never names the header it wants in a rejection", async () => {
    const offenders: string[] = [];
    for (const { path, source } of await operationalRoutes()) {
      for (const [line, index] of source.split("\n").map((l, i) => [l, i] as const)) {
        // Naming the header in a 401 hands an anonymous caller the exact
        // thing to brute-force, and confirms what the route does.
        if (/apiError\(\s*"[^"]*x-oddspadi-admin-token/.test(line)) offenders.push(`${path}:${index + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the admin guard fails closed", () => {
  const original = process.env.ODDSPADI_ADMIN_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.ODDSPADI_ADMIN_TOKEN;
    else process.env.ODDSPADI_ADMIN_TOKEN = original;
  });

  const withToken = (token?: string) =>
    new Request("https://oddspadi.com/api/sports/decision/training/calibration", {
      headers: token ? { "x-oddspadi-admin-token": token } : {}
    });

  it("rejects everything when the secret is not configured", () => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
    // The dangerous inverse is an unset secret comparing equal to an unset
    // header and opening every operational route in an environment that
    // forgot to set it.
    expect(isTrainingAdminAuthorized(withToken())).toBe(false);
    expect(isTrainingAdminAuthorized(withToken(""))).toBe(false);
    expect(isTrainingAdminAuthorized(withToken("anything"))).toBe(false);
  });

  it("rejects a wrong token and accepts the right one", () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "correct-horse-battery-staple";
    expect(isTrainingAdminAuthorized(withToken("wrong"))).toBe(false);
    // A prefix must not pass: length is compared before timingSafeEqual,
    // which throws on unequal buffers.
    expect(isTrainingAdminAuthorized(withToken("correct-horse"))).toBe(false);
    expect(isTrainingAdminAuthorized(withToken("correct-horse-battery-stapl3"))).toBe(false);
    expect(isTrainingAdminAuthorized(withToken("correct-horse-battery-staple"))).toBe(true);
  });

  it("returns a 401 that says nothing", async () => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
    const denied = requireTrainingAdmin(withToken());
    expect(denied).not.toBeNull();
    expect(denied?.status).toBe(401);
    const body = await denied!.json();
    expect(body).toEqual({ success: false, data: null, error: "Unauthorized." });

    const serialised = JSON.stringify(await trainingUnauthorized().json()).toLowerCase();
    for (const leak of ["x-oddspadi", "token", "admin", "calibration", "provider"]) {
      expect(serialised, `a 401 must not mention ${leak}`).not.toContain(leak);
    }
  });

  it("lets an authorised request through", () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "a-real-secret";
    expect(requireTrainingAdmin(withToken("a-real-secret"))).toBeNull();
  });
});
