import type { Metadata } from "next";
import Link from "next/link";
import { DailyDecisionOverview, DailyTipsSections, ProviderRunStrip } from "@/components/odds/IntelligenceSlate";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { getCachedTodayTipsProduct } from "@/lib/sports/tips/publicReads";
import { filterDailyTipsProductBySport } from "@/lib/sports/tips/product";
import type { Sport } from "@/lib/sports/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Today's Provider-Backed Sports Predictions",
  description: "Today's real provider fixtures, model probabilities, fresh odds, value decisions and honest no-pick states from the OddsPadi engine.",
  alternates: { canonical: "/predictions" }
};

type PageProps = { searchParams?: Promise<{ sport?: string | string[] }> };

const SPORT_VIEWS: Array<{ value: Sport | null; label: string; href: string }> = [
  { value: null, label: "All sports", href: "/predictions" },
  { value: "football", label: "Football", href: "/predictions?sport=football" },
  { value: "basketball", label: "Basketball", href: "/predictions?sport=basketball" },
  { value: "tennis", label: "Tennis", href: "/predictions?sport=tennis" }
];

function predictionSport(value: string | string[] | undefined): Sport | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "football" || candidate === "basketball" || candidate === "tennis" ? candidate : null;
}

export default async function PredictionsPage({ searchParams }: PageProps) {
  const requestedSport = predictionSport((await searchParams)?.sport);
  const fullProduct = await getCachedTodayTipsProduct();
  const product = requestedSport ? filterDailyTipsProductBySport(fullProduct, requestedSport) : fullProduct;
  const sportLabel = requestedSport ? requestedSport[0].toUpperCase() + requestedSport.slice(1) : null;
  return (
    <main id="main" className="container">
      <header className="page-heading predictions-heading prediction-desk-heading">
        <div>
          <span className="section-kicker">The Matchday Desk · Today</span>
          <h1>{sportLabel ? <><span className="accent">{sportLabel}</span> decisions</> : <>Today&apos;s match <span className="accent">decisions</span></>}</h1>
        </div>
        <p>Fixture-first model decisions with current prices, evidence quality and an explicit reason when OddsPadi abstains.</p>
      </header>
      <div className="prediction-command-bar">
        <nav className="prediction-filter-row" aria-label="Filter predictions by sport">
          {SPORT_VIEWS.map((view) => {
            const active = view.value === requestedSport;
            return <Link key={view.label} className={active ? "active" : ""} href={view.href} aria-current={active ? "page" : undefined}>{view.label}</Link>;
          })}
        </nav>
        <nav className="prediction-view-row" aria-label="Prediction views">
          <Link href="/predictions/today">Daily</Link>
          <Link href="/predictions/week">Week</Link>
          <Link href="/predictions/value-picks">Published</Link>
          <Link href="/predictions/history">Results</Link>
        </nav>
      </div>
      <DailyDecisionOverview product={product} />
      <DailyTipsSections product={product} />
      <section className="prediction-receipt">
        <div><span className="section-kicker">Data receipt</span><h2>How this slate was built</h2></div>
        <ProviderRunStrip slate={product.slate} />
      </section>
      <PredictionDisclaimer sport={requestedSport ?? undefined} />
    </main>
  );
}
