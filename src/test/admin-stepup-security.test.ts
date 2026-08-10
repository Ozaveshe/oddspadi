import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isStepUpAuthorized, requireStepUp, actorTokenFingerprint } from "@/lib/security/adminStepUp";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

function request(headers: Record<string, string>): Request {
  return new Request("https://oddspadi.com/api/x", { method: "POST", headers });
}

const ADMIN = "admin-token-abcdefghij";
const STEPUP = "stepup-token-1234567890";

describe("step-up authorisation", () => {
  const original = { admin: process.env.ODDSPADI_ADMIN_TOKEN, stepup: process.env.ODDSPADI_ADMIN_STEPUP_TOKEN };
  beforeEach(() => {
    process.env.ODDSPADI_ADMIN_TOKEN = ADMIN;
    process.env.ODDSPADI_ADMIN_STEPUP_TOKEN = STEPUP;
  });
  afterEach(() => {
    process.env.ODDSPADI_ADMIN_TOKEN = original.admin;
    process.env.ODDSPADI_ADMIN_STEPUP_TOKEN = original.stepup;
  });

  it("requires both the base admin token and the distinct step-up token", () => {
    expect(isStepUpAuthorized(request({ "x-oddspadi-admin-token": ADMIN, "x-oddspadi-stepup-token": STEPUP }))).toBe(true);
    expect(isStepUpAuthorized(request({ "x-oddspadi-admin-token": ADMIN }))).toBe(false); // no step-up
    expect(isStepUpAuthorized(request({ "x-oddspadi-stepup-token": STEPUP }))).toBe(false); // no base
    expect(isStepUpAuthorized(request({ "x-oddspadi-admin-token": ADMIN, "x-oddspadi-stepup-token": "wrong" }))).toBe(false);
  });

  it("fails closed when the step-up secret is unset", () => {
    delete process.env.ODDSPADI_ADMIN_STEPUP_TOKEN;
    expect(isStepUpAuthorized(request({ "x-oddspadi-admin-token": ADMIN, "x-oddspadi-stepup-token": STEPUP }))).toBe(false);
  });

  it("requires a typed confirmation matching the action", () => {
    const req = request({ "x-oddspadi-admin-token": ADMIN, "x-oddspadi-stepup-token": STEPUP });
    expect(requireStepUp(req, "promote_calibration", "promote_calibration")).toBeNull();
    expect(requireStepUp(req, "promote_calibration", "something-else")?.status).toBe(400);
    // Admin without step-up on a destructive action → 403, never reveals which factor failed.
    const noStepUp = request({ "x-oddspadi-admin-token": ADMIN });
    expect(requireStepUp(noStepUp, "promote_calibration", "promote_calibration")?.status).toBe(403);
  });

  it("fingerprints the acting token without storing it", () => {
    const fp = actorTokenFingerprint(request({ "x-oddspadi-admin-token": ADMIN }));
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
    expect(fp).not.toContain(ADMIN);
  });
});

describe("destructive admin routes require step-up and write an audit row", () => {
  it("calibration promotion approve is step-up gated and audited", () => {
    const route = read("src/app/api/sports/decision/training/calibration-promotion/route.ts");
    expect(route).toContain("requireStepUp");
    expect(route).toContain("writeOperatorAudit");
  });

  it("autonomous-cycle persist run is step-up gated and audited", () => {
    const route = read("src/app/api/sports/decision/autonomous-cycle/route.ts");
    expect(route).toContain("requireStepUp");
    expect(route).toContain("writeOperatorAudit");
  });

  it("the audit migration is service-role-only and append-only", () => {
    const migration = read("supabase/migrations/20260809150000_operator_audit.sql");
    expect(migration).toContain("create table if not exists public.op_operator_audit");
    expect(migration).toContain("revoke all on public.op_operator_audit from public, anon, authenticated");
    expect(migration).toMatch(/grant select, insert on public\.op_operator_audit to service_role/);
  });
});
