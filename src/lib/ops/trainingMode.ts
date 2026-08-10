/**
 * Training-mode boundary.
 *
 * A staff member learning the workspace must be able to click every button
 * without changing production. Training mode is that boundary: a guarded action
 * returns a *preview* of what it would have done and hands back NO payload to
 * persist, and a belt-and-braces assert throws if any production write is
 * attempted while training. The shape mirrors writeExceptions({persist:false}):
 * the same call site works in both modes, and the mode — not the caller's
 * discipline — decides whether a row is ever written.
 */

export type OpsMode = "live" | "training";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isTrainingMode(env: Record<string, string | undefined>): boolean {
  const raw = env.ODDSPADI_OPS_TRAINING;
  return typeof raw === "string" && TRUTHY.has(raw.trim().toLowerCase());
}

export function opsMode(env: Record<string, string | undefined>): OpsMode {
  return isTrainingMode(env) ? "training" : "live";
}

/** A planned mutation: a human description and the payload a live run would apply. */
export type PlannedAction<T> = { describe: () => string; payload: T };

export type CaseActionResult<T> =
  | { status: "live"; action: T }
  | { status: "training-preview"; wouldHave: string };

/**
 * In training mode, return a preview and withhold the payload entirely — there
 * is nothing for the caller to persist. In live mode, hand back the payload to
 * apply.
 */
export function guardCaseAction<T>(mode: OpsMode, planned: PlannedAction<T>): CaseActionResult<T> {
  if (mode === "training") return { status: "training-preview", wouldHave: planned.describe() };
  return { status: "live", action: planned.payload };
}

export class TrainingViolation extends Error {
  constructor(detail: string) {
    super(`training mode may not write to production: ${detail}`);
    this.name = "TrainingViolation";
  }
}

/**
 * Call this immediately before any op_* write. It throws in training mode, so a
 * write path that forgot to branch on guardCaseAction fails loudly rather than
 * silently mutating production.
 */
export function assertProductionWriteAllowed(mode: OpsMode, detail = "case action"): void {
  if (mode === "training") throw new TrainingViolation(detail);
}
