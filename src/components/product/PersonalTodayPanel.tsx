"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LocalTime } from "@/components/odds/LocalTime";
import { getPreferredTimeZone } from "@/components/odds/LocalTime";
import { useFollowedTeams } from "@/components/account/FollowedTeamsProvider";
import {
  GUEST_PERSISTENCE_COPY,
  PERSONAL_PREFERENCES_EVENT,
  readPersonalPreferences,
  toggleFollow,
  writePersonalPreferences
} from "@/lib/personal/preferences";

/**
 * "Today for you": the follows-driven matchday view on My Padi.
 *
 * One prepared summary request, bounded server-side; the panel renders what
 * came back and distinguishes three states that must never blur — nothing
 * followed, nothing on today for what is followed, and the read failing.
 */

type SummaryFixture = {
  external_id: string;
  sport: string;
  status: string;
  kickoff_at: string;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
};

type SummaryPublication = {
  publicationId: string;
  fixtureExternalId: string | null;
  sport: string;
  selectionLabel: string | null;
  publishedAt: string | null;
  settlementStatus: string;
  settledAt: string | null;
};

type Summary = {
  authenticated: boolean;
  followedFixtures: {
    availability: "complete" | "unavailable" | "not_followed";
    today: SummaryFixture[];
    live: SummaryFixture[];
    watchlistStates: Record<string, string>;
  };
  officialPublications: {
    availability: string;
    latest: SummaryPublication[];
    recentSettlements: SummaryPublication[];
  };
};

const WATCHLIST_LABEL: Record<string, string> = {
  value_pick: "Official pick",
  lean: "Lean",
  watchlist: "On the watchlist",
  no_clear_value: "No clear value",
  preliminary: "Preliminary",
  needs_data: "Awaiting data",
  stale: "Stale",
  suspended: "Suspended"
};

export function PersonalTodayPanel() {
  const followed = useFollowedTeams();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [preferencesVersion, setPreferencesVersion] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const bump = () => setPreferencesVersion((value) => value + 1);
    window.addEventListener(PERSONAL_PREFERENCES_EVENT, bump);
    return () => {
      mounted.current = false;
      window.removeEventListener(PERSONAL_PREFERENCES_EVENT, bump);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const preferences = readPersonalPreferences();
        const guestTeamNames = followed.status === "ready" ? followed.teams.map((team) => team.name) : preferences.followedTeams;
        const response = await fetch("/api/my/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timezone: getPreferredTimeZone(),
            follows: {
              teamNames: guestTeamNames,
              competitions: preferences.followedCompetitions,
              sports: preferences.followedSports
            }
          })
        });
        if (cancelled || !mounted.current) return;
        if (!response.ok) {
          setFailed(true);
          return;
        }
        setSummary((await response.json()) as Summary);
        setFailed(false);
      } catch {
        if (!cancelled && mounted.current) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [followed, preferencesVersion]);

  const preferences = readPersonalPreferences();
  const followsAnything =
    preferences.followedSports.length > 0 ||
    preferences.followedCompetitions.length > 0 ||
    preferences.followedTeams.length > 0 ||
    (followed.status === "ready" && followed.teams.length > 0);

  return (
    <section className="section" aria-labelledby="my-today-heading">
      <div className="section-title">
        <div>
          <span className="section-kicker">Today for you</span>
          <h2 id="my-today-heading">Your followed matchday</h2>
        </div>
      </div>

      {!followsAnything ? (
        <div>
          <p className="muted small">
            Follow a competition or sport and today&apos;s relevant fixtures appear here. {GUEST_PERSISTENCE_COPY}
          </p>
          <div className="followed-team-chips">
            {["Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1"].map((competition) => (
              <button
                key={competition}
                type="button"
                className="button secondary"
                onClick={() => writePersonalPreferences(toggleFollow(readPersonalPreferences(), "competition", competition))}
              >
                + {competition}
              </button>
            ))}
          </div>
        </div>
      ) : failed ? (
        <p className="muted small" role="status">
          Your matchday view could not load just now. Nothing is wrong with your follows — retry shortly.
        </p>
      ) : !summary ? (
        <p className="muted small">Loading your matchday…</p>
      ) : summary.followedFixtures.availability === "unavailable" ? (
        <p className="muted small" role="status">The fixture read failed; this is a data problem, not an empty day.</p>
      ) : !summary.followedFixtures.today.length ? (
        <p className="muted small">Nothing you follow plays today. Followed competitions: {preferences.followedCompetitions.join(", ") || "—"}.</p>
      ) : (
        <ul className="shelf-fixture-list">
          {summary.followedFixtures.today.map((fixture) => {
            const watchState = summary.followedFixtures.watchlistStates[fixture.external_id];
            return (
              <li key={fixture.external_id} className="shelf-fixture-row">
                <Link href={`/predictions/${encodeURIComponent(fixture.external_id)}`}>
                  <strong>
                    {fixture.home_team_name ?? "Home"} vs {fixture.away_team_name ?? "Away"}
                    {fixture.status === "live" ? (
                      <span className="badge live"> LIVE {fixture.home_score ?? "–"}–{fixture.away_score ?? "–"}</span>
                    ) : null}
                  </strong>
                  <small>
                    {fixture.league_name ?? fixture.sport} · <LocalTime iso={fixture.kickoff_at} variant="kickoff" />
                    {watchState && WATCHLIST_LABEL[watchState] ? ` · ${WATCHLIST_LABEL[watchState]}` : ""}
                  </small>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {summary?.officialPublications.latest.length ? (
        <div className="section">
          <span className="section-kicker">New official publications</span>
          <ul className="shelf-fixture-list">
            {summary.officialPublications.latest.slice(0, 5).map((publication) => (
              <li key={publication.publicationId} className="shelf-fixture-row">
                <Link href={publication.fixtureExternalId ? `/predictions/${encodeURIComponent(publication.fixtureExternalId)}` : "/predictions/value-picks"}>
                  <strong>{publication.selectionLabel ?? "Official pick"}</strong>
                  <small>
                    {publication.sport}
                    {publication.publishedAt ? <> · published <LocalTime iso={publication.publishedAt} variant="datetime" /></> : null}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary?.officialPublications.recentSettlements.length ? (
        <div className="section">
          <span className="section-kicker">Recent settlements</span>
          <ul className="shelf-fixture-list">
            {summary.officialPublications.recentSettlements.slice(0, 5).map((publication) => (
              <li key={`settled-${publication.publicationId}`} className="shelf-fixture-row">
                <Link href={publication.fixtureExternalId ? `/predictions/${encodeURIComponent(publication.fixtureExternalId)}` : "/predictions/history"}>
                  <strong>{publication.selectionLabel ?? "Official pick"} — {publication.settlementStatus.replaceAll("_", " ")}</strong>
                  <small>{publication.settledAt ? <>settled <LocalTime iso={publication.settledAt} variant="datetime" /></> : null}</small>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
