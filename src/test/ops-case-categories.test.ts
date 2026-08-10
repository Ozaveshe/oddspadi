import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CASE_CATEGORIES,
  categoryForExceptionKind,
  categoryForReport,
  isCaseCategory,
  humanizeCategory
} from "@/lib/ops/caseCategories";
import { caseFromException, type DueAtFor } from "@/lib/ops/cases";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260809180000_case_categories.sql"),
  "utf8"
);

const stubDue: DueAtFor = (_w, _s, openedAt) => new Date(openedAt.getTime() + 60 * 60_000);

describe("case categories", () => {
  it("defines exactly the twelve named categories", () => {
    expect([...CASE_CATEGORIES].sort()).toEqual(
      [
        "community_abuse",
        "content_error",
        "identity_mismatch",
        "market_mismatch",
        "missing_close",
        "provider_outage",
        "record_mismatch",
        "result_conflict",
        "settlement_exception",
        "stale_fixture",
        "stale_odds",
        "user_report"
      ].sort()
    );
    expect(CASE_CATEGORIES.length).toBe(12);
  });

  it("maps representative exception kinds to the right category", () => {
    expect(categoryForExceptionKind("close_market_unmapped")).toBe("market_mismatch");
    expect(categoryForExceptionKind("close_missing")).toBe("missing_close");
    expect(categoryForExceptionKind("close_late_data")).toBe("stale_odds");
    expect(categoryForExceptionKind("missing_participant_identity")).toBe("identity_mismatch");
    expect(categoryForExceptionKind("reconciler_result_conflict")).toBe("result_conflict");
    expect(categoryForExceptionKind("reconciler_missing_closing_price")).toBe("missing_close");
    expect(categoryForExceptionKind("reconciler_route_error_spike")).toBe("provider_outage");
    expect(categoryForExceptionKind("reconciler_unsettled_final_fixture")).toBe("settlement_exception");
  });

  it("falls back to record_mismatch for an unknown kind, never undefined", () => {
    expect(categoryForExceptionKind("something_new")).toBe("record_mismatch");
    expect(isCaseCategory(categoryForExceptionKind("something_new"))).toBe(true);
  });

  it("routes abuse reports to community_abuse and the rest to user_report", () => {
    for (const c of ["scam_or_paid_tips", "guaranteed_win_claim", "impersonation", "harassment", "unsafe_link"]) {
      expect(categoryForReport(c), c).toBe("community_abuse");
    }
    expect(categoryForReport("spam")).toBe("user_report");
    expect(categoryForReport("other")).toBe("user_report");
  });

  it("humanizes a category label", () => {
    expect(humanizeCategory("missing_close")).toBe("Missing close");
  });
});

describe("caseFromException carries category, evidence and affected entities", () => {
  it("sets the category and lifts the entity + message into the case detail", () => {
    const c = caseFromException(
      {
        id: "exc-1",
        kind: "reconciler_missing_closing_price",
        severity: "warning",
        detail: { entity: "publication:99", message: "No current closing price captured" }
      },
      new Date("2026-08-09T10:00:00.000Z"),
      stubDue
    );
    expect(c.category).toBe("missing_close");
    expect(c.detail.affectedEntities).toEqual(["publication:99"]);
    expect(c.detail.evidence).toBe("No current closing price captured");
  });

  it("still produces a valid category and empty affected list when detail is bare", () => {
    const c = caseFromException({ id: "exc-2", kind: "result_conflict", severity: "critical" }, new Date(), stubDue);
    expect(c.category).toBe("result_conflict");
    expect(c.detail.affectedEntities).toEqual([]);
  });
});

describe("case-categories migration", () => {
  it("adds the category column with the twelve-value check and recreates the RPC with p_category", () => {
    expect(migration).toContain("add column if not exists category text");
    expect(migration).toContain("op_operational_cases_category_check");
    for (const category of CASE_CATEGORIES) {
      expect(migration, `check must allow ${category}`).toContain(`'${category}'`);
    }
    expect(migration).toContain("p_category text default null");
    expect(migration).toContain("drop function if exists public.op_upsert_operational_case(text, text, text, text, text, uuid, uuid, timestamptz, jsonb, text)");
  });
});
