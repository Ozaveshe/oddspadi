"use client";

import { useState } from "react";
import type { WorkspaceFixture, WorkspaceOption } from "@/lib/workspace/options";
import { resolveStructuredLeg } from "@/lib/workspace/resolve";
import { impliedProbability, type CanonicalSelection } from "@/lib/workspace/selection";
import { LocalTime } from "./LocalTime";

export function WorkspaceEntry({ onAdd, onHold }: { onAdd: (selection: CanonicalSelection) => boolean; onHold: (text: string) => boolean }) {
  const [query, setQuery] = useState("");
  const [fixtures, setFixtures] = useState<WorkspaceFixture[]>([]);
  const [options, setOptions] = useState<WorkspaceOption[]>([]);
  const [chosen, setChosen] = useState("");
  const [odds, setOdds] = useState("");
  const [bookmaker, setBookmaker] = useState("");
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const price = Number(odds);
  const validPrice = Number.isFinite(price) && price > 1;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const option = options.find((row) => row.key === chosen);
  async function load(fixtureId?: string) {
    setBusy(true); setObservedAt(null); setMessage(""); setOptions([]); setChosen("");
    try {
      const response = await fetch(`/api/workspace/options?${fixtureId ? `fixtureId=${encodeURIComponent(fixtureId)}` : `q=${encodeURIComponent(query)}`}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Search unavailable.");
      if (fixtureId) { setOptions(body.options); setChosen(body.options[0]?.key ?? ""); }
      else { setFixtures(body.fixtures); if (!body.fixtures.length) setMessage("No upcoming fixtures found. Try another team. Provider access may be unavailable."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Search unavailable."); }
    finally { setBusy(false); }
  }
  function add() {
    if (!option) return;
    const resolved = resolveStructuredLeg({ ...option.input, userOdds: Number(odds), source: bookmaker.trim() || "Your bookmaker",
      oddsObservedAt: observedAt }, `leg-${crypto.randomUUID()}`);
    if (resolved.kind === "rejected") { setMessage(resolved.reason); return; }
    if (!onAdd(resolved.selection)) return;
    setMessage("Selection added. The analysis uses your price and the evidence shown below.");
  }
  return <section className="panel slip-manual-entry" aria-labelledby="workspace-add-heading">
    <h2 id="workspace-add-heading">Evaluate your selection</h2>
    <label htmlFor="workspace-price">Your decimal odds</label>
    <input id="workspace-price" type="number" inputMode="decimal" min="1" step="any" value={odds}
      onChange={(event) => { setOdds(event.target.value); setObservedAt(null); }} />
    <p aria-live="polite">{validPrice
      ? `Break-even chance: ${(100 * impliedProbability(price)).toFixed(1)}%. At these odds, this selection needs to win that often to break even.`
      : odds ? "Enter decimal odds above 1.00." : "Enter your price to see the break-even chance."}</p>
    <label htmlFor="workspace-bookmaker">Bookmaker or price source</label>
    <input id="workspace-bookmaker" maxLength={80} value={bookmaker} onChange={(event) => { setBookmaker(event.target.value); setObservedAt(null); }} />
    <form onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label htmlFor="workspace-team">Find a team or player</label>
      <input id="workspace-team" value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} maxLength={80} required />
      <button className="button" disabled={busy} type="submit">{busy ? "Loading…" : "Find fixtures"}</button>
    </form>
    {validPrice && query.trim() && !option ? <button className="button secondary" type="button" onClick={() => {
      if (onHold(`${query.trim()} @ ${odds}${bookmaker.trim() ? " · " + bookmaker.trim() : ""}`)) setMessage("Saved as an unmatched price note.");
    }}>Save price for later</button> : null}
    {fixtures.map((fixture) => <div key={fixture.id}><p><button className="button secondary" disabled={busy} onClick={() => void load(fixture.id)}>{fixture.label}</button> · {fixture.competition} · <LocalTime iso={fixture.kickoffAt} variant="datetime" /></p><p className="muted small">Fixture last checked: {fixture.lastSyncedAt ? <LocalTime iso={fixture.lastSyncedAt} variant="datetime" /> : "Unknown"}. {Date.now() - Date.parse(fixture.lastSyncedAt) > 6 * 3600000 ? "Schedule data is delayed; confirm kickoff before using it." : ""}</p></div>)}
    {option ? <div>
      <p><strong>{option.input.fixtureLabel}</strong></p>
      <label htmlFor="workspace-market">Exact market and selection</label>
      <select id="workspace-market" value={chosen} onChange={(event) => setChosen(event.target.value)}>{options.map((row) => <option key={row.key} value={row.key}>{row.input.marketId.replaceAll("_", " ")} · {row.input.label}</option>)}</select>
      <label><input type="checkbox" checked={Boolean(observedAt)} onChange={(event) => setObservedAt(event.target.checked ? new Date().toISOString() : null)} /> I checked this price just now</label>
      <p>{option.evidence}</p>
      <button className="button primary" type="button" onClick={add}>Add and evaluate</button>
    </div> : null}
    <p role="status">{message}</p>
  </section>;
}
