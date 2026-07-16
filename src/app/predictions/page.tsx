import type { Metadata } from "next";
import Link from "next/link";
import { DailyTipsSections, ProviderRunStrip } from "@/components/odds/IntelligenceSlate";
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
      <div className="page-heading">
        <span className="section-kicker">Daily sports intelligence</span>
        <h1>Today&apos;s {sportLabel ? <span className="accent">{sportLabel} predictions</span> : <>provider-backed <span className="accent">predictions</span></>}</h1>
        <p>Every available {sportLabel ? `${sportLabel.toLowerCase()} match` : "match"} is run through the OddsPadi engine. Value, leans, watchlists and abstentions stay separate, and a provider failure never turns into a fake fixture.</p>
        <nav className="intelligence-nav" aria-label="Filter predictions by sport">
          {SPORT_VIEWS.map((view) => {
            const active = view.value === requestedSport;
            return <Link key={view.label} className={`button${active ? " primary" : ""}`} href={view.href} aria-current={active ? "page" : undefined}>{view.label}</Link>;
          })}
        </nav>
        <nav className="intelligence-nav" aria-label="Prediction views">
          <Link className="button primary" href="/predictions/today">Daily tips</Link>
          <Link className="button" href="/predictions/week">Weekly preview</Link>
          <Link className="button" href="/predictions/value-picks">Value picks</Link>
          <Link className="button" href="/predictions/history">Results ledger</Link>
        </nav>
      </div>
      <ProviderRunStrip slate={product.slate} />
      <DailyTipsSections product={product} />
      <PredictionDisclaimer sport={requestedSport ?? undefined} />
    </main>
  );
}
