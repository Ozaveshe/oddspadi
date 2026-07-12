"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/odds/EmptyState";
import { MatchCard } from "@/components/odds/MatchCard";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import type { Match, Prediction, Sport } from "@/lib/sports/types";
import type { DecisionEngineSearchParams } from "./page";

type PredictionRow = {
  match: Match;
  prediction: Prediction;
};

type EngineLoadState =
  | { status: "loading"; rows: PredictionRow[]; error: null }
  | { status: "ready"; rows: PredictionRow[]; error: null }
  | { status: "failed"; rows: PredictionRow[]; error: string };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isEnabled(value: string | string[] | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((one(value) ?? "").trim().toLowerCase());
}

function isSport(value: string | undefined): value is Sport {
  return value === "football" || value === "basketball" || value === "tennis";
}

function requestHref(params: DecisionEngineSearchParams): string {
  const query = new URLSearchParams();
  const date = one(params.date);
  const sport = one(params.sport);
  const league = one(params.league);
  const country = one(params.country);
  const confidence = one(params.confidence);
  const search = one(params.q);
  if (date) query.set("date", date);
  if (isSport(sport)) query.set("sport", sport);
  if (league) query.set("league", league);
  if (country) query.set("country", country);
  if (confidence) query.set("confidence", confidence);
  if (search) query.set("q", search);
  return `/api/sports/predictions${query.size ? `?${query.toString()}` : ""}`;
}

export function DecisionEngineClient({ params }: { params: DecisionEngineSearchParams }) {
  const requestUrl = useMemo(() => requestHref(params), [params]);
  const [state, setState] = useState<EngineLoadState>({ status: "loading", rows: [], error: null });
  const [attempt, setAttempt] = useState(0);
  const requestedSport = one(params.sport);
  const sport = isSport(requestedSport) ? requestedSport : "football";
  const date = one(params.date) ?? "today";
  const publicHistoryRequested = isEnabled(params.publicHistory) || isEnabled(params.historical);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12_000);
    setState({ status: "loading", rows: [], error: null });

    async function load() {
      try {
        const response = await fetch(requestUrl, { cache: "no-store", signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as { success?: boolean; data?: PredictionRow[]; error?: string } | null;
        if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
          throw new Error(payload?.error || `Live analysis is temporarily unavailable (${response.status}).`);
        }
        if (!controller.signal.aborted) setState({ status: "ready", rows: payload.data, error: null });
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return;
        const message = timedOut
          ? "Live analysis took too long. Please retry in a moment."
          : error instanceof Error
            ? error.message
            : "Live analysis is temporarily unavailable.";
        setState({ status: "failed", rows: [], error: message });
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void load();
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt, requestUrl]);

  const valueRows = state.rows.filter((row) => row.prediction.bestPick.hasValue).length;

  return (
    <main id="main" className="container">
      <header className="page-heading">
        <div className="row-between">
          <div>
            <p className="eyebrow">OddsPadi</p>
            <h1>Decision engine</h1>
          </div>
          <span className={`badge ${state.status === "ready" ? "positive" : state.status === "failed" ? "no-value" : "medium"}`}>
            {state.status === "ready" ? "live" : state.status}
          </span>
        </div>
        <p>Live model probabilities, bookmaker pricing, evidence quality, and risk controls for {sport} on {date}.</p>
      </header>

      <section className="section" aria-label="Decision status">
        <div className="section-title">
          <div>
            <h2>Live slate</h2>
            <p className="muted">Provider-backed fixtures appear when their current evidence has loaded.</p>
          </div>
        </div>
        <div className="metrics-grid">
          <div className="metric">
            <span className="metric-label">Fixtures</span>
            <span className="metric-value">{state.status === "loading" ? "..." : state.rows.length}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Positive value</span>
            <span className="metric-value">{state.status === "loading" ? "..." : valueRows}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Source</span>
            <span className="metric-value">API-Football + Odds</span>
          </div>
          <div className="metric">
            <span className="metric-label">Model policy</span>
            <span className="metric-value">guarded</span>
          </div>
        </div>
      </section>

      {publicHistoryRequested ? (
        <section className="section">
          <div className="notice">
            <strong>Historical evidence is shadow-only.</strong>
            <p>The public ten-season diagnostic is kept out of the live decision request so current fixtures remain responsive.</p>
          </div>
        </section>
      ) : null}

      {state.status === "loading" ? (
        <div className="empty-state" aria-live="polite">
          <h2>Loading live analysis</h2>
          <p className="muted">Checking current fixtures, market odds, and available context.</p>
        </div>
      ) : null}

      {state.status === "failed" ? (
        <div className="empty-state" role="alert">
          <h2>Live analysis could not load</h2>
          <p className="muted">{state.error}</p>
          <button className="button primary" type="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : null}

      {state.status === "ready" && state.rows.length ? (
        <section className="match-list" aria-label="Provider-backed prediction cards">
          {state.rows.slice(0, 12).map((row) => (
            <MatchCard key={row.match.id} match={row.match} prediction={row.prediction} />
          ))}
        </section>
      ) : null}

      {state.status === "ready" && !state.rows.length ? (
        <EmptyState title="No provider-backed fixtures found" body="The engine has not found a live fixture for this date and sport yet." />
      ) : null}

      <PredictionDisclaimer />
    </main>
  );
}
