"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WORKSPACE_CHANGED_EVENT } from "@/lib/workspace/store";
import { readWorkspacesWithMigration } from "@/lib/workspace/clientState";
import { buildPersonalRecord, PERSONAL_RECORD_SEPARATION_COPY, type PersonalRecord } from "@/lib/personal/record";

/**
 * The personal record: the user's own settled selections, aggregated.
 * Never rendered next to official model figures without the separation
 * sentence — that sentence is the boundary, stated every time.
 */

const PAGE_SIZE = 10;

export function PersonalRecordPanel() {
  const [record, setRecord] = useState<PersonalRecord | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const sync = () => setRecord(buildPersonalRecord(readWorkspacesWithMigration(new Date().toISOString())));
    sync();
    window.addEventListener(WORKSPACE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, sync);
  }, []);

  if (!record) return null;

  const settled = record.entries.filter((entry) => entry.outcome !== "pending");
  const pageEntries = settled.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(settled.length / PAGE_SIZE));

  return (
    <section className="section" aria-labelledby="my-record-heading">
      <div className="section-title">
        <div>
          <span className="section-kicker">Personal record</span>
          <h2 id="my-record-heading">Your own selections</h2>
        </div>
      </div>

      {!record.entries.length ? (
        <p className="muted small">
          Freeze and settle a Bet Workspace and your personal results collect here.{" "}
          <Link className="text-link" href="/predictions/bet-slip">Open the workspace</Link>.
        </p>
      ) : (
        <>
          <div className="slip-summary panel">
            <div><span className="metric-label">Settled</span><strong>{record.settledCount}</strong></div>
            <div><span className="metric-label">Won</span><strong>{record.wins}</strong></div>
            <div><span className="metric-label">Lost</span><strong>{record.losses}</strong></div>
            <div><span className="metric-label">One-unit result</span><strong>{record.oneUnitTotal >= 0 ? "+" : ""}{record.oneUnitTotal.toFixed(2)}</strong></div>
            <div>
              <span className="metric-label">Streak</span>
              <strong>{record.currentStreak === 0 ? "—" : record.currentStreak > 0 ? `W${record.currentStreak}` : `L${-record.currentStreak}`}</strong>
            </div>
            <div><span className="metric-label">Pending</span><strong>{record.pendingCount}</strong></div>
          </div>

          {record.bySport.length ? (
            <p className="muted small">
              By sport:{" "}
              {record.bySport
                .map((group) => `${group.key} ${group.wins}/${group.settled} (${group.oneUnitTotal >= 0 ? "+" : ""}${group.oneUnitTotal.toFixed(2)}u)`)
                .join(" · ")}
            </p>
          ) : null}
          {record.byMarket.length ? (
            <p className="muted small">
              By market:{" "}
              {record.byMarket
                .slice(0, 5)
                .map((group) => `${group.key} ${group.wins}/${group.settled}`)
                .join(" · ")}
            </p>
          ) : null}

          {pageEntries.length ? (
            <ul className="shelf-fixture-list">
              {pageEntries.map((entry) => (
                <li key={`${entry.workspaceId}-${entry.legId}`} className="shelf-fixture-row">
                  <span>
                    <strong>{entry.selectionLabel} — {entry.outcome.replaceAll("_", " ")}</strong>
                    <small>
                      {entry.fixtureLabel} · {entry.odds.toFixed(2)} odds
                      {entry.oneUnitResult !== null ? ` · ${entry.oneUnitResult >= 0 ? "+" : ""}${entry.oneUnitResult.toFixed(2)}u` : ""}
                      {entry.note ? ` · note: ${entry.note}` : ""}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No settled selections yet — pending legs appear once their matches resolve.</p>
          )}

          {pageCount > 1 ? (
            <div className="card-actions">
              <button className="button secondary" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                Newer
              </button>
              <span className="muted small">Page {page + 1} of {pageCount}</span>
              <button
                className="button secondary"
                type="button"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((value) => value + 1)}
              >
                Older
              </button>
            </div>
          ) : null}
        </>
      )}

      <p className="muted small">{PERSONAL_RECORD_SEPARATION_COPY}</p>
    </section>
  );
}
