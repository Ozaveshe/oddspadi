"use client";
import { useEffect, useMemo, useState } from "react";
import type { MatchSummary, PredictionSummary } from "@/lib/sports/prediction/listRow";
import { addableCandidate, legInputFromPrediction } from "@/lib/workspace/fromPrediction";
import { addSelection, isFrozen, MAX_LEGS, WORKSPACE_CHANGED_EVENT, writeWorkspaces } from "@/lib/workspace/store";
import {
  activeWorkspace,
  newWorkspace,
  readWorkspacesWithMigration,
  upsertWorkspace
} from "@/lib/workspace/clientState";
import type { LegEntryPoint } from "@/lib/workspace/selection";
import { trackEvent } from "@/lib/analytics/events";

/**
 * Adds a modelled candidate to the active Bet Workspace.
 *
 * The candidate may be an official pick, a lean, or a watchlist candidate —
 * the leg records which, and adding it never creates or alters an official
 * pick. New legs land in the newest unfrozen workspace, or a fresh one when
 * none exists.
 */
export function AddToSlipButton({
  match,
  prediction,
  compact = false,
  entryPoint = "match_intelligence"
}: {
  match: MatchSummary;
  prediction: PredictionSummary;
  compact?: boolean;
  entryPoint?: LegEntryPoint;
}) {
  const candidate = useMemo(() => addableCandidate(prediction), [prediction]);
  const legKey = candidate ? `${match.id}:${candidate.marketId}:${candidate.selectionId}` : null;
  const [added, setAdded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      if (!legKey) return setAdded(false);
      const workspace = activeWorkspace(readWorkspacesWithMigration(new Date().toISOString()));
      setAdded(Boolean(workspace?.selections.some((item) => item.legId === legKey)));
    };
    sync();
    window.addEventListener(WORKSPACE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, sync);
  }, [legKey]);

  if (!candidate || !legKey) {
    return (
      <span className={`slip-action-lock${compact ? " compact" : ""}`} role="status">
        <strong>{compact ? "Workspace locked" : "Workspace action locked"}</strong>
        {compact ? null : <span>Only a current modelled candidate can be added.</span>}
      </span>
    );
  }

  function toggle() {
    setNote(null);
    const now = new Date().toISOString();
    const workspaces = readWorkspacesWithMigration(now);
    let target = activeWorkspace(workspaces);

    if (target && target.selections.some((item) => item.legId === legKey)) {
      const updated = {
        ...target,
        selections: target.selections.filter((item) => item.legId !== legKey),
        updatedAt: now
      };
      if (!writeWorkspaces(upsertWorkspace(workspaces, updated))) setNote("Could not update your workspace on this device.");
      return;
    }

    const resolved = legInputFromPrediction(match, prediction, entryPoint, legKey!);
    if (!resolved || resolved.kind === "rejected") {
      setNote(resolved?.kind === "rejected" ? resolved.reason : "This candidate could not be added.");
      return;
    }

    if (!target) target = newWorkspace(`ws-${Date.now().toString(36)}`, "My workspace", now);
    if (isFrozen(target)) {
      setNote("This workspace is frozen. Duplicate it to keep working.");
      return;
    }
    if (target.selections.length >= MAX_LEGS) {
      setNote(`This workspace is full (${MAX_LEGS} legs). Remove a leg to add this.`);
      return;
    }

    const updated = addSelection(target, resolved.selection, now);
    if (!writeWorkspaces(upsertWorkspace(workspaces, updated))) {
      setNote("Could not save to your workspace on this device.");
      return;
    }
    trackEvent("betslip_pick_added", {
      match_id: match.id,
      sport: match.sport,
      league: match.league.name,
      selection: resolved.selection.label,
      decimal_odds: resolved.selection.userOdds,
      source: entryPoint
    });
  }

  return (
    <span className="slip-action">
      <button
        className={`button ${added ? "secondary" : "primary"}${compact ? " small-btn" : ""}`}
        type="button"
        aria-pressed={added}
        onClick={toggle}
      >
        {added ? "Remove from workspace" : "+ Add to workspace"}
      </button>
      {note ? <span className="muted small" role="status">{note}</span> : null}
    </span>
  );
}
