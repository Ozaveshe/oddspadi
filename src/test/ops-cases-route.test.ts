import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
const getSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({ createSupabaseServerClient: createSupabaseServerClientMock }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: getSupabaseServerClientMock }));

import { GET as listCases, POST as caseAction } from "@/app/api/ops/cases/route";
import { POST as syncCases } from "@/app/api/ops/cases/sync/route";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260809170000_operational_cases.sql"),
  "utf8"
);

const CASE_ID = "123e4567-e89b-42d3-a456-426614174001";
const STAFF_ID = "staff-1";
const STAFF_FP = `usr:${createHash("sha256").update(STAFF_ID).digest("hex").slice(0, 16)}`;

function jsonRequest(path: string, body: Record<string, unknown>, method = "POST") {
  return new Request(`http://127.0.0.1:3025${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

type ChainResult = { data?: unknown; error?: unknown };

function chain(listResult: ChainResult = { data: [], error: null }, rowResult: ChainResult = { data: null, error: null }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "limit", "update", "insert", "delete"]) c[m] = vi.fn(() => c);
  c.maybeSingle = vi.fn(async () => rowResult);
  c.single = vi.fn(async () => rowResult);
  (c as { then: unknown }).then = (resolve: (v: ChainResult) => unknown) => Promise.resolve(listResult).then(resolve);
  return c as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
}

function staffCookie(isStaff = true) {
  const profile = chain({ data: [], error: null }, { data: { is_admin: isStaff, account_type: isStaff ? "staff" : "organic" }, error: null });
  createSupabaseServerClientMock.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: STAFF_ID } } })) },
    from: vi.fn((t: string) => (t === "op_profiles" ? profile : chain()))
  });
}

function adminClient(tables: Record<string, unknown> = {}, rpcResult: ChainResult = { data: { id: CASE_ID }, error: null }) {
  const from = vi.fn((t: string) => tables[t] ?? chain());
  const rpc = vi.fn(async () => rpcResult);
  getSupabaseServerClientMock.mockReturnValue({ from, rpc });
  return { from, rpc };
}

function caseRow(overrides: Record<string, unknown> = {}) {
  return chain(
    { data: [], error: null },
    {
      data: { id: CASE_ID, workspace: "market_ops", category: "market_mismatch", severity: "warning", state: "in_progress", escalated_at: null, resolved_by: null, ...overrides },
      error: null
    }
  );
}

beforeEach(() => {
  createSupabaseServerClientMock.mockReset();
  getSupabaseServerClientMock.mockReset();
  getSupabaseServerClientMock.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ops case actions", () => {
  it("refuses a non-staff caller without touching the service client", async () => {
    staffCookie(false);
    const response = await caseAction(jsonRequest("/api/ops/cases", { caseId: CASE_ID, action: "start" }));
    expect(response.status).toBe(401);
    expect(getSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it("rejects an illegal transition and writes nothing", async () => {
    staffCookie();
    const cases = caseRow({ state: "resolved", resolved_at: "2026-08-09T10:00:00.000Z" });
    const events = chain();
    adminClient({ op_operational_cases: cases, op_operational_case_events: events });
    const response = await caseAction(jsonRequest("/api/ops/cases", { caseId: CASE_ID, action: "start" }));
    expect(response.status).toBe(409);
    expect(cases.update).not.toHaveBeenCalled();
    expect(events.insert).not.toHaveBeenCalled();
  });

  it("resolves a case, writing exactly one timeline event and one audit row", async () => {
    staffCookie();
    const cases = caseRow();
    const events = chain();
    const audit = chain();
    const { from } = adminClient({ op_operational_cases: cases, op_operational_case_events: events, op_operator_audit: audit });
    const response = await caseAction(
      jsonRequest("/api/ops/cases", { caseId: CASE_ID, action: "resolve", note: "priced the market from the closing snapshot" })
    );
    expect(response.status).toBe(201);
    const update = (cases.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(update.state).toBe("resolved");
    expect(update.resolution).toBe("priced the market from the closing snapshot");
    expect(update.resolved_by).toBe(STAFF_FP);
    expect(events.insert).toHaveBeenCalledTimes(1);
    expect(audit.insert).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("op_operator_audit");
  });

  it("requires a note to resolve", async () => {
    staffCookie();
    const cases = caseRow();
    adminClient({ op_operational_cases: cases });
    const response = await caseAction(jsonRequest("/api/ops/cases", { caseId: CASE_ID, action: "resolve" }));
    expect(response.status).toBe(400);
    expect(cases.update).not.toHaveBeenCalled();
  });

  it("escalates, stamping escalated_at and raising severity", async () => {
    staffCookie();
    const cases = caseRow({ state: "in_progress", severity: "warning" });
    const events = chain();
    adminClient({ op_operational_cases: cases, op_operational_case_events: events, op_operator_audit: chain() });
    const response = await caseAction(
      jsonRequest("/api/ops/cases", { caseId: CASE_ID, action: "escalate", note: "needs trading lead", toSeverity: "critical" })
    );
    expect(response.status).toBe(201);
    const update = (cases.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(update.state).toBe("escalated");
    expect(update.escalated_at).not.toBeNull();
    expect(update.severity).toBe("critical");
    const event = (events.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(event.event_type).toBe("escalate");
    // A market_mismatch case has no default path; the event records that honestly.
    expect((event.detail as Record<string, unknown>).escalationPath).toBeNull();
  });

  it("routes escalation to the category's default owner and records it", async () => {
    staffCookie();
    const cases = caseRow({ category: "identity_mismatch", state: "in_progress" });
    const events = chain();
    adminClient({ op_operational_cases: cases, op_operational_case_events: events, op_operator_audit: chain() });
    const response = await caseAction(
      jsonRequest("/api/ops/cases", { caseId: CASE_ID, action: "escalate", note: "duplicate identity across providers" })
    );
    expect(response.status).toBe(201);
    expect((await response.json()).escalationPath).toBe("data_corruption");
    const event = (events.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect((event.detail as Record<string, unknown>).escalationPath).toBe("data_corruption");
  });

  it("refuses a quality review by the same person who resolved the case", async () => {
    staffCookie();
    const cases = caseRow({ state: "resolved", resolved_at: "2026-08-09T10:00:00.000Z", resolved_by: STAFF_FP });
    const events = chain();
    adminClient({ op_operational_cases: cases, op_operational_case_events: events });
    const response = await caseAction(
      jsonRequest("/api/ops/cases", { caseId: CASE_ID, action: "quality_review", note: "looks fine to me" })
    );
    expect(response.status).toBe(403);
    expect(events.insert).not.toHaveBeenCalled();
  });

  it("previews in training mode and performs no write", async () => {
    vi.stubEnv("ODDSPADI_OPS_TRAINING", "1");
    staffCookie();
    const cases = caseRow();
    const events = chain();
    adminClient({ op_operational_cases: cases, op_operational_case_events: events });
    const response = await caseAction(
      jsonRequest("/api/ops/cases", { caseId: CASE_ID, action: "resolve", note: "training run" })
    );
    const bodyJson = await response.json();
    expect(bodyJson.status).toBe("training-preview");
    expect(cases.update).not.toHaveBeenCalled();
    expect(events.insert).not.toHaveBeenCalled();
  });

  it("lists active cases with an SLA classification", async () => {
    staffCookie();
    const now = new Date().toISOString();
    const cases = chain({
      data: [
        { id: CASE_ID, workspace: "market_ops", source: "reconciler_exception", kind: "k", severity: "critical", title: "t", state: "open", assignee_fingerprint: null, due_at: null, opened_at: now, resolved_at: null }
      ],
      error: null
    });
    adminClient({ op_operational_cases: cases });
    const response = await listCases(new Request("http://127.0.0.1:3025/api/ops/cases?workspace=market_ops"));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.cases[0].sla).toBe("on_track");
  });
});

describe("ops case sync", () => {
  it("opens one case per open alert via the idempotent RPC, never a direct insert", async () => {
    staffCookie();
    const exceptions = chain({ data: [{ id: "exc-1", kind: "reconciler_missing_closing_price", severity: "warning", detail: {} }], error: null });
    const reports = chain({ data: [{ id: "rep-1", category: "scam_or_paid_tips", content_type: "community_tip", content_id: "c1" }], error: null });
    const { from, rpc } = adminClient({ op_settlement_exceptions: exceptions, op_content_reports: reports });
    const response = await syncCases(jsonRequest("/api/ops/cases/sync", {}));
    expect(response.status).toBe(200);
    expect((await response.json()).processed).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("op_upsert_operational_case", expect.objectContaining({ p_exception_id: "exc-1", p_report_id: null }));
    expect(rpc).toHaveBeenCalledWith("op_upsert_operational_case", expect.objectContaining({ p_report_id: "rep-1", p_workspace: "community", p_severity: "critical" }));
    // Idempotency lives in the RPC; the route never inserts cases directly.
    expect(from).not.toHaveBeenCalledWith("op_operational_cases");
  });

  it("opens nothing when an alert queue cannot be read", async () => {
    staffCookie();
    const exceptions = chain({ data: null, error: { code: "42501", message: "denied" } });
    const { rpc } = adminClient({ op_settlement_exceptions: exceptions });
    const response = await syncCases(jsonRequest("/api/ops/cases/sync", {}));
    expect(response.status).toBe(502);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("previews in training mode without calling the RPC", async () => {
    vi.stubEnv("ODDSPADI_OPS_TRAINING", "1");
    staffCookie();
    const exceptions = chain({ data: [{ id: "exc-1", kind: "reconciler_result_conflict", severity: "critical", detail: {} }], error: null });
    const reports = chain({ data: [], error: null });
    const { rpc } = adminClient({ op_settlement_exceptions: exceptions, op_content_reports: reports });
    const response = await syncCases(jsonRequest("/api/ops/cases/sync", {}));
    const json = await response.json();
    expect(json.status).toBe("training-preview");
    expect(json.wouldOpen).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("operational-cases migration", () => {
  it("creates both case tables and the idempotent upsert RPC", () => {
    expect(migration).toContain("create table if not exists public.op_operational_cases");
    expect(migration).toContain("create table if not exists public.op_operational_case_events");
    expect(migration).toContain("function public.op_upsert_operational_case");
  });

  it("enforces one open case per open alert and keeps the tables service-role only", () => {
    expect(migration).toContain("op_operational_cases_open_exception_idx");
    expect(migration).toContain("op_operational_cases_open_report_idx");
    expect(migration).toContain("where exception_id is not null and state not in ('resolved', 'dismissed')");
    expect(migration).toContain("revoke all on public.op_operational_cases from public, anon, authenticated");
    expect(migration).not.toMatch(/create policy[^;]*on public\.op_operational_cases/);
  });
});
