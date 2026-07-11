import type { Metadata } from "next";
import { LiveScoreBoardView } from "@/components/live/LiveScoreBoard";
import { fetchLiveScoreBoard } from "@/lib/sports/liveScoreBoard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live Football Scores Today — Real-Time Results",
  description:
    "Follow live football scores in real time: Premier League, Champions League, CAF competitions, NPFL and leagues across Africa and Europe. Scores update automatically, minute by minute.",
  alternates: { canonical: "/live-scores" },
  openGraph: {
    title: "Live Football Scores Today — OddsPadi",
    description: "Real-time football scores from leagues across Africa, Europe and the world. Updates automatically."
  }
};

export default async function LiveScoresPage() {
  const board = await fetchLiveScoreBoard();

  return (
    <main className="container">
      <div className="page-heading">
        <h1>
          Live scores, <span className="accent">as they happen</span>
        </h1>
        <p>
          Every goal, minute by minute — from the Premier League and Champions League to CAF competitions and leagues
          across Africa. The page refreshes itself, so just sit back and follow your team.
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
