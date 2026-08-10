import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUALITY_SUBJECTS,
  QUALITY_VERDICTS,
  sampleForReview,
  retrainingRecommended,
  summariseReviews,
  isQualitySubject,
  isQualityVerdict
} from "@/lib/ops/qualityReview";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260809190000_quality_reviews.sql"),
  "utf8"
);

describe("quality review — pure logic", () => {
  it("covers the five review subjects and three verdicts", () => {
    expect([...QUALITY_SUBJECTS].sort()).toEqual(
      ["mapping", "settlement", "result_verification", "social_copy", "moderation_decision"].sort()
    );
    expect([...QUALITY_VERDICTS].sort()).toEqual(["pass", "fail", "needs_follow_up"].sort());
  });

  it("samples deterministically — every Nth item, reproducibly", () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const a = sampleForReview(items, 0.2); // step 5 → indices 0,5
    const b = sampleForReview(items, 0.2);
    expect(a).toEqual([0, 5]);
    expect(a).toEqual(b);
    expect(sampleForReview(items, 1)).toHaveLength(10);
    expect(sampleForReview(items, 0)).toHaveLength(0);
  });

  it("recommends retraining on a fail, not on a pass", () => {
    expect(retrainingRecommended("fail")).toBe(true);
    expect(retrainingRecommended("pass")).toBe(false);
    expect(retrainingRecommended("needs_follow_up")).toBe(false);
  });

  it("summarises a batch, with a null pass rate over zero reviews", () => {
    const s = summariseReviews([
      { verdict: "pass" },
      { verdict: "fail", retraining_flag: true },
      { verdict: "needs_follow_up" }
    ]);
    expect(s.total).toBe(3);
    expect(s.fail).toBe(1);
    expect(s.retraining).toBe(1);
    expect(s.passRate).toBeCloseTo(33.333, 1);
    expect(summariseReviews([]).passRate).toBeNull();
  });

  it("validates subjects and verdicts", () => {
    expect(isQualitySubject("mapping")).toBe(true);
    expect(isQualitySubject("nope")).toBe(false);
    expect(isQualityVerdict("fail")).toBe(true);
    expect(isQualityVerdict("meh")).toBe(false);
  });
});

describe("quality-reviews migration", () => {
  it("creates the append-only, service-role-only review table", () => {
    expect(migration).toContain("create table if not exists public.op_quality_reviews");
    expect(migration).toContain("retraining_flag boolean not null default false");
    expect(migration).toContain("revoke all on public.op_quality_reviews from public, anon, authenticated");
    expect(migration).not.toMatch(/create policy[^;]*on public\.op_quality_reviews/);
  });
});

// ------------------------------------------------------------------- route

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
const getSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({ createSupabaseServerClient: createSupabaseServerClientMock }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: getSupabaseServerClientMock }));

const { POST: recordReview } = await import("@/app/api/ops/quality-reviews/route");

type ChainResult = { data?: unknown; error?: unknown };
function chain(listResult: ChainResult = { data: [], error: null }, rowResult: ChainResult = { data: { id: "qr-1" }, error: null }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "insert"]) c[m] = vi.fn(() => c);
  c.maybeSingle = vi.fn(async () => rowResult);
  c.single = vi.fn(async () => rowResult);
  (c as { then: unknown }).then = (resolve: (v: ChainResult) => unknown) => Promise.resolve(listResult).then(resolve);
  return c as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
}
function staffCookie() {
  const profile = chain({ data: [], error: null }, { data: { is_admin: true, account_type: "staff" }, error: null });
  createSupabaseServerClientMock.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "staff-1" } } })) },
    from: vi.fn((t: string) => (t === "op_profiles" ? profile : chain()))
  });
}
function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://127.0.0.1:3025/api/ops/quality-reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  createSupabaseServerClientMock.mockReset();
  getSupabaseServerClientMock.mockReset();
  getSupabaseServerClientMock.mockReturnValue(null);
  vi.unstubAllEnvs();
});

describe("quality-reviews route", () => {
  it("records a review and writes one audit row, defaulting retraining on a fail", async () => {
    staffCookie();
    const reviews = chain();
    const audit = chain();
    getSupabaseServerClientMock.mockReturnValue({ from: vi.fn((t: string) => (t === "op_quality_reviews" ? reviews : audit)) });
    const response = await recordReview(
      jsonRequest({ subjectType: "settlement", subjectRef: "pub:123", verdict: "fail", feedback: "graded a void as a loss" })
    );
    expect(response.status).toBe(201);
    const inserted = (reviews.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.subject_type).toBe("settlement");
    expect(inserted.retraining_flag).toBe(true);
    expect(inserted.reviewer_fingerprint).toContain("usr:");
    expect(audit.insert).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown subject before any write", async () => {
    staffCookie();
    const reviews = chain();
    getSupabaseServerClientMock.mockReturnValue({ from: vi.fn(() => reviews) });
    const response = await recordReview(jsonRequest({ subjectType: "vibes", subjectRef: "x", verdict: "pass" }));
    expect(response.status).toBe(400);
    expect(reviews.insert).not.toHaveBeenCalled();
  });

  it("previews in training mode and writes nothing", async () => {
    vi.stubEnv("ODDSPADI_OPS_TRAINING", "1");
    staffCookie();
    const reviews = chain();
    getSupabaseServerClientMock.mockReturnValue({ from: vi.fn(() => reviews) });
    const response = await recordReview(jsonRequest({ subjectType: "mapping", subjectRef: "map:1", verdict: "pass" }));
    expect((await response.json()).status).toBe("training-preview");
    expect(reviews.insert).not.toHaveBeenCalled();
  });
});
