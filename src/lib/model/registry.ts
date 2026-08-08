/**
 * The model registry's lifecycle.
 *
 * Six states, and the transitions between them are a closed list rather than a
 * status column anyone can update. The failure this prevents is not an invalid
 * state — it is an invalid *path*: a candidate reaching `approved` without
 * passing through `shadow`, or a degraded model quietly returning to service
 * because someone set the column back.
 *
 * Every transition demands the evidence that justifies it. Promotion demands
 * the gate result; degradation demands the observation; rollback demands a
 * target that was itself once approved.
 */

export type ModelState = "candidate" | "shadow" | "approved" | "degraded" | "retired" | "rolled_back";

export type ModelRecord = {
  modelId: string;
  state: ModelState;
  /** What the model was built from — the reproducibility spine. */
  datasetVersionId: string;
  featureSetVersion: string;
  hyperparameters: Record<string, unknown>;
  calibrationMethod: string;
  decisionPolicyVersion: string;
  /** Promotion evidence, recorded at the moment of the decision. */
  evaluation: Record<string, unknown> | null;
  approvedAt: string | null;
  approvedBy: string | null;
  /** Where a rollback lands. Only ever a previously approved model. */
  rollbackTargetId: string | null;
  history: Array<{ from: ModelState; to: ModelState; at: string; reason: string }>;
};

/**
 * The allowed paths. Everything else is refused with the reason.
 *
 *   candidate → shadow            (starts observing live fixtures, publishes nothing)
 *   shadow    → approved          (every promotion gate passed)
 *   shadow    → retired           (failed and is done)
 *   approved  → degraded          (monitoring tripped; the model abstains)
 *   approved  → retired           (superseded cleanly)
 *   degraded  → approved          (recovered, re-evidenced)
 *   degraded  → rolled_back       (replaced by its rollback target)
 *   rolled_back → retired         (the episode is closed)
 */
const TRANSITIONS: Record<ModelState, ModelState[]> = {
  candidate: ["shadow"],
  shadow: ["approved", "retired"],
  approved: ["degraded", "retired"],
  degraded: ["approved", "rolled_back"],
  rolled_back: ["retired"],
  retired: []
};

export type TransitionRequest = {
  to: ModelState;
  at: string;
  reason: string;
  /** Required for shadow → approved. */
  gatesPassed?: boolean;
  approvedBy?: string | null;
  /** Required for degraded → rolled_back. */
  rollbackTarget?: { modelId: string; wasApproved: boolean } | null;
};

export type TransitionResult =
  | { ok: true; record: ModelRecord }
  | { ok: false; refusal: string };

export function transition(record: ModelRecord, request: TransitionRequest): TransitionResult {
  const allowed = TRANSITIONS[record.state];
  if (!allowed.includes(request.to)) {
    return {
      ok: false,
      refusal: `${record.state} → ${request.to} is not a path. Allowed from ${record.state}: ${
        allowed.length ? allowed.join(", ") : "nothing — retired is terminal"
      }.`
    };
  }
  if (!request.reason || request.reason.trim().length < 10) {
    return { ok: false, refusal: "A transition requires a stated reason of at least 10 characters." };
  }

  if (request.to === "approved") {
    // From shadow this is promotion; from degraded it is recovery. Both demand
    // the gates, because "it seems fine again" is exactly the evidence-free
    // judgement the gate exists to replace.
    if (request.gatesPassed !== true) {
      return {
        ok: false,
        refusal:
          "Approval requires gatesPassed: true from a promotion-gate run. An unevaluated gate set is not an absence of objection."
      };
    }
    if (!request.approvedBy) {
      return { ok: false, refusal: "Approval requires an approver on the record." };
    }
  }

  if (request.to === "rolled_back") {
    if (!request.rollbackTarget) {
      return { ok: false, refusal: "A rollback requires a target — 'the last thing that worked' is not an identifier." };
    }
    if (!request.rollbackTarget.wasApproved) {
      return {
        ok: false,
        refusal: `Rollback target ${request.rollbackTarget.modelId} was never approved; rolling back onto it would promote it by accident.`
      };
    }
  }

  return {
    ok: true,
    record: {
      ...record,
      state: request.to,
      approvedAt: request.to === "approved" ? request.at : record.approvedAt,
      approvedBy: request.to === "approved" ? (request.approvedBy ?? null) : record.approvedBy,
      rollbackTargetId: request.to === "rolled_back" ? request.rollbackTarget!.modelId : record.rollbackTargetId,
      history: [...record.history, { from: record.state, to: request.to, at: request.at, reason: request.reason }]
    }
  };
}

/** A degraded model must abstain: it keeps its state, loses its voice. */
export function mayPublish(record: ModelRecord): boolean {
  return record.state === "approved";
}

/** A shadow model runs on live fixtures and stores everything, publicly silent. */
export function mayShadow(record: ModelRecord): boolean {
  return record.state === "shadow" || record.state === "approved" || record.state === "degraded";
}
