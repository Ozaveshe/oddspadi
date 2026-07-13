import type { Metadata } from "next";
import { EmptyState } from "@/components/odds/EmptyState";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { ValuePickCard } from "@/components/odds/ValuePickCard";
import { unstable_cache } from "next/cache";
import { getValuePicks, todayIsoDate } from "@/lib/sports/service";
import { getCachedPublicPredictionHistory } from "@/lib/sports/prediction/cachedPublicReads";
import { toPredictionListRow } from "@/lib/sports/prediction/listRow";
import { RecordStrip } from "@/components/odds/RecordStrip";

// Durable across serverless invocations (unlike the in-memory provider cache),
// and slimmed to the fields ValuePickCard renders so the RSC payload stays small.
const getCachedValuePickRows = unstable_cache(
  async (date: string) => {
    const rows = await getValuePicks(date, "football", "live", "preview");
    return rows.map(toPredictionListRow);
  },
  ["value-picks-rows-v1"],
  { revalidate: 300 }
);

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Today's Best Football Value Picks — Free AI Selections",
  description:
    "Free football value picks for today, chosen by AI: only matches where our model's probability beats the bookmaker's price after removing the margin. Sorted by expected value.",
  alternates: { canonical: "/predictions/value-picks" },
  openGraph: {
    title: "Today's Best Football Value Picks — OddsPadi",
    description:
      "Only picks where the numbers genuinely favour you — positive value edge, positive expected value, decent confidence. Nothing forced."
  }
};

export default async function ValuePicksPage() {
  const [rows, ledger] = await Promise.all([getCachedValuePickRows(todayIsoDate()), getCachedPublicPredictionHistory()]);

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <h1>
          Today&apos;s <span className="accent">value picks</span>
        </h1>
        <p>
          These are the matches where the numbers genuinely lean your way: our model&apos;s probability beats the
          bookmaker&apos;s price even after their margin is removed. Sorted by expected value — the best value sits on
          top.
        </p>
      </div>
      <RecordStrip items={ledger.items} compact />

      {rows.length ? (
        <div className="match-list">
          {rows.map((row) => (
            <ValuePickCard key={row.match.id} match={row.match} prediction={row.prediction} />
          ))}
        </div>
      ) : (
        <EmptyState
          emoji="🧐"
          title="No value picks right now"
          body="When the edge isn't clear, we don't force a pick — that's a promise, not a bug. Check back closer to kickoff, or browse today's full predictions."
          actionHref="/predictions"
          actionLabel="See today's full slate"
        />
      )}

      <section className="section">
        <PredictionDisclaimer />
      </section>
    </main>
  );
}
