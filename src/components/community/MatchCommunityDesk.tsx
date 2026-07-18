"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommunityPollChoice } from "@/lib/community/predictionContracts";
import { buildConsensusResearchReceipt, type ConsensusDistribution, type ConsensusSide } from "@/lib/community/consensusResearch";

export type CommunityMarketOption = {
  id: string;
  name: string;
  selections: Array<{ id: string; label: string; decimalOdds: number }>;
};

type CommunityPoll = {
  id: string;
  fixture_id: string;
  home_label: string;
  draw_label: string | null;
  away_label: string;
  kickoff_at: string;
  status: "open" | "closed" | "void";
  home_votes: number;
  draw_votes: number;
  away_votes: number;
};

type CommunityTip = {
  id: string;
  author_id: string;
  market: string;
  selection: string;
  selection_label: string;
  tipped_odds: number;
  stake_units: number;
  rationale: string;
  published_at: string;
  author: { username: string; display_name: string | null; avatar_url: string | null } | Array<{ username: string; display_name: string | null; avatar_url: string | null }> | null;
  revisions: Array<{ revision_kind: "correction" | "withdrawal" | "moderation_note"; reason: string; created_at: string }> | null;
  settlement: { result: "won" | "lost" | "push" | "void"; net_units: number; reason: string; settled_at: string } | Array<{ result: "won" | "lost" | "push" | "void"; net_units: number; reason: string; settled_at: string }> | null;
};

type ApiState = "loading" | "ready" | "error";

type Props = {
  fixtureId: string;
  sport: "football" | "basketball" | "tennis";
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  markets: CommunityMarketOption[];
  modelProbabilities?: ConsensusDistribution;
};

function relation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";
}

function readableMarket(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json() as unknown;
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function MatchCommunityDesk({ fixtureId, sport, homeTeam, awayTeam, kickoffAt, markets, modelProbabilities }: Props) {
  const [poll, setPoll] = useState<CommunityPoll | null>(null);
  const [viewerChoice, setViewerChoice] = useState<CommunityPollChoice | null>(null);
  const [pollState, setPollState] = useState<ApiState>("loading");
  const [pollMessage, setPollMessage] = useState<string | null>(null);
  const [voteSaving, setVoteSaving] = useState<CommunityPollChoice | null>(null);
  const [tips, setTips] = useState<CommunityTip[]>([]);
  const [tipsState, setTipsState] = useState<ApiState>("loading");
  const [tipsMessage, setTipsMessage] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [marketId, setMarketId] = useState(markets[0]?.id ?? "");
  const [selectionId, setSelectionId] = useState(markets[0]?.selections[0]?.id ?? "");
  const [stakeUnits, setStakeUnits] = useState("1");
  const [rationale, setRationale] = useState("");
  const [publishState, setPublishState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  const selectedMarket = useMemo(
    () => markets.find((market) => market.id === marketId) ?? markets[0] ?? null,
    [marketId, markets]
  );
  const selectedSelection = useMemo(
    () => selectedMarket?.selections.find((selection) => selection.id === selectionId) ?? selectedMarket?.selections[0] ?? null,
    [selectedMarket, selectionId]
  );

  useEffect(() => {
    if (!selectedMarket) return;
    if (!selectedMarket.selections.some((selection) => selection.id === selectionId)) {
      setSelectionId(selectedMarket.selections[0]?.id ?? "");
    }
  }, [selectedMarket, selectionId]);

  const loadPoll = useCallback(async (signal?: AbortSignal) => {
    setPollState("loading");
    try {
      const response = await fetch(`/api/community/polls?fixtureId=${encodeURIComponent(fixtureId)}`, { signal });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Community pulse is temporarily unavailable.");
      setPoll((payload.poll as CommunityPoll | null | undefined) ?? null);
      setViewerChoice((payload.viewerChoice as CommunityPollChoice | null | undefined) ?? null);
      setPollMessage(typeof payload.note === "string" ? payload.note : null);
      setPollState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPollState("error");
      setPollMessage(error instanceof Error ? error.message : "Community pulse is temporarily unavailable.");
    }
  }, [fixtureId]);

  const loadTips = useCallback(async (signal?: AbortSignal) => {
    setTipsState("loading");
    try {
      const response = await fetch(`/api/community/tips?fixtureId=${encodeURIComponent(fixtureId)}`, { signal });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Community tips are temporarily unavailable.");
      setTips(Array.isArray(payload.tips) ? payload.tips as CommunityTip[] : []);
      setTipsMessage(typeof payload.note === "string" ? payload.note : null);
      setTipsState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setTipsState("error");
      setTipsMessage(error instanceof Error ? error.message : "Community tips are temporarily unavailable.");
    }
  }, [fixtureId]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([loadPoll(controller.signal), loadTips(controller.signal)]);
    return () => controller.abort();
  }, [loadPoll, loadTips]);

  const totalVotes = poll ? poll.home_votes + poll.draw_votes + poll.away_votes : 0;
  const choices = poll ? [
    { id: "home" as const, label: poll.home_label, votes: poll.home_votes },
    ...(poll.draw_label ? [{ id: "draw" as const, label: poll.draw_label, votes: poll.draw_votes }] : []),
    { id: "away" as const, label: poll.away_label, votes: poll.away_votes }
  ] : [];
  const consensusReceipt = useMemo(() => poll && modelProbabilities ? buildConsensusResearchReceipt({
    model: modelProbabilities,
    votes: { home: poll.home_votes, ...(typeof modelProbabilities.draw === "number" ? { draw: poll.draw_votes } : {}), away: poll.away_votes }
  }) : null, [modelProbabilities, poll]);
  const sideLabel = (side: ConsensusSide | null) => side === "home" ? homeTeam : side === "away" ? awayTeam : side === "draw" ? "Draw" : "No sample";
  const leaderProbability = (distribution: ConsensusDistribution | null, side: ConsensusSide | null) => side && distribution ? distribution[side] ?? 0 : null;
  const tipLocked = Date.parse(kickoffAt) <= Date.now() + 30 * 60 * 1000;

  async function castVote(choice: CommunityPollChoice) {
    if (!poll || poll.status !== "open" || voteSaving) return;
    setVoteSaving(choice);
    setPollMessage(null);
    try {
      const response = await fetch("/api/community/polls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pollId: poll.id, choice })
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Could not save that vote.");
      setViewerChoice(choice);
      await loadPoll();
    } catch (error) {
      setPollMessage(error instanceof Error ? error.message : "Could not save that vote.");
    } finally {
      setVoteSaving(null);
    }
  }

  async function publishTip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMarket || !selectedSelection || publishState === "saving") return;
    setPublishState("saving");
    setPublishMessage(null);
    try {
      const response = await fetch("/api/community/tips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fixtureId,
          sport,
          homeTeam,
          awayTeam,
          kickoffAt,
          market: selectedMarket.id,
          selection: selectedSelection.id,
          selectionLabel: selectedSelection.label,
          tippedOdds: selectedSelection.decimalOdds,
          stakeUnits: Number(stakeUnits),
          rationale
        })
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Could not publish that community tip.");
      setPublishState("success");
      setPublishMessage("Tip published to your immutable community record.");
      setRationale("");
      setStakeUnits("1");
      setComposerOpen(false);
      await loadTips();
    } catch (error) {
      setPublishState("error");
      setPublishMessage(error instanceof Error ? error.message : "Could not publish that community tip.");
    }
  }

  return (
    <section className="match-community-desk" aria-labelledby="match-community-title">
      <div className="match-community-heading">
        <div>
          <span className="section-kicker">Community opinion</span>
          <h2 id="match-community-title">What the crowd sees</h2>
          <p>Fan votes and accountable tips sit beside the model, never inside it.</p>
        </div>
        <span className="community-truth-chip">Separate truth lane</span>
      </div>

      <div className="match-community-grid">
        <article className="community-pulse-card" aria-labelledby="fan-pulse-title">
          <header>
            <div><span>01 / fan pulse</span><h3 id="fan-pulse-title">Who wins?</h3></div>
            <strong>{totalVotes}<small> votes</small></strong>
          </header>
          {pollState === "loading" ? (
            <div className="community-skeleton" aria-label="Loading fan pulse"><span /><span /><span /></div>
          ) : poll ? (
            <div className="community-poll-options">
              {choices.map((choice) => (
                <button
                  type="button"
                  key={choice.id}
                  className={viewerChoice === choice.id ? "selected" : ""}
                  aria-pressed={viewerChoice === choice.id}
                  disabled={poll.status !== "open" || Boolean(voteSaving)}
                  onClick={() => void castVote(choice.id)}
                >
                  <span className="community-poll-label"><strong>{choice.label}</strong><b>{percent(choice.votes, totalVotes)}</b></span>
                  <progress max={Math.max(totalVotes, 1)} value={choice.votes}>{percent(choice.votes, totalVotes)}</progress>
                  <small>{voteSaving === choice.id ? "Saving vote…" : `${choice.votes} ${choice.votes === 1 ? "read" : "reads"}`}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="community-empty-compact"><strong>Pulse waiting for fixture sync</strong><p>{pollMessage ?? "The poll opens after this provider fixture is stored."}</p></div>
          )}
          {consensusReceipt ? <aside className="community-consensus-receipt" aria-label="Model and crowd research contrast">
            <header><span>Model / crowd contrast</span><strong>{consensusReceipt.status === "research_ready" ? "Research sample" : consensusReceipt.status === "collecting" ? `${consensusReceipt.voteCount}/${consensusReceipt.minimumVotes} votes` : "Collecting"}</strong></header>
            <div>
              <p><span>Model leads</span><b>{sideLabel(consensusReceipt.modelLeader)}{leaderProbability(consensusReceipt.model, consensusReceipt.modelLeader) !== null ? ` · ${Math.round(leaderProbability(consensusReceipt.model, consensusReceipt.modelLeader)! * 100)}%` : ""}</b></p>
              <p><span>Crowd leads</span><b>{sideLabel(consensusReceipt.crowdLeader)}{leaderProbability(consensusReceipt.crowd, consensusReceipt.crowdLeader) !== null ? ` · ${Math.round(leaderProbability(consensusReceipt.crowd, consensusReceipt.crowdLeader)! * 100)}%` : ""}</b></p>
              <p><span>Divergence</span><b>{consensusReceipt.totalVariation === null ? "—" : `${Math.round(consensusReceipt.totalVariation * 100)}pp`}</b></p>
            </div>
            <small>This is a pre-match research receipt, not a model input. Outcome comparison needs a frozen poll and provider settlement.</small>
          </aside> : null}
          {poll && poll.status !== "open" ? <p className="community-inline-note">Voting is {poll.status}. The final split remains visible.</p> : null}
          {pollMessage && poll ? <p className="community-inline-note" role="status">{pollMessage} {pollMessage.toLowerCase().includes("sign in") ? <Link href="/account">Open account</Link> : null}</p> : null}
          {pollState === "error" && !poll ? <p className="community-inline-note" role="alert">{pollMessage}</p> : null}
        </article>

        <article className="community-tips-card" aria-labelledby="community-tips-title">
          <header>
            <div><span>02 / reasoned tips</span><h3 id="community-tips-title">Tipster notebook</h3></div>
            <strong>{tips.length}<small> published</small></strong>
          </header>
          <div className="community-tip-actions">
            <p>Selections lock 30 minutes before kickoff. Original tips cannot be rewritten after publication.</p>
            <button className="button primary small-btn" type="button" disabled={tipLocked || !markets.length} onClick={() => { setComposerOpen((open) => !open); setPublishMessage(null); setPublishState("idle"); }}>
              {composerOpen ? "Close notebook" : !markets.length ? "Market prices unavailable" : tipLocked ? "Tip window closed" : "Publish your read"}
            </button>
          </div>

          {composerOpen ? (
            <form className="community-tip-composer" onSubmit={publishTip}>
              <div className="community-composer-row">
                <label>Market<select value={marketId} onChange={(event) => setMarketId(event.target.value)}>{markets.map((market) => <option key={market.id} value={market.id}>{market.name}</option>)}</select></label>
                <label>Selection<select value={selectedSelection?.id ?? ""} onChange={(event) => setSelectionId(event.target.value)}>{selectedMarket?.selections.map((selection) => <option key={selection.id} value={selection.id}>{selection.label}</option>)}</select></label>
              </div>
              <div className="community-composer-row compact">
                <label>Quoted odds<output>{selectedSelection?.decimalOdds.toFixed(2) ?? "—"}</output></label>
                <label>Stake units<input type="number" min="0.1" max="10" step="0.1" inputMode="decimal" required value={stakeUnits} onChange={(event) => setStakeUnits(event.target.value)} /></label>
              </div>
              <label>Match-specific reasoning<textarea minLength={50} maxLength={2000} required value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Explain the matchup, price, evidence, and the main way this read could be wrong." /></label>
              <div className="community-composer-footer"><span>{rationale.trim().length} / 2,000 characters · minimum 50</span><button className="button primary" type="submit" disabled={publishState === "saving" || rationale.trim().length < 50}>{publishState === "saving" ? "Publishing…" : "Lock and publish"}</button></div>
            </form>
          ) : null}
          {publishMessage ? <p className={`community-inline-note ${publishState}`} role={publishState === "error" ? "alert" : "status"}>{publishMessage} {publishMessage.toLowerCase().includes("sign in") ? <Link href="/account">Open account</Link> : null}</p> : null}

          {tipsState === "loading" ? (
            <div className="community-skeleton tips" aria-label="Loading community tips"><span /><span /></div>
          ) : tips.length ? (
            <div className="community-tip-list">
              {tips.slice(0, 6).map((tip) => {
                const author = relation(tip.author);
                const settlement = relation(tip.settlement);
                const withdrawn = tip.revisions?.some((revision) => revision.revision_kind === "withdrawal") ?? false;
                return (
                  <article className={`community-tip ${withdrawn ? "withdrawn" : ""}`} key={tip.id}>
                    <div className="community-tip-meta">
                      <div><span>{author ? <Link href={`/community/u/${encodeURIComponent(author.username)}`}>{author.display_name || `@${author.username}`}</Link> : "Community tipster"}</span><time dateTime={tip.published_at}>{new Date(tip.published_at).toLocaleDateString([], { month: "short", day: "numeric" })}</time></div>
                      <span className={`community-tip-result ${settlement?.result ?? (withdrawn ? "void" : "pending")}`}>{withdrawn ? "withdrawn" : settlement?.result ?? "pending"}</span>
                    </div>
                    <div className="community-tip-pick"><span>{readableMarket(tip.market)}</span><strong>{tip.selection_label}</strong><b>{asNumber(tip.tipped_odds).toFixed(2)}</b></div>
                    <p>{tip.rationale}</p>
                    <footer><span>{asNumber(tip.stake_units).toFixed(1)}u recorded</span>{settlement ? <strong className={asNumber(settlement.net_units) >= 0 ? "positive" : "negative"}>{asNumber(settlement.net_units) >= 0 ? "+" : ""}{asNumber(settlement.net_units).toFixed(2)}u</strong> : <span>Awaiting settlement</span>}</footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="community-empty-compact"><strong>No accountable tip yet</strong><p>{tipsMessage ?? "Be the first to publish a priced, reasoned view for this fixture."}</p></div>
          )}
          {tipsState === "error" ? <p className="community-inline-note" role="alert">{tipsMessage}</p> : null}
        </article>
      </div>
      <p className="community-model-boundary"><strong>Model boundary:</strong> votes and community tips never change OddsPadi probability, edge, confidence, publication status, or model accuracy.</p>
    </section>
  );
}
