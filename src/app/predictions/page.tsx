import type { Metadata } from "next";
import Link from "next/link";
import { DailyTipsSections, ProviderRunStrip } from "@/components/odds/IntelligenceSlate";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { getDailyTipsProduct } from "@/lib/sports/tips/product";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Today's Provider-Backed Sports Predictions",
  description: "Today's real provider fixtures, model probabilities, fresh odds, value decisions and honest no-pick states from the OddsPadi engine.",
  alternates: { canonical: "/predictions" }
};

export default async function PredictionsPage() {
  const product = await getDailyTipsProduct();
  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Daily sports intelligence</span>
        <h1>Today&apos;s provider-backed <span className="accent">predictions</span></h1>
        <p>Every available match is run through the OddsPadi engine. Value, leans, watchlists and abstentions stay separate, and a provider failure never turns into a fake fixture.</p>
        <nav className="intelligence-nav" aria-label="Prediction views">
          <Link className="button primary" href="/predictions/today">Daily tips</Link>
          <Link className="button" href="/predictions/week">Weekly preview</Link>
          <Link className="button" href="/predictions/value-picks">Value picks</Link>
          <Link className="button" href="/predictions/history">Results ledger</Link>
        </nav>
      </div>
      <ProviderRunStrip slate={product.slate} />
      <DailyTipsSections product={product} />
      <PredictionDisclaimer />
    </main>
  );
}
