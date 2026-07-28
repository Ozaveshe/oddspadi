"use client";
import { useEffect, useMemo, useState } from "react";
import type { MatchSummary, PredictionSummary } from "@/lib/sports/prediction/listRow";
import {
  BET_SLIP_CHANGED_EVENT,
  BET_SLIP_MAX_LEGS,
  readSlip,
  slipLegFromPrediction,
  writeSlip
} from "@/lib/sports/betSlip";
import { trackEvent } from "@/lib/analytics/events";

export function AddToSlipButton({ match, prediction, compact = false }: { match: MatchSummary; prediction: PredictionSummary; compact?: boolean }) {
  const leg = useMemo(() => slipLegFromPrediction(match, prediction), [match, prediction]);
  const [added, setAdded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setAdded(Boolean(leg && readSlip().some((item) => item.id === leg.id)));
    sync();
    window.addEventListener(BET_SLIP_CHANGED_EVENT, sync);
    return () => window.removeEventListener(BET_SLIP_CHANGED_EVENT, sync);
  }, [leg]);

  if (!leg) {
    return (
      <span className={`slip-action-lock${compact ? " compact" : ""}`} role="status">
        <strong>{compact ? "Slip locked" : "Slip action locked"}</strong>
        {compact ? null : <span>Only a current, published value pick can be added.</span>}
      </span>
    );
  }

  function toggle() {
    if (!leg) return;
    setNote(null);
    const current = readSlip();
    if (current.some((item) => item.id === leg.id)) {
      if (!writeSlip(current.filter((item) => item.id !== leg.id))) setNote("Could not update your slip on this device.");
      return;
    }

    // Adding replaces any other selection from the same match, so the capacity
    // check runs against the post-replacement slip. `writeSlip` truncates from
    // the front, so without this the new leg was dropped on the floor and the
    // button simply snapped back with no explanation.
    const withoutSameMatch = current.filter((item) => item.matchId !== leg.matchId);
    if (withoutSameMatch.length >= BET_SLIP_MAX_LEGS) {
      setNote(`Your slip is full (${BET_SLIP_MAX_LEGS} legs). Remove one to add this.`);
      return;
    }
    if (!writeSlip([...withoutSameMatch, leg])) {
      setNote("Could not save to your slip on this device.");
      return;
    }
    trackEvent("betslip_pick_added", {
      match_id: leg.matchId,
      sport: match.sport,
      league: match.league.name,
      selection: leg.selection,
      decimal_odds: leg.decimalOdds,
      source: "prediction_surface"
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
        {added ? "Remove from slip" : "+ Add to slip"}
      </button>
      {note ? <span className="muted small" role="status">{note}</span> : null}
    </span>
  );
}
