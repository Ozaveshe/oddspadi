import { readSlip, writeSlip, type SlipLeg } from "@/lib/sports/betSlip";
import {
  MAX_WORKSPACES,
  readWorkspaces,
  writeWorkspaces,
  type StoredWorkspace
} from "@/lib/workspace/store";
import type { CanonicalSelection } from "@/lib/workspace/selection";

/**
 * Client-side workspace state: the "active workspace" concept plus the
 * one-time migration from the original single-slip store.
 *
 * The old store (`oddspadi-bet-slip-v1`) held one anonymous slip. The
 * workspace store holds up to twenty named workspaces. Both existing at once
 * is how the same leg ends up analysed two different ways, so on first read
 * the legacy slip is converted into a workspace — honestly, with its unknown
 * fields left null rather than backfilled — and the legacy key is cleared.
 */

/** Legacy slip legs predate the canonical shape; unknowns stay unknown. */
export function legacySlipLegToSelection(leg: SlipLeg): CanonicalSelection {
  return {
    legId: leg.id,
    fixtureId: leg.matchId,
    marketId: leg.id.split(":")[1] ?? "match_winner",
    selectionId: leg.id.split(":")[2] ?? leg.selection,
    canonicalSelectionKey: null,
    sport: null,
    marketLine: null,
    label: leg.selection,
    fixtureLabel: leg.matchLabel,
    competition: leg.league,
    source: "Stored slip",
    entryPoint: "manual",
    userOdds: leg.decimalOdds,
    oddsObservedAt: null,
    marketNoVigProbability: leg.noVigProbability,
    modelProbability: leg.modelProbability,
    modelGeneratedAt: null,
    decisionState: null,
    publicationId: null,
    kickoffAt: leg.kickoffTime,
    fixtureStatus: "scheduled",
    marketSupported: true,
    modelInterval: null
  };
}

export function newWorkspace(workspaceId: string, name: string, now: string): StoredWorkspace {
  return {
    workspaceId,
    name,
    createdAt: now,
    updatedAt: now,
    selections: [],
    unresolvedEntries: [],
    snapshot: null,
    archivedAt: null
  };
}

/**
 * Read workspaces, importing the legacy slip exactly once.
 *
 * The migration only fires when a legacy slip has legs; the converted
 * workspace preserves them and the legacy key is cleared so nothing is
 * counted twice.
 */
export function readWorkspacesWithMigration(now: string): StoredWorkspace[] {
  const workspaces = readWorkspaces();
  const legacy = readSlip();
  if (!legacy.length) return workspaces;

  const migrated: StoredWorkspace = {
    ...newWorkspace(`ws-${Date.now().toString(36)}`, "My workspace", now),
    selections: legacy.map(legacySlipLegToSelection)
  };
  const combined = [migrated, ...workspaces].slice(0, MAX_WORKSPACES);
  if (writeWorkspaces(combined)) {
    writeSlip([]);
    return combined;
  }
  return workspaces;
}

/** The workspace new legs land in: newest unfrozen, unarchived one. */
export function activeWorkspace(workspaces: StoredWorkspace[]): StoredWorkspace | null {
  const candidates = workspaces
    .filter((workspace) => !workspace.snapshot && !workspace.archivedAt)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return candidates[0] ?? null;
}

export function upsertWorkspace(workspaces: StoredWorkspace[], workspace: StoredWorkspace): StoredWorkspace[] {
  const others = workspaces.filter((entry) => entry.workspaceId !== workspace.workspaceId);
  return [workspace, ...others].slice(0, MAX_WORKSPACES);
}

/** Legs across active (unarchived) workspaces, for the nav chip. */
export function countActiveLegs(workspaces: StoredWorkspace[]): number {
  return workspaces
    .filter((workspace) => !workspace.archivedAt)
    .reduce((sum, workspace) => sum + workspace.selections.length, 0);
}
