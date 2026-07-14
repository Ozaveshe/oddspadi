import type { Metadata } from "next";
import Link from "next/link";
import { ProviderRunStrip, WeeklySlateSections } from "@/components/odds/IntelligenceSlate";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { TipsSharePreview } from "@/components/odds/TipsSharePreview";
import { getWeeklyTipsProduct } from "@/lib/sports/tips/product";
import { formatWeeklyRadarPost } from "@/lib/sports/tips/social";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Weekly Sports Predictions — Next 7 Days",
  description: "Provider-backed upcoming fixtures grouped by date with preliminary, ready, value, lean, watchlist, stale and settled statuses.",
  alternates: { canonical: "/predictions/week" },
  openGraph: {
    title: "OddsPadi Weekly Predictions — Next 7 Days",
    description: "Upcoming provider fixtures with preliminary, ready, value, lean, watchlist, stale and settled states.",
    url: "/predictions/week"
  }
};

export default async function WeeklyPredictionsPage() {
  const product = await getWeeklyTipsProduct();
  return (
    <main id="main" className="container">
      <div className="page-heading tips-heading">
        <span className="section-kicker">Seven-day intelligence window</span>
        <h1>Weekly Predictions</h1>
        <p>Weekly predictions start preliminary and get refreshed as odds, injuries, lineups, and results change.</p>
        <nav className="intelligence-nav"><Link className="button" href="/predictions/today">Today&apos;s tips</Link><Link className="button" href="/predictions/tomorrow">Tomorrow&apos;s tips</Link><Link className="button" href="/predictions/history">Results</Link></nav>
      </div>
      <ProviderRunStrip slate={product.slate} />
      <WeeklySlateSections product={product} />
      <TipsSharePreview formats={[{ id: "weekly-radar", label: "Weekly Radar", text: formatWeeklyRadarPost(product) }]} />
      <PredictionDisclaimer />
    </main>
  );
}
