"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LiveBoardFixture, LiveFixturePhase, LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { useLiveBoard } from "./useLiveBoard";

type TabId = "all" | LiveFixturePhase;

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" },
  { id: "finished", label: "Finished" }
];

function kickoffTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function StatusCell({ fixture }: { fixture: LiveBoardFixture }) {
  if (fixture.phase === "live") {
    return (
      <span className="score-status">
        <span className="minute">{fixture.statusLabel}</span>
      </span>
    );
  }
  if (fixture.phase === "upcoming") {
    return (
      <span className="score-status">
        <span suppressHydrationWarning>{kickoffTime(fixture.kickoff)}</span>
      </span>
    );
  }
  return (
    <span className="score-status">
      <span className="ft">{fixture.statusLabel}</span>
    </span>
  );
}

function TeamLine({ side, phase }: { side: LiveBoardFixture["home"]; phase: LiveFixturePhase }) {
  return (
    <span className={`team-line${side.winner && phase === "finished" ? " winner" : ""}`}>
      {side.logo ? (
        <img className="crest" src={side.logo} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <span className="crest" aria-hidden="true" />
      )}
      <span className="team-name">{side.name}</span>
    </span>
  );
}

function ScoreCell({ fixture }: { fixture: LiveBoardFixture }) {
  if (fixture.phase === "upcoming" || fixture.goals.home === null || fixture.goals.away === null) {
    return <span className="score-vs">vs</span>;
  }
  return (
    <span className={`score-nums${fixture.phase === "live" ? " is-live" : ""}`}>
      <span>{fixture.goals.home}</span>
      <span>{fixture.goals.away}</span>
    </span>
  );
}

function FixtureRow({ fixture }: { fixture: LiveBoardFixture }) {
  const body = (
    <>
      <StatusCell fixture={fixture} />
      <span className="score-teams">
        <TeamLine side={fixture.home} phase={fixture.phase} />
        <TeamLine side={fixture.away} phase={fixture.phase} />
      </span>
      <ScoreCell fixture={fixture} />
    </>
  );

  if (fixture.analysis) {
    return (
      <Link
        className="score-row"
        href={`/predictions/${encodeURIComponent(fixture.matchId)}`}
        title={`${fixture.home.name} vs ${fixture.away.name} — open OddsPadi analysis`}
      >
        {body}
      </Link>
    );
  }

  return <div className="score-row">{body}</div>;
}

type LeagueGroup = {
  key: string;
  league: LiveBoardFixture["league"];
  fixtures: LiveBoardFixture[];
  liveCount: number;
};

function groupByLeague(fixtures: LiveBoardFixture[]): LeagueGroup[] {
  const groups: LeagueGroup[] = [];
  let current: LeagueGroup | null = null;
  for (const fixture of fixtures) {
    const key = `${fixture.league.id}:${fixture.league.name}`;
    if (!current || current.key !== key) {
      current = { key, league: fixture.league, fixtures: [], liveCount: 0 };
      groups.push(current);
    }
    current.fixtures.push(fixture);
    if (fixture.phase === "live") current.liveCount += 1;
  }
  return groups;
}

function BoardSkeleton() {
  return (
    <div className="match-list" aria-hidden="true">
      {[0, 1, 2].map((block) => (
        <div className="league-group" key={block}>
          <div className="skeleton" style={{ height: 42, borderRadius: 0 }} />
          <div style={{ display: "grid", gap: 1 }}>
            {[0, 1, 2, 3].map((row) => (
              <div className="skeleton" key={row} style={{ height: 58, borderRadius: 0 }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIso(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  const today = todayIso();
  if (iso === today) return "Today";
  if (iso === shiftIso(today, -1)) return "Yesterday";
  if (iso === shiftIso(today, 1)) return "Tomorrow";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

const DATE_WINDOW_BACK = 6;
const DATE_WINDOW_FORWARD = 8;

export function LiveScoreBoardView({ initial }: { initial: LiveScoreBoard | null }) {
  const [date, setDate] = useState<string | undefined>(undefined);
  const { board, refreshing, updatedAt, refresh } = useLiveBoard(initial, 45_000, date);
  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");

  const activeDate = date ?? board?.date ?? todayIso();
  const isToday = activeDate === todayIso();
  const minDate = shiftIso(todayIso(), -DATE_WINDOW_BACK);
  const maxDate = shiftIso(todayIso(), DATE_WINDOW_FORWARD);

  const filtered = useMemo(() => {
    const fixtures = board?.fixtures ?? [];
    const search = query.trim().toLowerCase();
    return fixtures.filter((fixture) => {
      if (tab !== "all" && fixture.phase !== tab) return false;
      if (!search) return true;
      return (
        fixture.home.name.toLowerCase().includes(search) ||
        fixture.away.name.toLowerCase().includes(search) ||
        fixture.league.name.toLowerCase().includes(search) ||
        fixture.league.country.toLowerCase().includes(search)
      );
    });
  }, [board, tab, query]);

  const groups = useMemo(() => groupByLeague(filtered), [filtered]);

  if (!board) return <BoardSkeleton />;

  const counts: Record<TabId, number> = {
    all: board.fixtures.length,
    live: board.counts.live,
    upcoming: board.counts.upcoming,
    finished: board.counts.finished,
    other: board.counts.other
  };

  return (
    <div>
      <div className="live-datenav" role="group" aria-label="Choose day">
        <button
          className="button small-btn"
          type="button"
          aria-label="Previous day"
          disabled={activeDate <= minDate}
          onClick={() => setDate(shiftIso(activeDate, -1))}
        >
          ‹
        </button>
        <span className="live-datenav-label">{dayLabel(activeDate)}</span>
        <button
          className="button small-btn"
          type="button"
          aria-label="Next day"
          disabled={activeDate >= maxDate}
          onClick={() => setDate(shiftIso(activeDate, 1))}
        >
          ›
        </button>
        {!isToday ? (
          <button className="button small-btn" type="button" onClick={() => setDate(undefined)}>
            Jump to today
          </button>
        ) : null}
      </div>

      <div className="live-toolbar">
        <div className="seg" role="tablist" aria-label="Filter matches by status">
          {TABS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
              {label}
              <span className="count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="live-search">
          <input
            type="search"
            placeholder="Search team, league or country…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search matches"
          />
        </div>
      </div>

      <div className="live-meta-row" style={{ marginBottom: 14 }}>
        {isToday ? (
          <span className="badge live">Live updates</span>
        ) : (
          <span className="badge finished">{dayLabel(activeDate)} · fixtures &amp; results</span>
        )}
        <span suppressHydrationWarning>
          {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Updating…"}
          {isToday ? " · auto-refreshes every 45s" : ""}
        </span>
        <button className="button small-btn" type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      {board.source === "none" ? (
        <div className="empty-state">
          <div className="empty-emoji">📡</div>
          <h2>Live scores are warming up</h2>
          <p className="muted">{board.note ?? "Scores will appear here as soon as the data feed is connected."}</p>
        </div>
      ) : groups.length ? (
        <div className="match-list">
          {groups.map((group) => (
            <section className="league-group" key={group.key}>
              <header className="league-head">
                {group.league.flag ? (
                  <img className="flag" src={group.league.flag} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : group.league.logo ? (
                  <img className="flag" src={group.league.logo} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : null}
                <span>{group.league.name}</span>
                <span className="league-country">· {group.league.country}</span>
                {group.liveCount ? <span className="league-live-count">{group.liveCount} live</span> : null}
              </header>
              {group.fixtures.map((fixture) => (
                <FixtureRow fixture={fixture} key={fixture.id} />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-emoji">🕐</div>
          <h2>{tab === "live" ? "No matches are live right now" : "Nothing here yet"}</h2>
          <p className="muted">
            {tab === "live"
              ? "Check Upcoming to see what kicks off next — this page refreshes itself."
              : "Try another tab or clear your search."}
          </p>
        </div>
      )}
    </div>
  );
}
