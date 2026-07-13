import type { Metadata } from "next";
import { Suspense } from "react";
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
import { isSupportedSport, todayIsoDate } from "@/lib/sports/service";
import { getCachedPredictionsPageData } from "@/lib/sports/prediction/cachedPublicReads";
import type { Sport } from "@/lib/sports/types";
import { getCachedPublicPredictionHistory } from "@/lib/sports/prediction/cachedPublicReads";
import { RecordStrip } from "@/components/odds/RecordStrip";

export const revalidate = 120;

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

async function LedgerStrip() {
  const ledger = await getCachedPublicPredictionHistory();
  return <RecordStrip items={ledger.items} compact />;
}

async function PredictionsSlate({ date, sport, league, country, confidence, query }: { date: string; sport: Sport; league?: string; country?: string; confidence?: string; query?: string }) {
  const { leagues, countries, rows } = await getCachedPredictionsPageData(date, sport, league, country, confidence, query);
  const previewRows = rows.filter(row => row.match.dataSource?.kind === "mock").length;
  const isPreview = rows.length > 0 && previewRows === rows.length;

  return (
    <>
      {isPreview ? <div className="prediction-provenance preview"><span className="badge scheduled">Seeded preview</span><div><strong>These are model demonstrations, not today&apos;s stored picks.</strong><p>The live provider returned no fixtures in this runtime. Team names, odds and kickoff times below are seeded test data; the Results page never counts them.</p></div></div> : rows.length ? <div className="prediction-provenance live"><span className="badge positive">Provider-backed</span><div><strong>Live fixture identity</strong><p>These matches came from the configured sports providers. Pick publication still depends on the decision engine&apos;s evidence gates.</p></div></div> : null}

      <form
        className="filters"
        data-analytics-event="filter_used"
        data-analytics-source="predictions_page"
      >
        <DateSelector defaultValue={date} />
        <SportFilter selected={sport} />
        <LeagueFilter options={leagues} selected={league} />
        <CountryFilter options={countries} selected={country} />
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
    </>
  );
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
  const label = sportLabel(sport);
  const isToday = date === todayIsoDate();

  // The heading streams immediately; the ledger strip and the provider-backed
  // slate each suspend independently so slow upstream data never blanks the page.
  return (
    <main id="main" className="container" data-analytics-sport={sport} data-analytics-league={league ?? "all"}>
      <div className="page-heading">
        <h1>
          {isToday ? "Today's" : `${date}`} {label} <span className="accent">predictions</span>
        </h1>
        <p>
          Every match, run through the OddsPadi engine: our probabilities next to the bookmakers&apos; odds, with
          confidence, risk, and value clearly marked. Pick a date, filter your league, and dig in.
        </p>
      </div>
      <Suspense fallback={<div className="skeleton" style={{ height: 54 }} aria-hidden="true" />}>
        <LedgerStrip />
      </Suspense>
      <Suspense
        fallback={
          <div className="match-list" aria-busy="true" aria-label="Loading matches">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="skeleton" key={index} style={{ height: 210 }} />
            ))}
          </div>
        }
      >
        <PredictionsSlate date={date} sport={sport} league={league} country={country} confidence={confidence} query={query} />
      </Suspense>

      <PredictionDisclaimer />
    </main>
  );
}
