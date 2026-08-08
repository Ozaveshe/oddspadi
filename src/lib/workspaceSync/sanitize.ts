import type { StoredWorkspace } from "@/lib/workspace/store";

/**
 * Sanitisation for workspace payloads crossing a trust boundary.
 *
 * Two boundaries, two functions:
 *
 * - `isSyncableWorkspace` guards what an account accepts INTO private sync.
 *   The shape check keeps a corrupted or hostile client payload from being
 *   stored and later re-served as if it were the user's own data.
 *
 * - `sanitizeForShare` guards what leaves through a share link. A shared view
 *   is a snapshot of *analysis*, so everything else is stripped: free-text
 *   unresolved entries (the closest thing a workspace has to private notes),
 *   and any field outside the explicit whitelist. There is no account
 *   information in a StoredWorkspace by construction, and the whitelist keeps
 *   that true even if a future field forgets.
 */

export function isSyncableWorkspace(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredWorkspace>;
  return (
    typeof candidate.workspaceId === "string" &&
    candidate.workspaceId.length > 0 &&
    candidate.workspaceId.length <= 100 &&
    typeof candidate.name === "string" &&
    candidate.name.length <= 120 &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.selections) &&
    candidate.selections.length <= 20 &&
    candidate.selections.every(
      (selection) =>
        selection &&
        typeof selection === "object" &&
        typeof (selection as { legId?: unknown }).legId === "string" &&
        typeof (selection as { fixtureId?: unknown }).fixtureId === "string" &&
        typeof (selection as { userOdds?: unknown }).userOdds === "number"
    )
  );
}

const SHARED_SELECTION_FIELDS = [
  "legId",
  "fixtureId",
  "marketId",
  "selectionId",
  "canonicalSelectionKey",
  "sport",
  "marketLine",
  "label",
  "fixtureLabel",
  "competition",
  "source",
  "entryPoint",
  "userOdds",
  "oddsObservedAt",
  "marketNoVigProbability",
  "modelProbability",
  "modelGeneratedAt",
  "decisionState",
  "publicationId",
  "kickoffAt",
  "fixtureStatus",
  "marketSupported",
  "modelInterval"
] as const;

function pick<T extends object>(value: T, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in value) out[field] = (value as Record<string, unknown>)[field];
  }
  return out;
}

export type SharedWorkspacePayload = {
  format: "oddspadi-shared-workspace-v1";
  name: string;
  selections: Array<Record<string, unknown>>;
  snapshot: StoredWorkspace["snapshot"];
  sharedAt: string;
};

export function sanitizeForShare(workspace: StoredWorkspace, sharedAt: string): SharedWorkspacePayload {
  return {
    format: "oddspadi-shared-workspace-v1",
    name: workspace.name.trim().slice(0, 80),
    selections: workspace.selections.map((selection) => pick(selection, SHARED_SELECTION_FIELDS)),
    // The frozen snapshot is exactly what a share is for: what the analysis
    // said, when. It contains leg analysis and settlement, nothing personal.
    snapshot: workspace.snapshot ? structuredClone(workspace.snapshot) : null,
    sharedAt
  };
}
