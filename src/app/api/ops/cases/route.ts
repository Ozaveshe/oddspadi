import { requireStaff } from "@/lib/ops/staffAuth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { writeOperatorAudit } from "@/lib/security/operatorAudit";
import {
  applyTransition,
  actionEventType,
  actionRequiresNote,
  isCaseAction,
  CASE_ACTION_TARGET,
  type CaseActionName,
  type CaseSeverity,
  type CaseState,
  type CaseWorkspace
} from "@/lib/ops/cases";
import { classifyCaseSla } from "@/lib/ops/serviceLevels";
import type { CaseCategory } from "@/lib/ops/caseCategories";
import { isEscalationPath, escalationPathForCategory } from "@/lib/ops/escalation";
import { guardCaseAction, assertProductionWriteAllowed, opsMode } from "@/lib/ops/trainingMode";

export const dynamic = "force-dynamic";

const CASE_COLUMNS =
  "id, workspace, source, kind, category, severity, title, state, assignee_fingerprint, due_at, opened_at, escalated_at, resolved_at, resolution, resolved_by";

const SEVERITY_RANK: Record<CaseSeverity, number> = { critical: 0, warning: 1, info: 2 };
const ACTIVE_STATES: CaseState[] = ["open", "acknowledged", "in_progress", "waiting", "escalated"];

function boundedNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 2000 ? trimmed : null;
}

// ------------------------------------------------------------------- GET

export async function GET(request: Request): Promise<Response> {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const client = getSupabaseServerClient();
  if (!client) return privateJson({ error: "Server storage is not configured." }, { status: 503 });

  const params = new URL(request.url).searchParams;
  const workspace = params.get("workspace");
  const stateFilter = params.get("state") ?? "active";

  let query = client.from("op_operational_cases").select(CASE_COLUMNS);
  if (workspace === "market_ops" || workspace === "community") query = query.eq("workspace", workspace);
  if (stateFilter === "active") query = query.in("state", ACTIVE_STATES);
  else if (stateFilter !== "all") query = query.eq("state", stateFilter);

  const { data, error } = await query.limit(500);
  if (error) return databaseUnavailable("ops cases read", error, "The case queue is temporarily unavailable.");

  const now = new Date();
  const rows = (data as Record<string, unknown>[] | null) ?? [];
  const cases = rows
    .map((row) => ({
      id: String(row.id),
      workspace: row.workspace as CaseWorkspace,
      source: String(row.source),
      kind: String(row.kind),
      category: (row.category as string | null) ?? null,
      severity: row.severity as CaseSeverity,
      title: String(row.title),
      state: row.state as CaseState,
      assigneeFingerprint: (row.assignee_fingerprint as string | null) ?? null,
      dueAt: (row.due_at as string | null) ?? null,
      openedAt: String(row.opened_at),
      resolvedAt: (row.resolved_at as string | null) ?? null,
      sla: classifyCaseSla(
        {
          workspace: row.workspace as CaseWorkspace,
          severity: row.severity as CaseSeverity,
          openedAt: String(row.opened_at),
          dueAt: (row.due_at as string | null) ?? null,
          resolvedAt: (row.resolved_at as string | null) ?? null
        },
        now
      )
    }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));

  return privateJson({ cases });
}

// ------------------------------------------------------------------- POST

type CaseRow = {
  id: string;
  workspace: CaseWorkspace;
  category: CaseCategory | null;
  severity: CaseSeverity;
  state: CaseState;
  escalated_at: string | null;
  resolved_by: string | null;
};

function higherSeverity(current: CaseSeverity, candidate: CaseSeverity): CaseSeverity {
  return SEVERITY_RANK[candidate] < SEVERITY_RANK[current] ? candidate : current;
}

export async function POST(request: Request): Promise<Response> {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const client = getSupabaseServerClient();
  if (!client) return privateJson({ error: "Server storage is not configured." }, { status: 503 });

  const parsed = await readBoundedJson<{
    caseId?: unknown;
    action?: unknown;
    note?: unknown;
    assignee?: unknown;
    toSeverity?: unknown;
    escalationPath?: unknown;
  }>(request, 4_096);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const caseId = isUuid(body.caseId) ? (body.caseId as string) : null;
  if (!caseId) return privateJson({ error: "A case id is required." }, { status: 400 });
  if (!isCaseAction(body.action)) return privateJson({ error: "Unknown case action." }, { status: 400 });
  const action: CaseActionName = body.action;

  const note = boundedNote(body.note);
  if (actionRequiresNote(action) && !note) {
    return privateJson({ error: "This action needs a note of 3 to 2000 characters." }, { status: 400 });
  }

  const { data: found, error: readError } = await client
    .from("op_operational_cases")
    .select("id, workspace, category, severity, state, escalated_at, resolved_by")
    .eq("id", caseId)
    .maybeSingle();
  if (readError) return databaseUnavailable("ops case read", readError, "Could not load that case right now.");
  if (!found) return privateJson({ error: "Case not found." }, { status: 404 });
  const current = found as CaseRow;

  const now = new Date();
  const caseUpdate: Record<string, unknown> = {};
  let toState: CaseState | null = null;
  let escalationTarget: string | null = null;

  // Compute the change up front so an illegal transition fails before any write.
  if (action === "claim") {
    caseUpdate.assignee_fingerprint = gate.actorFingerprint;
  } else if (action === "assign") {
    const assignee = typeof body.assignee === "string" ? body.assignee.trim() : "";
    if (assignee.length < 3 || assignee.length > 120) return privateJson({ error: "Provide an assignee." }, { status: 400 });
    caseUpdate.assignee_fingerprint = assignee;
  } else if (action === "quality_review") {
    if (current.state !== "resolved") return privateJson({ error: "Only a resolved case can be quality-reviewed." }, { status: 409 });
    if (current.resolved_by && current.resolved_by === gate.actorFingerprint) {
      return privateJson({ error: "A different reviewer must review this case." }, { status: 403 });
    }
  } else if (action !== "note") {
    toState = CASE_ACTION_TARGET[action];
    if (!toState) return privateJson({ error: "Unknown case action." }, { status: 400 });
    let transition;
    try {
      transition = applyTransition({ state: current.state, escalatedAt: current.escalated_at }, toState, now);
    } catch {
      return privateJson({ error: `Cannot ${action} a case that is ${current.state}.` }, { status: 409 });
    }
    caseUpdate.state = transition.state;
    caseUpdate.resolved_at = transition.resolvedAt;
    caseUpdate.escalated_at = transition.escalatedAt;
    if (action === "resolve" || action === "dismiss") {
      caseUpdate.resolution = note;
      caseUpdate.resolved_by = gate.actorFingerprint;
    }
    if (action === "escalate") {
      // The escalation path is the caller's choice if valid, else the default
      // suggested by the case category. Naming it routes the case to a known
      // owner with an audit trail — the whole point of escalating in-product.
      escalationTarget = isEscalationPath(body.escalationPath)
        ? (body.escalationPath as string)
        : escalationPathForCategory(current.category);
      if (body.toSeverity === "critical" || body.toSeverity === "warning" || body.toSeverity === "info") {
        caseUpdate.severity = higherSeverity(current.severity, body.toSeverity as CaseSeverity);
      }
    }
  }

  const mode = opsMode(process.env);
  const guarded = guardCaseAction(mode, { describe: () => `${action} case ${caseId}`, payload: caseUpdate });
  if (guarded.status === "training-preview") {
    return privateJson({ status: "training-preview", wouldHave: guarded.wouldHave });
  }
  assertProductionWriteAllowed(mode, `case ${action}`);

  // Apply the case change (if any), then always write one timeline event and one
  // operator-audit row — the case row shows current state, the timeline shows how.
  if (Object.keys(guarded.action).length > 0) {
    const { error } = await client.from("op_operational_cases").update(guarded.action).eq("id", caseId);
    if (error) return databaseUnavailable("ops case update", error, "Could not update that case right now.");
  }

  const { error: eventError } = await client.from("op_operational_case_events").insert({
    case_id: caseId,
    actor_fingerprint: gate.actorFingerprint,
    event_type: actionEventType(action),
    from_state: toState ? current.state : null,
    to_state: toState,
    body: note,
    detail:
      action === "escalate"
        ? { toSeverity: caseUpdate.severity ?? current.severity, escalationPath: escalationTarget }
        : {}
  });
  if (eventError) return databaseUnavailable("ops case event", eventError, "The action applied but the timeline write failed; retry.");

  await writeOperatorAudit(client, {
    actorFingerprint: gate.actorFingerprint,
    action: `case_${action}`,
    target: caseId,
    detail: { workspace: current.workspace, toState, escalationPath: escalationTarget },
    outcome: "applied"
  });

  return privateJson(
    { id: caseId, action, state: toState ?? current.state, escalationPath: escalationTarget },
    { status: 201 }
  );
}
