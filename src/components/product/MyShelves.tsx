"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LocalTime } from "@/components/odds/LocalTime";
import { useFollowedTeams } from "@/components/account/FollowedTeamsProvider";
import { BET_SLIP_CHANGED_EVENT } from "@/lib/sports/betSlip";
import { WORKSPACE_CHANGED_EVENT, type StoredWorkspace } from "@/lib/workspace/store";
import { readWorkspacesWithMigration } from "@/lib/workspace/clientState";
import {
  FIXTURE_SHELF_CHANGED_EVENT,
  readRecentFixtures,
  readSavedFixtures,
  toggleSavedFixture,
  type ShelfFixture
} from "@/lib/product/fixtureShelf";

/**
 * The My Padi page body: bet workspace, saved fixtures, recently viewed and
 * followed teams — every shelf keyed on the canonical fixture id and fully
 * usable signed out. Rendered client-side because the first three shelves are
 * the visitor's own localStorage, not server state.
 */
function FixtureRow({ fixture, onRemove }: { fixture: ShelfFixture; onRemove?: () => void }) {
  return (
    <li className="shelf-fixture-row">
      <Link href={`/predictions/${encodeURIComponent(fixture.matchId)}`}>
        <strong>{fixture.matchLabel}</strong>
        <small>
          {fixture.sport} · {fixture.league} · <LocalTime iso={fixture.kickoffTime} variant="kickoff" />
        </small>
      </Link>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${fixture.matchLabel} from saved fixtures`}>
          Remove
        </button>
      ) : null}
    </li>
  );
}

export function MyShelves() {
  const [hydrated, setHydrated] = useState(false);
  const [workspaces, setWorkspaces] = useState<StoredWorkspace[]>([]);
  const [saved, setSaved] = useState<ShelfFixture[]>([]);
  const [recent, setRecent] = useState<ShelfFixture[]>([]);
  const followed = useFollowedTeams();

  useEffect(() => {
    const sync = () => {
      setWorkspaces(readWorkspacesWithMigration(new Date().toISOString()));
      setSaved(readSavedFixtures());
      setRecent(readRecentFixtures());
      setHydrated(true);
    };
    sync();
    window.addEventListener(WORKSPACE_CHANGED_EVENT, sync);
    window.addEventListener(BET_SLIP_CHANGED_EVENT, sync);
    window.addEventListener(FIXTURE_SHELF_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, sync);
      window.removeEventListener(BET_SLIP_CHANGED_EVENT, sync);
      window.removeEventListener(FIXTURE_SHELF_CHANGED_EVENT, sync);
    };
  }, []);

  const activeWorkspaces = workspaces.filter((workspace) => !workspace.archivedAt);
  const legCount = activeWorkspaces.reduce((sum, workspace) => sum + workspace.selections.length, 0);

  return (
    <div className="my-shelves">
      <section className="section" aria-labelledby="my-workspace-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Bet Workspace</span>
            <h2 id="my-workspace-heading">
              {hydrated && legCount
                ? `${legCount} selection${legCount === 1 ? "" : "s"} across ${activeWorkspaces.filter((workspace) => workspace.selections.length).length || 1} workspace${activeWorkspaces.filter((workspace) => workspace.selections.length).length === 1 ? "" : "s"}`
                : "Your workspace is empty"}
            </h2>
          </div>
          <Link className="button primary" href="/predictions/bet-slip">Open workspace</Link>
        </div>
        {hydrated && legCount ? (
          <ul className="shelf-fixture-list">
            {activeWorkspaces
              .flatMap((workspace) => workspace.selections.map((leg) => ({ workspace, leg })))
              .slice(0, 6)
              .map(({ workspace, leg }) => (
                <li key={leg.legId} className="shelf-fixture-row">
                  <Link href={`/predictions/${encodeURIComponent(leg.fixtureId)}`}>
                    <strong>{leg.fixtureLabel}</strong>
                    <small>
                      {workspace.name} · {leg.label} · odds {leg.userOdds.toFixed(2)} · <LocalTime iso={leg.kickoffAt} variant="kickoff" />
                    </small>
                  </Link>
                </li>
              ))}
          </ul>
        ) : (
          <p className="muted small">Add a market from any fixture page — analysis only, nothing is staked. Selections stay on this device.</p>
        )}
      </section>

      <section className="section" aria-labelledby="my-saved-heading">
        <div className="section-title"><div><span className="section-kicker">Saved fixtures</span><h2 id="my-saved-heading">Matches you flagged</h2></div></div>
        {hydrated && saved.length ? (
          <ul className="shelf-fixture-list">
            {saved.map((fixture) => (
              <FixtureRow key={fixture.matchId} fixture={fixture} onRemove={() => toggleSavedFixture(fixture)} />
            ))}
          </ul>
        ) : (
          <p className="muted small">Nothing saved yet. Every fixture page has a ☆ Save button — saved matches wait for you here.</p>
        )}
      </section>

      <section className="section" aria-labelledby="my-recent-heading">
        <div className="section-title"><div><span className="section-kicker">Recently viewed</span><h2 id="my-recent-heading">Pick up where you left off</h2></div></div>
        {hydrated && recent.length ? (
          <ul className="shelf-fixture-list">
            {recent.map((fixture) => (
              <FixtureRow key={fixture.matchId} fixture={fixture} />
            ))}
          </ul>
        ) : (
          <p className="muted small">Fixtures you open will appear here so matchday research survives a closed tab.</p>
        )}
      </section>

      <section className="section" aria-labelledby="my-teams-heading">
        <div className="section-title"><div><span className="section-kicker">Followed teams</span><h2 id="my-teams-heading">Your clubs</h2></div></div>
        {followed.status === "ready" && followed.teams.length ? (
          <div className="followed-team-chips">
            {followed.teams.map((team) => (
              <span key={team.name}>{team.name}</span>
            ))}
          </div>
        ) : followed.status === "ready" ? (
          <p className="muted small">You follow no teams yet — use the search on the homepage to follow your clubs.</p>
        ) : (
          <p className="muted small">
            Following teams syncs across devices with a free account. <Link className="text-link" href="/account">Sign in</Link> — everything else on this page works without one.
          </p>
        )}
      </section>
    </div>
  );
}
