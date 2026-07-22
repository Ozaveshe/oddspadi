"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveBoardFixture, LiveFixturePhase, LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { LIVE_BOARD_INITIAL_FIXTURES } from "@/lib/sports/liveBoardPresentation";
import { useLiveBoard } from "./useLiveBoard";
import { useFollowedTeams } from "@/components/account/FollowedTeamsProvider";

type TabId = "all" | LiveFixturePhase;
type SportTab = "all" | LiveBoardFixture["sport"];

const FIXTURE_PAGE_SIZE = LIVE_BOARD_INITIAL_FIXTURES;
// API-Sports currently advertises these crest URLs, but its asset CDN returns
// cached 404s. Keep the honest blank crest instead of requesting a broken
// image or substituting another team's artwork.
const CONFIRMED_MISSING_PROVIDER_ARTWORK = new Set([
  "https://media.api-sports.io/football/teams/28004.png",
  "https://media.api-sports.io/basketball/teams/6301.png",
  "https://media.api-sports.io/basketball/teams/7354.png",
  "https://media.api-sports.io/basketball/teams/7882.png",
  "https://media.api-sports.io/basketball/teams/7889.png"
]);

const SPORT_TABS: Array<{ id: SportTab; label: string; icon: string }> = [
  { id: "all", label: "All sports", icon: "●" },
  { id: "football", label: "Football", icon: "⚽" },
  { id: "basketball", label: "Basketball", icon: "🏀" },
  { id: "tennis", label: "Tennis", icon: "🎾" }
];

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

function isOptimizableProviderImage(src: string): boolean {
  try {
    const url = new URL(src);
    return url.hostname === "media.api-sports.io" && !/\.svg(?:$|\?)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function ProviderArtwork({ src, className, width, height }: { src: string; className: string; width: number; height: number }) {
  if (CONFIRMED_MISSING_PROVIDER_ARTWORK.has(src)) {
    return <span className={className} aria-hidden="true" />;
  }

  if (isOptimizableProviderImage(src)) {
    return (
      <Image
        className={className}
        src={src}
        alt=""
        width={width}
        height={height}
        sizes={`${width}px`}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

function TeamLine({ side, phase }: { side: LiveBoardFixture["home"]; phase: LiveFixturePhase }) {
  return (
    <span className={`team-line${side.winner && phase === "finished" ? " winner" : ""}`}>
      {side.logo ? (
        <ProviderArtwork className="crest" src={side.logo} width={20} height={20} />
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

function FixtureRow({ fixture, isFollowed }: { fixture: LiveBoardFixture; isFollowed: (name: string) => boolean }) {
  const highlighted = isFollowed(fixture.home.name) || isFollowed(fixture.away.name);
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
        className={`score-row${highlighted ? " followed-team-row" : ""}`}
        href={`/predictions/${encodeURIComponent(fixture.matchId)}`}
        data-analytics-event="live_score_opened"
        data-analytics-match-id={fixture.matchId}
        data-analytics-sport={fixture.sport}
        data-analytics-league={fixture.league.name}
        data-analytics-phase={fixture.phase}
        data-analytics-source="live_score_board"
        title={`${fixture.home.name} vs ${fixture.away.name} — open OddsPadi analysis`}
      >
        {body}
      </Link>
    );
  }

  return <div className={`score-row${highlighted ? " followed-team-row" : ""}`}>{body}</div>;
}

type LeagueGroup = {
  key: string;
  league: LiveBoardFixture["league"];
  fixtures: LiveBoardFixture[];
  liveCount: number;
};

export function groupByLeague(fixtures: LiveBoardFixture[]): LeagueGroup[] {
  const groups: LeagueGroup[] = [];
  const groupsByKey = new Map<string, LeagueGroup>();
  for (const fixture of fixtures) {
    const key = `${fixture.sport}:${fixture.league.id}:${fixture.league.country}:${fixture.league.name}`;
    let group = groupsByKey.get(key);
    if (!group) {
      group = { key, league: fixture.league, fixtures: [], liveCount: 0 };
      groupsByKey.set(key, group);
      groups.push(group);
    }
    group.fixtures.push(fixture);
    if (fixture.phase === "live") group.liveCount += 1;
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
  const followed = useFollowedTeams();
  const [date, setDate] = useState<string | undefined>(undefined);
  const { board, refreshing, updatedAt, refresh } = useLiveBoard(initial, 45_000, date);
  const [tab, setTab] = useState<TabId>("all");
  const [sport, setSport] = useState<SportTab>("all");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(LIVE_BOARD_INITIAL_FIXTURES);
  const [completeBoardFailed, setCompleteBoardFailed] = useState(false);
  const loadingCompleteBoardRef = useRef(false);

  const activeDate = date ?? board?.date ?? todayIso();
  const isToday = activeDate === todayIso();
  const minDate = shiftIso(todayIso(), -DATE_WINDOW_BACK);
  const maxDate = shiftIso(todayIso(), DATE_WINDOW_FORWARD);

  const filtered = useMemo(() => {
    const fixtures = board?.fixtures ?? [];
    const search = query.trim().toLowerCase();
    return fixtures.filter((fixture) => {
      if (sport !== "all" && fixture.sport !== sport) return false;
      if (tab !== "all" && fixture.phase !== tab) return false;
      if (!search) return true;
      return (
        fixture.home.name.toLowerCase().includes(search) ||
        fixture.away.name.toLowerCase().includes(search) ||
        fixture.league.name.toLowerCase().includes(search) ||
        fixture.league.country.toLowerCase().includes(search)
      );
    });
  }, [board, sport, tab, query]);

  const totalFixtureCount = board
    ? Math.max(
        board.fixtures.length,
        board.counts.live + board.counts.upcoming + board.counts.finished + board.counts.other
      )
    : 0;
  const boardIsPartial = Boolean(board && board.fixtures.length < totalFixtureCount);
  const requiresCompleteBoard = boardIsPartial && (sport !== "all" || tab !== "all" || query.trim().length > 0);

  const ensureCompleteBoard = useCallback(async () => {
    if (!boardIsPartial || loadingCompleteBoardRef.current) return;
    loadingCompleteBoardRef.current = true;
    setCompleteBoardFailed(false);
    try {
      const succeeded = await refresh();
      if (!succeeded) setCompleteBoardFailed(true);
    } finally {
      loadingCompleteBoardRef.current = false;
    }
  }, [boardIsPartial, refresh]);

  useEffect(() => {
    setVisibleCount(LIVE_BOARD_INITIAL_FIXTURES);
    setCompleteBoardFailed(false);
  }, [activeDate, query, sport, tab]);

  useEffect(() => {
    if (requiresCompleteBoard) void ensureCompleteBoard();
  }, [ensureCompleteBoard, query, requiresCompleteBoard, sport, tab]);

  const visibleFixtures = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const groups = useMemo(() => groupByLeague(visibleFixtures), [visibleFixtures]);
  const visibleResultCount = boardIsPartial && !requiresCompleteBoard ? totalFixtureCount : filtered.length;
  const remainingFixtures = Math.max(0, visibleResultCount - visibleFixtures.length);

  if (!board) return <BoardSkeleton />;

  const counts: Record<TabId, number> = {
    all: totalFixtureCount,
    live: board.counts.live,
    upcoming: board.counts.upcoming,
    finished: board.counts.finished,
    other: board.counts.other
  };

  // Only surface the "Other" bucket (postponed / cancelled / TBD) when it has
  // fixtures — otherwise Live + Upcoming + Finished wouldn't add up to All.
  const visibleTabs = board.counts.other > 0 ? [...TABS, { id: "other" as const, label: "Other" }] : TABS;

  return (
    <div>
      <div className="sport-switcher" role="group" aria-label="Choose sport">
        {SPORT_TABS.map((item) => {
          const count = item.id === "all" ? totalFixtureCount : board.sportCounts[item.id];
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={sport === item.id}
              onClick={() => setSport(item.id)}
              data-analytics-event="filter_used"
              data-analytics-filter-name="live_sport"
              data-analytics-filter-value={item.id}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
              <span className="count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="live-datenav" role="group" aria-label="Choose day">
        <button
          className="button small-btn"
          type="button"
          aria-label="Previous day"
          disabled={activeDate <= minDate}
          onClick={() => setDate(shiftIso(activeDate, -1))}
          data-analytics-event="filter_used"
          data-analytics-filter-name="live_date"
          data-analytics-filter-value="previous"
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
          data-analytics-event="filter_used"
          data-analytics-filter-name="live_date"
          data-analytics-filter-value="next"
        >
          ›
        </button>
        {!isToday ? (
          <button
            className="button small-btn"
            type="button"
            onClick={() => setDate(undefined)}
            data-analytics-event="filter_used"
            data-analytics-filter-name="live_date"
            data-analytics-filter-value="today"
          >
            Jump to today
          </button>
        ) : null}
      </div>

      <div className="live-toolbar">
        <div className="seg" role="group" aria-label="Filter matches by status">
          {visibleTabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              data-analytics-event="filter_used"
              data-analytics-filter-name="live_status"
              data-analytics-filter-value={id}
            >
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

      <div className="live-meta-row" style={{ marginBottom: 14 }} aria-busy={refreshing}>
        {board.source === "none" ? (
          <span className="badge no-value">Feed unavailable</span>
        ) : board.source === "repository" ? (
          <span className="badge scheduled">Stored ingestion feed</span>
        ) : isToday ? (
          <span className="badge live">Live updates</span>
        ) : (
          <span className="badge finished">{dayLabel(activeDate)} · fixtures &amp; results</span>
        )}
        <span suppressHydrationWarning aria-live="polite">
          {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Updating…"}
          {isToday ? " · auto-refreshes every 45s" : ""}
        </span>
        <button className="button small-btn" type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
        {board.note ? <span>{board.note}</span> : null}
      </div>

      {requiresCompleteBoard && !completeBoardFailed ? (
        <div className="empty-state" aria-live="polite">
          <div className="empty-emoji">↻</div>
          <h2>Loading full matchday coverage</h2>
          <p className="muted">Fetching the complete cached board for this filter.</p>
        </div>
      ) : requiresCompleteBoard ? (
        <div className="empty-state" aria-live="polite">
          <div className="empty-emoji">📡</div>
          <h2>Full filtered coverage is temporarily unavailable</h2>
          <p className="muted">The first match window is still intact. Retry when the live feed is reachable.</p>
          <button className="button small-btn" type="button" onClick={() => void ensureCompleteBoard()}>
            Retry full board
          </button>
        </div>
      ) : board.source === "none" ? (
        <div className="empty-state">
          <div className="empty-emoji">📡</div>
          <h2>Live scores are warming up</h2>
          <p className="muted">{board.note ?? "Scores will appear here as soon as the data feed is connected."}</p>
        </div>
      ) : groups.length ? (
        <div className="match-list" aria-live="polite" aria-atomic="false">
          {groups.map((group) => (
            <section className="league-group" key={group.key}>
              <header className="league-head">
                {group.league.flag ? (
                  <ProviderArtwork className="flag" src={group.league.flag} width={20} height={14} />
                ) : group.league.logo ? (
                  <ProviderArtwork className="flag" src={group.league.logo} width={20} height={14} />
                ) : null}
                <span>{group.league.name}</span>
                <span className="league-country">· {group.league.country}</span>
                <span className="league-sport">{group.fixtures[0].sport}</span>
                {group.liveCount ? <span className="league-live-count">{group.liveCount} live</span> : null}
              </header>
              {group.fixtures.map((fixture) => (
                <FixtureRow fixture={fixture} isFollowed={followed.isFollowed} key={fixture.id} />
              ))}
            </section>
          ))}
          {remainingFixtures > 0 ? (
            <div className="live-results-footer" role="status">
              <span>Showing {visibleFixtures.length} of {visibleResultCount} matches</span>
              <button
                className="button small-btn"
                type="button"
                onClick={() => {
                  setVisibleCount((count) => count + FIXTURE_PAGE_SIZE);
                  void ensureCompleteBoard();
                }}
                disabled={refreshing}
              >
                {refreshing && boardIsPartial ? "Loading matches…" : `Show next ${Math.min(FIXTURE_PAGE_SIZE, remainingFixtures)}`}
              </button>
            </div>
          ) : null}
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
