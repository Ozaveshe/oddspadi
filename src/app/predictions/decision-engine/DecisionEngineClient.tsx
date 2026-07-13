"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/odds/EmptyState";
import { MatchCard } from "@/components/odds/MatchCard";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import type { PredictionListRow } from "@/lib/sports/prediction/listRow";
import type { Sport } from "@/lib/sports/types";
import type { DecisionEngineSearchParams } from "./page";

type EngineLoadState =
  | { status: "loading"; rows: PredictionListRow[]; error: null }
  | { status: "ready"; rows: PredictionListRow[]; error: null }
  | { status: "failed"; rows: PredictionListRow[]; error: string };

const SPORTS: Array<{ id: Sport; label: string }> = [
  { id: "football", label: "Football" },
  { id: "basketball", label: "Basketball" },
  { id: "tennis", label: "Tennis" }
];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isEnabled(value: string | string[] | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((one(value) ?? "").trim().toLowerCase());
}

function isSport(value: string | undefined): value is Sport {
  return value === "football" || value === "basketball" || value === "tennis";
}

function requestHref(params: DecisionEngineSearchParams, sport: Sport): string {
  const query = new URLSearchParams();
  const date = one(params.date);
  const league = one(params.league);
  const country = one(params.country);
  const confidence = one(params.confidence);
  const search = one(params.q);
  if (date) query.set("date", date);
  query.set("sport", sport);
  if (league) query.set("league", league);
  if (country) query.set("country", country);
  if (confidence) query.set("confidence", confidence);
  if (search) query.set("q", search);
  query.set("view", "summary");
  return `/api/sports/predictions?${query.toString()}`;
}

async function fetchRows(url: string, signal: AbortSignal): Promise<PredictionListRow[]> {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = (await response.json().catch(() => null)) as { success?: boolean; data?: PredictionListRow[]; error?: string } | null;
  if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
    throw new Error(payload?.error || `Live analysis is temporarily unavailable (${response.status}).`);
  }
  return payload.data;
}

export function DecisionEngineClient({ params }: { params: DecisionEngineSearchParams }) {
  const requestedSport = one(params.sport);
  const explicitSport = isSport(requestedSport) ? requestedSport : null;
  const [sport, setSport] = useState<Sport>(explicitSport ?? "football");
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [state, setState] = useState<EngineLoadState>({ status: "loading", rows: [], error: null });
  const [attempt, setAttempt] = useState(0);
  const requestUrl = useMemo(() => requestHref(params, sport), [params, sport]);
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
        let rows = await fetchRows(requestUrl, controller.signal);
        // Off-season honesty: when the visitor didn't pick a sport and the
        // default slate is empty (e.g. football in July), look for a sport
        // that actually has fixtures instead of rendering a dead page. Probe
        // the other sports in parallel; prefer them in SPORTS order.
        if (!rows.length && !explicitSport) {
          const candidates = SPORTS.filter((item) => item.id !== sport);
          const probes = await Promise.all(
            candidates.map((candidate) => fetchRows(requestHref(params, candidate.id), controller.signal).catch(() => []))
          );
          const found = candidates.findIndex((_, index) => probes[index].length > 0);
          if (found >= 0) {
            rows = probes[found];
            if (!controller.signal.aborted) {
              setAutoNote(`No provider-backed ${sport} fixtures today — showing live ${candidates[found].id} instead.`);
              setSport(candidates[found].id);
            }
          }
        }
        if (!controller.signal.aborted) setState({ status: "ready", rows, error: null });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      <div className="filters" role="group" aria-label="Choose a sport">
        {SPORTS.map((item) => (
          <button
            key={item.id}
            className={`button small-btn${item.id === sport ? " primary" : ""}`}
            type="button"
            aria-pressed={item.id === sport}
            onClick={() => {
              setAutoNote(null);
              setSport(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {autoNote ? <div className="notice" aria-live="polite">{autoNote}</div> : null}

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
            <span className="metric-value">Sports providers + odds</span>
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
        <EmptyState
          title={`No provider-backed ${sport} fixtures found`}
          body="The engine has not found a live fixture for this date and sport yet. Big European football leagues pause in summer — try basketball, or check back when the season resumes."
        />
      ) : null}

      <PredictionDisclaimer />
    </main>
  );
}
