"use client";
import { useEffect, useMemo, useState } from "react";
import type { MatchSummary, PredictionSummary } from "@/lib/sports/prediction/listRow";
import { BET_SLIP_CHANGED_EVENT, readSlip, slipLegFromPrediction, writeSlip } from "@/lib/sports/betSlip";
import { trackEvent } from "@/lib/analytics/events";

export function AddToSlipButton({ match, prediction, compact = false }: { match: MatchSummary; prediction: PredictionSummary; compact?: boolean }) {
  const leg = useMemo(() => slipLegFromPrediction(match, prediction), [match, prediction]); const [added, setAdded] = useState(false);
  useEffect(() => { const sync = () => setAdded(Boolean(leg && readSlip().some((item) => item.id === leg.id))); sync(); window.addEventListener(BET_SLIP_CHANGED_EVENT, sync); return () => window.removeEventListener(BET_SLIP_CHANGED_EVENT, sync); }, [leg]);
  if (!leg) return <span className="muted small">No priced selection for slip</span>;
  function toggle() { if (!leg) return; const current = readSlip(); if (current.some((item) => item.id === leg.id)) writeSlip(current.filter((item) => item.id !== leg.id)); else if (writeSlip([...current.filter((item) => item.matchId !== leg.matchId), leg])) { trackEvent("betslip_pick_added", { match_id: leg.matchId, sport: match.sport, league: match.league.name, selection: leg.selection, decimal_odds: leg.decimalOdds, source: "prediction_surface" }); } }
  return <button className={`button ${added ? "secondary" : "primary"}${compact ? " small-btn" : ""}`} type="button" aria-pressed={added} onClick={toggle}>{added ? "Remove from slip" : "+ Add to slip"}</button>;
}
