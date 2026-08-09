/**
 * Operational case domain — pure logic for the human-work layer above the
 * alert queues (op_settlement_exceptions, op_content_reports).
 *
 * A case wraps an alert (or is opened by hand) and adds ownership, an SLA clock
 * and a timeline. This module owns two things the database cannot express:
 * which workspace an alert routes to, and which state transitions are legal.
 * It never mutates an alert or an immutable record — it only computes the shape
 * of the case rows a server route then writes.
 */

import { categoryForExceptionKind, type CaseCategory } from "@/lib/ops/caseCategories";

export type CaseSeverity = "critical" | "warning" | "info";
export type CaseWorkspace = "market_ops" | "community";
export type CaseSource = "reconciler_exception" | "settlement_exception" | "content_report" | "manual";
export type CaseState =
  | "open"
  | "acknowledged"
  | "in_progress"
  | "waiting"
  | "resolved"
  | "dismissed"
  | "escalated";

/** The shape the sync/route inserts — a case not yet given an id by the DB. */
export type NewCase = {
  workspace: CaseWorkspace;
  source: CaseSource;
  kind: string;
  category: CaseCategory;
  severity: CaseSeverity;
  title: string;
  exceptionId: string | null;
  reportId: string | null;
  dueAt: string | null;
  detail: Record<string, unknown>;
};

/** The subset of an op_settlement_exceptions row this module reads. */
export type ExceptionRow = {
  id: string;
  kind: string;
  severity: CaseSeverity;
  detail?: Record<string, unknown> | null;
};

/** Injected so this module does not depend on the SLA policy (Task 2). */
export type DueAtFor = (workspace: CaseWorkspace, severity: CaseSeverity, openedAt: Date) => Date | null;

/**
 * The only community-facing reconciler finding is an orphaned community
 * selection — that is the Social/Community Manager's problem. Every other
 * exception (settlement, closing, mapping, reconciler data mismatches) is the
 * Market Ops Analyst's.
 */
const COMMUNITY_EXCEPTION_KINDS = new Set<string>(["reconciler_orphaned_community_selection"]);

export function workspaceForExceptionKind(kind: string): CaseWorkspace {
  return COMMUNITY_EXCEPTION_KINDS.has(kind) ? "community" : "market_ops";
}

/** "reconciler_missing_closing_price" → "Missing closing price". */
export function humanizeKind(kind: string): string {
  const words = kind.replace(/^reconciler_/, "").replace(/_/g, " ").trim();
  if (!words) return kind;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Map an exception row to a new case. The SLA deadline is computed from when
 * the case opens (`now`), via the injected policy. A reconciler_* kind is a
 * reconciler_exception source; anything else is a settlement_exception.
 */
export function caseFromException(row: ExceptionRow, now: Date, dueAtFor: DueAtFor): NewCase {
  const workspace = workspaceForExceptionKind(row.kind);
  const detail = row.detail ?? {};
  const message = typeof detail.message === "string" && detail.message.length > 0 ? detail.message : null;
  const entity = typeof detail.entity === "string" && detail.entity.length > 0 ? detail.entity : null;
  const dueAt = dueAtFor(workspace, row.severity, now);
  return {
    workspace,
    source: row.kind.startsWith("reconciler_") ? "reconciler_exception" : "settlement_exception",
    kind: row.kind,
    category: categoryForExceptionKind(row.kind),
    severity: row.severity,
    title: message ?? humanizeKind(row.kind),
    exceptionId: row.id,
    reportId: null,
    dueAt: dueAt ? dueAt.toISOString() : null,
    // Affected entities and evidence are first-class case fields; they live in
    // detail (jsonb) so a case never loses the trail back to the alert.
    detail: {
      ...detail,
      exceptionKind: row.kind,
      affectedEntities: entity ? [entity] : [],
      evidence: message ?? humanizeKind(row.kind)
    }
  };
}

/**
 * Legal state transitions. 'resolved' and 'dismissed' are terminal — a
 * recurrence opens a fresh case rather than reopening a closed decision, the
 * same rule the alert queue enforces.
 */
export const CASE_TRANSITIONS: Record<CaseState, readonly CaseState[]> = {
  open: ["acknowledged", "in_progress", "waiting", "resolved", "dismissed", "escalated"],
  acknowledged: ["in_progress", "waiting", "resolved", "dismissed", "escalated"],
  in_progress: ["waiting", "resolved", "dismissed", "escalated"],
  waiting: ["in_progress", "resolved", "dismissed", "escalated"],
  escalated: ["in_progress", "waiting", "resolved", "dismissed"],
  resolved: [],
  dismissed: []
};

export function canTransition(from: CaseState, to: CaseState): boolean {
  return CASE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(state: CaseState): boolean {
  return state === "resolved" || state === "dismissed";
}

export type CaseTransitionResult = {
  state: CaseState;
  resolvedAt: string | null;
  escalatedAt: string | null;
};

export type CaseTransitionInput = {
  state: CaseState;
  escalatedAt?: string | null;
};

/**
 * Apply a transition, returning the fields that change. Throws on an illegal
 * move so a route cannot smuggle a case from resolved back to open. A terminal
 * move stamps resolvedAt; escalation stamps escalatedAt once and keeps it.
 */
export function applyTransition(current: CaseTransitionInput, to: CaseState, now: Date): CaseTransitionResult {
  if (!canTransition(current.state, to)) {
    throw new Error(`illegal case transition: ${current.state} -> ${to}`);
  }
  return {
    state: to,
    resolvedAt: isTerminal(to) ? now.toISOString() : null,
    escalatedAt: to === "escalated" ? now.toISOString() : current.escalatedAt ?? null
  };
}

// ------------------------------------------------------------------- actions

/** The actions a staff member can take on a case from the workspace. */
export type CaseActionName =
  | "claim"
  | "assign"
  | "note"
  | "acknowledge"
  | "start"
  | "wait"
  | "resolve"
  | "dismiss"
  | "escalate"
  | "quality_review";

export const CASE_ACTIONS: readonly CaseActionName[] = [
  "claim",
  "assign",
  "note",
  "acknowledge",
  "start",
  "wait",
  "resolve",
  "dismiss",
  "escalate",
  "quality_review"
];

export function isCaseAction(value: unknown): value is CaseActionName {
  return typeof value === "string" && (CASE_ACTIONS as readonly string[]).includes(value);
}

/** The target state an action moves the case to, or null when it changes no state. */
export const CASE_ACTION_TARGET: Record<CaseActionName, CaseState | null> = {
  claim: null,
  assign: null,
  note: null,
  quality_review: null,
  acknowledge: "acknowledged",
  start: "in_progress",
  wait: "waiting",
  resolve: "resolved",
  dismiss: "dismissed",
  escalate: "escalated"
};

export type CaseEventType =
  | "opened"
  | "note"
  | "assign"
  | "unassign"
  | "state_change"
  | "escalate"
  | "quality_review"
  | "link";

export function actionEventType(action: CaseActionName): CaseEventType {
  if (action === "claim" || action === "assign") return "assign";
  if (action === "note") return "note";
  if (action === "escalate") return "escalate";
  if (action === "quality_review") return "quality_review";
  return "state_change";
}

/** Actions that must carry a note/reason — a resolution or judgement with no words is not accountable. */
export function actionRequiresNote(action: CaseActionName): boolean {
  return action === "note" || action === "resolve" || action === "dismiss" || action === "escalate" || action === "quality_review";
}
