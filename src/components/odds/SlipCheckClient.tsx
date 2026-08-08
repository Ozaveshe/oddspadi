"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalTime } from "@/components/odds/LocalTime";
import { analyseWorkspace, freezeWorkspace, settleSnapshot, type PersonalLegOutcome } from "@/lib/workspace/analysis";
import {
  addUnresolvedEntry,
  archiveWorkspace,
  duplicateWorkspace,
  exportWorkspace,
  isFrozen,
  removeSelection,
  removeUnresolvedEntry,
  renameWorkspace,
  unarchiveWorkspace,
  WORKSPACE_CHANGED_EVENT,
  writeWorkspaces,
  type StoredWorkspace
} from "@/lib/workspace/store";
import {
  activeWorkspace,
  newWorkspace,
  readWorkspacesWithMigration,
  upsertWorkspace
} from "@/lib/workspace/clientState";
import { holdUnresolvedText } from "@/lib/workspace/resolve";

/**
 * The Bet Workspace.
 *
 * One coherent analytical surface: structured legs resolved to canonical
 * markets, correlation stated rather than assumed away, personal settlement
 * kept visibly separate from the official OddsPadi record, and a pre-kickoff
 * snapshot that never changes afterwards.
 */

const percent = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;

const BASIS_LABEL: Record<string, string> = {
  "independently-modelled": "Independently modelled",
  "correlation-adjusted": "Correlation adjusted",
  "correlation-unknown": "Correlation unknown",
  "combined-unavailable": "Combined model probability unavailable"
};

const OUTCOME_LABEL: Record<PersonalLegOutcome, string> = {
  won: "Won",
  half_won: "Half won",
  lost: "Lost",
  half_lost: "Half lost",
  push: "Push",
  void: "Void",
  needs_review: "Cannot be graded",
  pending: "Pending"
};

type FixtureState = { status: string; homeScore: number | null; awayScore: number | null };

export function SlipCheckClient() {
  const [workspaces, setWorkspaces] = useState<StoredWorkspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manualText, setManualText] = useState("");
  const [fixtureStates, setFixtureStates] = useState<Record<string, FixtureState>>({});
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      const loaded = readWorkspacesWithMigration(new Date().toISOString());
      setWorkspaces(loaded);
      setSelectedId((current) => current ?? activeWorkspace(loaded)?.workspaceId ?? loaded[0]?.workspaceId ?? null);
    };
    sync();
    window.addEventListener(WORKSPACE_CHANGED_EVENT, sync);
    return () => {
      mounted.current = false;
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, sync);
    };
  }, []);

  // Account sync is additive: signed-in users pull their private copies and
  // merge by recency. Guests simply stay local, which the interface explains.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/workspace/sync");
        if (!response.ok) {
          // Sync unavailable (unconfigured or down) means the device copy is
          // the only copy — which is exactly what guest mode explains.
          if (!cancelled) setAuthenticated(false);
          return;
        }
        const body = (await response.json()) as { authenticated?: boolean; workspaces?: StoredWorkspace[] };
        if (cancelled) return;
        setAuthenticated(Boolean(body.authenticated));
        if (body.authenticated && Array.isArray(body.workspaces) && body.workspaces.length) {
          const local = readWorkspacesWithMigration(new Date().toISOString());
          const byId = new Map(local.map((workspace) => [workspace.workspaceId, workspace]));
          for (const remote of body.workspaces) {
            const existing = byId.get(remote.workspaceId);
            if (!existing || remote.updatedAt > existing.updatedAt) byId.set(remote.workspaceId, remote);
          }
          writeWorkspaces([...byId.values()]);
        }
      } catch {
        // Offline or unconfigured: local mode is the product, not a failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = workspaces.filter((workspace) => (showArchived ? true : !workspace.archivedAt));
  const selected = workspaces.find((workspace) => workspace.workspaceId === selectedId) ?? visible[0] ?? null;
  const analysis = useMemo(
    () => (selected ? analyseWorkspace(selected.selections) : null),
    [selected]
  );
  const frozen = selected ? isFrozen(selected) : false;
  const anyStarted = (analysis?.startedLegCount ?? 0) > 0;

  const commit = useCallback(
    (updated: StoredWorkspace) => {
      const next = upsertWorkspace(readWorkspacesWithMigration(new Date().toISOString()), updated);
      if (!writeWorkspaces(next)) setNote("Could not save on this device.");
    },
    []
  );

  const pushSync = useCallback(async () => {
    if (!authenticated) return;
    setBusy("sync");
    try {
      const current = readWorkspacesWithMigration(new Date().toISOString());
      const response = await fetch("/api/workspace/sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaces: current })
      });
      if (mounted.current) setNote(response.ok ? "Synced privately to your account." : "Sync failed; your device copy is unchanged.");
    } catch {
      if (mounted.current) setNote("Sync failed; your device copy is unchanged.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [authenticated]);

  async function recheck() {
    if (!selected || !selected.selections.length) return;
    setBusy("recheck");
    try {
      const response = await fetch("/api/workspace/recheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureIds: [...new Set(selected.selections.map((leg) => leg.fixtureId))] })
      });
      if (!response.ok) {
        if (mounted.current) setNote("Recheck is unavailable right now.");
        return;
      }
      const body = (await response.json()) as {
        fixtures?: Record<string, { status?: string; homeScore?: number | null; awayScore?: number | null }>;
        officialPublications?: Record<string, { id?: string }>;
      };
      if (!mounted.current) return;
      setFixtureStates(
        Object.fromEntries(
          Object.entries(body.fixtures ?? {}).map(([id, state]) => [
            id,
            { status: String(state.status ?? "unknown"), homeScore: state.homeScore ?? null, awayScore: state.awayScore ?? null }
          ])
        )
      );
      // Lifecycle and official-pick state may update on the live legs; the
      // add-time odds and model figures are evidence and stay as captured.
      if (!frozen) {
        const updated: StoredWorkspace = {
          ...selected,
          selections: selected.selections.map((leg) => {
            const fresh = body.fixtures?.[leg.fixtureId];
            const publication = body.officialPublications?.[leg.fixtureId];
            const status = typeof fresh?.status === "string" ? fresh.status : leg.fixtureStatus;
            return {
              ...leg,
              fixtureStatus: (["scheduled", "delayed", "live", "finished", "postponed", "cancelled", "abandoned", "unknown"] as const).includes(
                status as never
              )
                ? (status as typeof leg.fixtureStatus)
                : leg.fixtureStatus,
              publicationId: publication?.id ?? leg.publicationId
            };
          }),
          updatedAt: new Date().toISOString()
        };
        commit(updated);
      }
      setNote("Rechecked. Prices and model figures shown are still the ones captured when each leg was added.");
    } catch {
      if (mounted.current) setNote("Recheck is unavailable right now.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function settle() {
    if (!selected?.snapshot) return;
    setBusy("settle");
    try {
      const legs = selected.snapshot.analysis.legs.map((leg) => ({
        legId: leg.selection.legId,
        fixtureId: leg.selection.fixtureId,
        canonicalSelectionKey: leg.selection.canonicalSelectionKey ?? null,
        userOdds: leg.selection.userOdds
      }));
      const response = await fetch("/api/workspace/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legs })
      });
      if (!response.ok) {
        if (mounted.current) setNote("Settlement is unavailable right now.");
        return;
      }
      const body = (await response.json()) as {
        settlements?: Array<{ legId: string; outcome: PersonalLegOutcome; detail?: string }>;
        fixtureStates?: Record<string, FixtureState>;
      };
      if (!mounted.current) return;
      if (body.fixtureStates) setFixtureStates(body.fixtureStates);
      if (body.settlements) {
        const settledSnapshot = settleSnapshot(
          selected.snapshot,
          body.settlements.map(({ legId, outcome, detail }) => ({ legId, outcome, detail })),
          new Date().toISOString()
        );
        commit({ ...selected, snapshot: settledSnapshot, updatedAt: new Date().toISOString() });
        setNote("Settled from verified results. This is your personal record, separate from OddsPadi's official track record.");
      }
    } catch {
      if (mounted.current) setNote("Settlement is unavailable right now.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function share() {
    if (!selected) return;
    setBusy("share");
    try {
      const response = await fetch("/api/workspace/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: selected })
      });
      const body = (await response.json()) as { token?: string; path?: string; expiresAt?: string; error?: string };
      if (!mounted.current) return;
      if (!response.ok || !body.token || !body.expiresAt) {
        setNote(body.error ?? "Sharing is unavailable right now.");
        return;
      }
      commit({ ...selected, share: { token: body.token, expiresAt: body.expiresAt }, updatedAt: new Date().toISOString() });
      setNote("Read-only link created. It expires automatically and can be revoked here.");
    } catch {
      if (mounted.current) setNote("Sharing is unavailable right now.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function revokeShare() {
    if (!selected?.share) return;
    setBusy("revoke");
    try {
      const response = await fetch("/api/workspace/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: selected.share.token })
      });
      if (!mounted.current) return;
      if (response.ok) {
        commit({ ...selected, share: null, updatedAt: new Date().toISOString() });
        setNote("Share link revoked. Anyone opening it now sees nothing.");
      } else {
        setNote("Could not revoke the link right now.");
      }
    } catch {
      if (mounted.current) setNote("Could not revoke the link right now.");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  function freeze() {
    if (!selected || !analysis || frozen) return;
    if (anyStarted) {
      setNote("A leg has already started, so a pre-event snapshot can no longer be taken.");
      return;
    }
    const now = new Date().toISOString();
    commit({
      ...selected,
      snapshot: freezeWorkspace(analysis, `snap-${Date.now().toString(36)}`, now),
      updatedAt: now
    });
    setNote("Snapshot frozen. The analysis above is now the permanent pre-event record.");
  }

  function exportJson() {
    if (!selected) return;
    const blob = new Blob([exportWorkspace(selected, new Date().toISOString())], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selected.name.replaceAll(/\s+/g, "-").toLowerCase() || "workspace"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function addManualText() {
    if (!selected || !manualText.trim()) return;
    const now = new Date().toISOString();
    commit(addUnresolvedEntry(selected, holdUnresolvedText(manualText, `note-${Date.now().toString(36)}`, now), now));
    setManualText("");
  }

  if (!selected) {
    return (
      <div className="empty-state">
        <h2>Your workspace is empty</h2>
        <p className="muted">Add modelled selections from Today, Explore or any match page. Analysis only — no account needed, and your selections never become OddsPadi picks.</p>
        <Link className="button primary" href="/predictions">Browse predictions</Link>
      </div>
    );
  }

  const snapshotSettlement = selected.snapshot?.settlement ?? null;
  const displayAnalysis = selected.snapshot ? selected.snapshot.analysis : analysis!;

  return (
    <>
      <section className="panel slip-workspace-bar">
        <label className="small muted" htmlFor="workspace-picker">Workspace</label>
        <select
          id="workspace-picker"
          value={selected.workspaceId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {visible.map((workspace) => (
            <option key={workspace.workspaceId} value={workspace.workspaceId}>
              {workspace.name}
              {workspace.snapshot ? " (frozen)" : ""}
              {workspace.archivedAt ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <div className="card-actions">
          <button className="button secondary" type="button" onClick={() => {
            const now = new Date().toISOString();
            const created = newWorkspace(`ws-${Date.now().toString(36)}`, `Workspace ${workspaces.length + 1}`, now);
            commit(created);
            setSelectedId(created.workspaceId);
          }}>New</button>
          <button className="button secondary" type="button" onClick={() => {
            const name = window.prompt("Rename workspace", selected.name);
            if (name) commit(renameWorkspace(selected, name, new Date().toISOString()));
          }}>Rename</button>
          <button className="button secondary" type="button" onClick={() => {
            const now = new Date().toISOString();
            const copy = duplicateWorkspace(selected, `ws-${Date.now().toString(36)}`, now);
            commit(copy);
            setSelectedId(copy.workspaceId);
          }}>Duplicate</button>
          <button className="button secondary" type="button" onClick={() => {
            const now = new Date().toISOString();
            commit(selected.archivedAt ? unarchiveWorkspace(selected, now) : archiveWorkspace(selected, now));
          }}>{selected.archivedAt ? "Unarchive" : "Archive"}</button>
          <button className="button secondary" type="button" onClick={exportJson}>Export</button>
          <label className="small muted">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived
          </label>
        </div>
      </section>

      <section className="slip-summary panel">
        <div><span className="metric-label">Combined odds</span><strong>{displayAnalysis.combinedBookmakerOdds?.toFixed(2) ?? "—"}</strong></div>
        <div><span className="metric-label">Priced chance</span><strong>{percent(displayAnalysis.naiveImpliedProbability)}</strong></div>
        <div><span className="metric-label">Market chance (no-vig)</span><strong>{percent(displayAnalysis.deViggedMarketProbability)}</strong></div>
        <div>
          <span className="metric-label">Model chance</span>
          <strong>
            {displayAnalysis.combinedModelProbability === null
              ? "Not available"
              : displayAnalysis.combinedModelRange
                ? `${percent(displayAnalysis.combinedModelRange.low)}–${percent(displayAnalysis.combinedModelRange.high)}`
                : percent(displayAnalysis.combinedModelProbability)}
          </strong>
        </div>
        <div><span className="metric-label">Basis</span><strong>{BASIS_LABEL[displayAnalysis.combinationBasis]}</strong></div>
        <div><span className="metric-label">Evidence</span><strong style={{ textTransform: "capitalize" }}>{displayAnalysis.evidenceQuality}</strong></div>
        <div><span className="metric-label">Supported legs</span><strong>{displayAnalysis.supportedLegCount}/{displayAnalysis.legs.length}</strong></div>
        <div><span className="metric-label">Stale legs</span><strong>{displayAnalysis.staleLegCount}</strong></div>
      </section>

      {selected.snapshot ? (
        <p className="slip-verdict">
          Frozen <LocalTime iso={selected.snapshot.takenAt} variant="datetime" /> — this pre-event analysis is immutable.
          {snapshotSettlement?.settledAt ? " Settled from verified results below." : ""}
        </p>
      ) : null}

      {displayAnalysis.legs.length ? <p className="slip-verdict">{displayAnalysis.combinationExplanation}</p> : null}

      {displayAnalysis.correlations.length ? (
        <section className="section" aria-labelledby="slip-correlation-heading">
          <h2 id="slip-correlation-heading" className="section-kicker">Correlation</h2>
          <ul className="slip-correlation-list">
            {displayAnalysis.correlations.map((finding, index) => (
              <li key={`${finding.kind}-${index}`} className={`slip-correlation ${finding.severity}`}>
                {finding.detail}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="slip-legs">
        {displayAnalysis.legs.map((leg) => {
          const live = fixtureStates[leg.selection.fixtureId];
          const outcome = snapshotSettlement?.legOutcomes.find((entry) => entry.legId === leg.selection.legId);
          return (
            <article className="panel slip-leg" key={leg.selection.legId}>
              <div>
                <span className="small muted">{leg.selection.competition} · added from {String(leg.selection.entryPoint ?? "manual").replaceAll("_", " ")}</span>
                <h2>{leg.selection.fixtureLabel}</h2>
                <p>
                  <strong>{leg.selection.label}</strong> · {leg.selection.userOdds.toFixed(2)} ({leg.selection.source}) ·{" "}
                  {percent(leg.impliedProbability)} priced · {percent(leg.noVigProbability)} market no-vig ·{" "}
                  {percent(leg.selection.modelProbability)} model
                  {leg.conservativeProbability !== null ? ` · ${percent(leg.conservativeProbability)} conservative` : ""}
                  {leg.modelFairOdds ? ` · fair ${leg.modelFairOdds.toFixed(2)}` : ""}
                  {leg.expectedValue !== null ? ` · EV ${(leg.expectedValue * 100).toFixed(1)}%` : ""}
                  {leg.uncertaintyWidth !== null ? ` · ±${((leg.uncertaintyWidth / 2) * 100).toFixed(1)}pt band` : ""}
                </p>
                <p className="muted small">{leg.note}</p>
                {leg.isOfficialPick ? (
                  <p className="small"><span className="badge finished">OddsPadi official pick exists on this selection</span></p>
                ) : null}
                {live && (live.status === "live" || live.status === "finished") ? (
                  <p className="small">
                    <span className="badge live">
                      {live.status === "live" ? "In play" : "Finished"}
                      {live.homeScore !== null && live.awayScore !== null ? ` · ${live.homeScore}–${live.awayScore}` : ""}
                    </span>{" "}
                    <span className="muted">Current state — the analysis figures above are the pre-event record.</span>
                  </p>
                ) : null}
                {outcome ? (
                  <p className="small"><strong>Your result: {OUTCOME_LABEL[outcome.outcome]}</strong></p>
                ) : null}
                {leg.diagnostics.length ? (
                  <p className="slip-leg-diagnostics">
                    {leg.diagnostics.map((diagnostic) => (
                      <span className="badge scheduled" key={diagnostic}>{diagnostic.replaceAll("-", " ")}</span>
                    ))}
                  </p>
                ) : null}
              </div>
              <div className="card-actions">
                <Link className="button" href={`/predictions/${encodeURIComponent(leg.selection.fixtureId)}`}>Match Intelligence</Link>
                {!frozen ? (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => commit(removeSelection(selected, leg.selection.legId, new Date().toISOString()))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {(selected.unresolvedEntries ?? []).length ? (
        <section className="section" aria-labelledby="slip-unresolved-heading">
          <h2 id="slip-unresolved-heading" className="section-kicker">Not yet matched to a fixture</h2>
          {(selected.unresolvedEntries ?? []).map((entry) => (
            <article className="panel slip-leg" key={entry.entryId}>
              <div>
                <p><strong>{entry.text}</strong></p>
                <p className="muted small">{entry.reason}</p>
              </div>
              <div className="card-actions">
                <button className="button secondary" type="button" onClick={() => commit(removeUnresolvedEntry(selected, entry.entryId, new Date().toISOString()))}>Remove</button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {!frozen ? (
        <section className="panel slip-manual-entry">
          <label className="small muted" htmlFor="manual-entry-text">Note a selection to match later</label>
          <input
            id="manual-entry-text"
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder="e.g. Arsenal to win @ 1.80"
            maxLength={200}
          />
          <button className="button secondary" type="button" onClick={addManualText}>Hold as note</button>
          <p className="muted small">Free text is kept as a note, not analysed. Pick the exact fixture and market from a match page to include it in the numbers.</p>
        </section>
      ) : null}

      <section className="panel slip-workspace-actions">
        <div className="card-actions">
          <button className="button secondary" type="button" disabled={busy !== null} onClick={recheck}>
            {busy === "recheck" ? "Rechecking…" : "Recheck fixtures"}
          </button>
          {!frozen ? (
            <button className="button primary" type="button" disabled={anyStarted || !displayAnalysis.legs.length} onClick={freeze}>
              Freeze pre-event snapshot
            </button>
          ) : (
            <button className="button primary" type="button" disabled={busy !== null} onClick={settle}>
              {busy === "settle" ? "Settling…" : "Settle from verified results"}
            </button>
          )}
          {selected.share ? (
            <>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}/workspace/shared/${selected.share!.token}`);
                  setNote("Link copied.");
                }}
              >
                Copy share link
              </button>
              <button className="button secondary" type="button" disabled={busy !== null} onClick={revokeShare}>
                {busy === "revoke" ? "Revoking…" : "Revoke share"}
              </button>
            </>
          ) : (
            <button className="button secondary" type="button" disabled={busy !== null} onClick={share}>
              {busy === "share" ? "Creating link…" : "Share read-only"}
            </button>
          )}
          {authenticated ? (
            <button className="button secondary" type="button" disabled={busy !== null} onClick={() => void pushSync()}>
              {busy === "sync" ? "Syncing…" : "Sync to account"}
            </button>
          ) : null}
        </div>
        {selected.share ? (
          <p className="muted small">
            Share link active until <LocalTime iso={selected.share.expiresAt} variant="datetime" />. It shows a read-only
            copy with no account information.
          </p>
        ) : null}
        {note ? <p className="muted small" role="status">{note}</p> : null}
        {authenticated === false ? (
          <p className="muted small">
            Guest mode: workspaces live only in this browser and are lost if its storage is cleared. They are not backed up
            and do not follow you across devices — signing in adds private sync to My Padi, nothing else changes.
          </p>
        ) : null}
        <p className="muted small">
          Your selections are your own analysis. They never become OddsPadi picks and never count toward the official track
          record.
        </p>
      </section>
    </>
  );
}
