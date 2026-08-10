import { describe, expect, it } from "vitest";
import {
  workspaceForExceptionKind,
  humanizeKind,
  caseFromException,
  canTransition,
  applyTransition,
  isTerminal,
  CASE_TRANSITIONS,
  type CaseState,
  type DueAtFor
} from "@/lib/ops/cases";

const ALL_STATES: CaseState[] = [
  "open",
  "acknowledged",
  "in_progress",
  "waiting",
  "resolved",
  "dismissed",
  "escalated"
];

// A stub SLA policy: 60 min for market_ops, 120 for community, from `openedAt`.
const stubDueAt: DueAtFor = (workspace, _severity, openedAt) =>
  new Date(openedAt.getTime() + (workspace === "market_ops" ? 60 : 120) * 60_000);

describe("workspace routing", () => {
  it("routes an orphaned community selection to the community workspace", () => {
    expect(workspaceForExceptionKind("reconciler_orphaned_community_selection")).toBe("community");
  });
  it("routes every other exception kind to market ops", () => {
    for (const kind of [
      "reconciler_missing_closing_price",
      "reconciler_result_conflict",
      "result_conflict",
      "close_missing",
      "alias_duplicate"
    ]) {
      expect(workspaceForExceptionKind(kind), kind).toBe("market_ops");
    }
  });
});

describe("caseFromException", () => {
  const now = new Date("2026-08-09T10:00:00.000Z");

  it("maps a reconciler exception to a market-ops case with an SLA deadline", () => {
    const c = caseFromException(
      { id: "exc-1", kind: "reconciler_missing_closing_price", severity: "warning", detail: {} },
      now,
      stubDueAt
    );
    expect(c.workspace).toBe("market_ops");
    expect(c.source).toBe("reconciler_exception");
    expect(c.severity).toBe("warning");
    expect(c.exceptionId).toBe("exc-1");
    expect(c.reportId).toBeNull();
    // 60-min market-ops SLA from `now`.
    expect(c.dueAt).toBe(new Date("2026-08-09T11:00:00.000Z").toISOString());
    // Falls back to a humanized title when detail carries no message.
    expect(c.title).toBe("Missing closing price");
    expect(c.detail.exceptionKind).toBe("reconciler_missing_closing_price");
  });

  it("prefers the sanitised detail.message as the case title", () => {
    const c = caseFromException(
      {
        id: "exc-2",
        kind: "reconciler_orphaned_community_selection",
        severity: "info",
        detail: { message: "Community tip references a fixture with no canonical row" }
      },
      now,
      stubDueAt
    );
    expect(c.workspace).toBe("community");
    expect(c.title).toBe("Community tip references a fixture with no canonical row");
    // 120-min community SLA.
    expect(c.dueAt).toBe(new Date("2026-08-09T12:00:00.000Z").toISOString());
  });

  it("treats a non-reconciler kind as a settlement_exception source", () => {
    const c = caseFromException({ id: "exc-3", kind: "result_conflict", severity: "critical" }, now, stubDueAt);
    expect(c.source).toBe("settlement_exception");
    expect(c.title).toBe("Result conflict");
  });
});

describe("humanizeKind", () => {
  it("strips the reconciler prefix and title-cases", () => {
    expect(humanizeKind("reconciler_model_version_mismatch")).toBe("Model version mismatch");
    expect(humanizeKind("close_missing")).toBe("Close missing");
  });
});

describe("state machine", () => {
  it("allows open -> resolved but rejects resolved -> open", () => {
    expect(canTransition("open", "resolved")).toBe(true);
    expect(canTransition("resolved", "open")).toBe(false);
  });

  it("has terminal resolved and dismissed states", () => {
    expect(isTerminal("resolved")).toBe(true);
    expect(isTerminal("dismissed")).toBe(true);
    expect(CASE_TRANSITIONS.resolved).toEqual([]);
    expect(CASE_TRANSITIONS.dismissed).toEqual([]);
    for (const s of ALL_STATES) {
      expect(canTransition("resolved", s), `resolved -> ${s}`).toBe(false);
      expect(canTransition("dismissed", s), `dismissed -> ${s}`).toBe(false);
    }
  });

  it("only lists states that are themselves valid", () => {
    for (const [from, tos] of Object.entries(CASE_TRANSITIONS)) {
      for (const to of tos) {
        expect(ALL_STATES, `${from} -> ${to}`).toContain(to);
        expect(to, `no self-loop ${from}`).not.toBe(from);
      }
    }
  });

  it("stamps resolvedAt on a terminal transition and leaves it null otherwise", () => {
    const now = new Date("2026-08-09T10:30:00.000Z");
    const resolved = applyTransition({ state: "in_progress" }, "resolved", now);
    expect(resolved.state).toBe("resolved");
    expect(resolved.resolvedAt).toBe(now.toISOString());

    const moved = applyTransition({ state: "open" }, "in_progress", now);
    expect(moved.resolvedAt).toBeNull();
  });

  it("stamps escalatedAt when escalating and preserves it afterwards", () => {
    const t1 = new Date("2026-08-09T10:00:00.000Z");
    const t2 = new Date("2026-08-09T10:45:00.000Z");
    const escalated = applyTransition({ state: "open" }, "escalated", t1);
    expect(escalated.escalatedAt).toBe(t1.toISOString());
    // Moving off escalated keeps the original escalation time.
    const later = applyTransition({ state: "escalated", escalatedAt: t1.toISOString() }, "in_progress", t2);
    expect(later.escalatedAt).toBe(t1.toISOString());
  });

  it("throws on an illegal transition", () => {
    expect(() => applyTransition({ state: "resolved" }, "open", new Date())).toThrow(/illegal case transition/);
  });
});
