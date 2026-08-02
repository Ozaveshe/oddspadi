import type { CanonicalSelection } from "@/lib/workspace/selection";
import type { WorkspaceSnapshot } from "@/lib/workspace/analysis";

/**
 * Guest-first workspace persistence.
 *
 * Everything lives on the visitor's device. Two consequences the rest of the
 * product depends on: the workspace is useful without an account, and a user
 * selection can never reach the publication ledger — there is no write path
 * from here to any official table.
 */
export const WORKSPACE_STORAGE_KEY = "oddspadi-workspaces-v1";
export const WORKSPACE_CHANGED_EVENT = "oddspadi:workspace-changed";
export const MAX_WORKSPACES = 20;
export const MAX_LEGS = 20;

export type StoredWorkspace = {
  workspaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  selections: CanonicalSelection[];
  /** Frozen once the first leg kicks off. Never edited afterwards. */
  snapshot: WorkspaceSnapshot | null;
};

function isSelection(value: unknown): value is CanonicalSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanonicalSelection>;
  return (
    typeof candidate.legId === "string" &&
    typeof candidate.fixtureId === "string" &&
    typeof candidate.marketId === "string" &&
    typeof candidate.selectionId === "string" &&
    typeof candidate.userOdds === "number" &&
    Number.isFinite(candidate.userOdds) &&
    candidate.userOdds > 1 &&
    typeof candidate.kickoffAt === "string"
  );
}

function isWorkspace(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredWorkspace>;
  return (
    typeof candidate.workspaceId === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.selections) &&
    candidate.selections.every(isSelection)
  );
}

export function readWorkspaces(): StoredWorkspace[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isWorkspace).slice(0, MAX_WORKSPACES) : [];
  } catch {
    return [];
  }
}

export function writeWorkspaces(workspaces: StoredWorkspace[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaces.filter(isWorkspace).slice(0, MAX_WORKSPACES)));
    window.dispatchEvent(new Event(WORKSPACE_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/**
 * A frozen workspace is history.
 *
 * Once the snapshot exists, the leg list is closed: editing it would change
 * what the record says was analysed before kickoff, which is the one thing a
 * historical workspace exists to preserve.
 */
export function isFrozen(workspace: StoredWorkspace): boolean {
  return workspace.snapshot !== null;
}

export function addSelection(workspace: StoredWorkspace, selection: CanonicalSelection, now: string): StoredWorkspace {
  if (isFrozen(workspace)) return workspace;
  if (workspace.selections.length >= MAX_LEGS) return workspace;
  // Re-adding the same selection replaces it rather than duplicating, so a
  // refreshed price updates the leg instead of creating a second one.
  const withoutDuplicate = workspace.selections.filter(
    (entry) =>
      !(entry.fixtureId === selection.fixtureId && entry.marketId === selection.marketId && entry.selectionId === selection.selectionId)
  );
  return { ...workspace, selections: [...withoutDuplicate, selection], updatedAt: now };
}

export function removeSelection(workspace: StoredWorkspace, legId: string, now: string): StoredWorkspace {
  if (isFrozen(workspace)) return workspace;
  return { ...workspace, selections: workspace.selections.filter((entry) => entry.legId !== legId), updatedAt: now };
}

export function replaceSelection(workspace: StoredWorkspace, legId: string, replacement: CanonicalSelection, now: string): StoredWorkspace {
  if (isFrozen(workspace)) return workspace;
  return {
    ...workspace,
    selections: workspace.selections.map((entry) => (entry.legId === legId ? replacement : entry)),
    updatedAt: now
  };
}

export function duplicateWorkspace(workspace: StoredWorkspace, workspaceId: string, now: string): StoredWorkspace {
  return {
    workspaceId,
    name: `${workspace.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    selections: workspace.selections.map((entry) => ({ ...entry })),
    // A copy starts unfrozen: it is a new analysis, not a second copy of a
    // historical record.
    snapshot: null
  };
}
