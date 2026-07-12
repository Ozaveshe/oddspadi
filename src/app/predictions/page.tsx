import type { Metadata } from "next";
import {
  ConfidenceFilter,
  CountryFilter,
  DateSelector,
  LeagueFilter,
  SearchBox,
  SportFilter
} from "@/components/odds/Filters";
import { MatchCard } from "@/components/odds/MatchCard";
import { MatchPredictionTable } from "@/components/odds/MatchPredictionTable";
import { EmptyState } from "@/components/odds/EmptyState";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { getPredictions, isSupportedSport, sportsProvider, todayIsoDate } from "@/lib/sports/service";
import type { Sport } from "@/lib/sports/types";

export const metadata: Metadata = {
  title: "Today's Football Predictions — Odds, Probabilities & Value",
  description:
    "Free AI football predictions for today's matches: model probabilities vs bookmaker odds, expected value, confidence and risk — explained in plain language. Basketball and tennis too.",
  alternates: { canonical: "/predictions" },
  openGraph: {
    title: "Today's Football Predictions — OddsPadi",
    description:
      "Free AI predictions for today's matches: probabilities, odds, value edge, confidence and risk — in plain language."
  }
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function sportLabel(sport: Sport): string {
  if (sport === "basketball") return "basketball";
  if (sport === "tennis") return "tennis";
  return "football";
}

export default async function PredictionsPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const date = single(params.date) ?? todayIsoDate();
  const sportParam = single(params.sport);
  const sport = isSupportedSport(sportParam) ? sportParam : "football";
  const league = single(params.league);
  const country = single(params.country);
  const confidence = single(params.confidence);
  const query = single(params.q);
  const [allMatches, rows] = await Promise.all([
    sportsProvider.getFixtures(date, sport),
    getPredictions({ date, sport, league, country, confidence, query, storageMode: "preview" })
  ]);
  const label = sportLabel(sport);

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <h1>
          Today&apos;s {label} <span className="accent">predictions</span>
        </h1>
        <p>
          Every match, run through the OddsPadi engine: our probabilities next to the bookmakers&apos; odds, with
          confidence, risk, and value clearly marked. Pick a date, filter your league, and dig in.
        </p>
      </div>

      <form
        className="filters"
        data-analytics-event="filter_used"
        data-analytics-source="predictions_page"
      >
        <DateSelector defaultValue={date} />
        <SportFilter selected={sport} />
        <LeagueFilter matches={allMatches} selected={league} />
        <CountryFilter matches={allMatches} selected={country} />
        <ConfidenceFilter selected={confidence} />
        <SearchBox defaultValue={query} />
        <button className="button primary" type="submit">
          Apply filters
        </button>
      </form>

      {rows.length ? (
        <>
          <div className="section-title">
            <h2>
              {rows.length} {rows.length === 1 ? "match" : "matches"} for you
            </h2>
            <span className="muted small">Cards up top for a quick look — full table below for the deep divers.</span>
          </div>
          <div className="match-list">
            {rows.slice(0, 8).map((row) => (
              <MatchCard key={row.match.id} match={row.match} prediction={row.prediction} />
            ))}
          </div>
          <section className="section">
            <MatchPredictionTable rows={rows} />
          </section>
        </>
      ) : (
        <EmptyState
          emoji="🔍"
          title="No matches found"
          body="Try another date, league, or search term — or clear the filters to see everything we have today."
        />
      )}

      <PredictionDisclaimer />
    </main>
  );
}
