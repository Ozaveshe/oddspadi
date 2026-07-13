import type { Metadata } from "next";
import { LiveScoreBoardView } from "@/components/live/LiveScoreBoard";
import { fetchLiveScoreBoard } from "@/lib/sports/liveScoreBoard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live sports scores today — football, basketball and tennis",
  description:
    "Follow provider-backed live football, basketball and tennis scores, upcoming fixtures and final results in one matchday board.",
  alternates: { canonical: "/live-scores" },
  openGraph: {
    title: "Live Football Scores Today — OddsPadi",
    description: "Real-time football scores from leagues across Africa, Europe and the world. Updates automatically."
  }
};

export default async function LiveScoresPage() {
  const board = await fetchLiveScoreBoard();

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <h1>
          Live scores, <span className="accent">as they happen</span>
        </h1>
        <p>
          One board for football, basketball and tennis. Switch sports instantly, move across matchdays, and follow
          live games, upcoming starts and final results with crests and flags wherever providers supply them.
        </p>
      </div>

      <LiveScoreBoardView initial={board} />

      <section className="section">
        <div className="notice">
          Spotted a match you want to understand better? Matches with a green analysis link open the OddsPadi engine —
          odds, probabilities, and an honest read on where the value is.
        </div>
      </section>
    </main>
  );
}
