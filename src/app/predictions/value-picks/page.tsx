import type { Metadata } from "next";
import Link from "next/link";
import { ProviderRunStrip, SlateFixtureCard } from "@/components/odds/IntelligenceSlate";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import type { SlateFixture } from "@/lib/sports/intelligence/types";
import { getDailyTipsProduct } from "@/lib/sports/tips/product";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Today's Sports Value Picks",
  description: "Provider-backed value picks that clear OddsPadi's price, confidence, freshness and evidence guardrails, plus useful leans and watchlist context when none qualify.",
  alternates: { canonical: "/predictions/value-picks" },
  openGraph: {
    title: "Today's Value Picks | OddsPadi",
    description: "See the selections that clear every OddsPadi publication guardrail — and the honest alternatives when none do.",
    url: "/predictions/value-picks"
  }
};

function FallbackSection({ title, eyebrow, rows, empty }: { title: string; eyebrow: string; rows: SlateFixture[]; empty: string }) {
  return (
    <section className="section intelligence-section">
      <div className="section-title">
        <div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2></div>
        <span className="badge scheduled">{rows.length}</span>
      </div>
      {rows.length ? <div className="intelligence-grid">{rows.map((row) => <SlateFixtureCard key={`${title}-${row.fixture.fixtureId}`} row={row} />)}</div> : <div className="empty-state compact"><h3>{empty}</h3><p className="muted">The engine does not fill this section with demo selections.</p></div>}
    </section>
  );
}

export default async function ValuePicksPage() {
  const product = await getDailyTipsProduct();
  const { slate } = product;
  const hasPublishedValue = product.sections.valuePicks.length > 0;

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Selections that clear every guardrail</span>
        <h1>Today&apos;s <span className="accent">value picks</span></h1>
        <p>A value pick needs a positive edge and expected value, sufficient confidence, fresh odds, provider-backed fixture data and acceptable evidence quality.</p>
        <nav className="intelligence-nav" aria-label="Prediction views"><Link className="button" href="/predictions/today">Full daily slate</Link><Link className="button" href="/predictions/week">Weekly radar</Link></nav>
      </div>

      <ProviderRunStrip slate={slate} />

      {hasPublishedValue ? (
        <section className="section intelligence-section">
          <div className="section-title"><div><span className="section-kicker">Published now</span><h2>Value picks</h2></div><span className="badge positive">{product.sections.valuePicks.length}</span></div>
          <div className="intelligence-grid">{product.sections.valuePicks.map((row) => <SlateFixtureCard key={row.fixture.fixtureId} row={row} asOf={product.generatedAt} />)}</div>
        </section>
      ) : (
        <div className="empty-state">
          <h2>No published value picks right now</h2>
          <p className="muted">Nothing on today&apos;s provider slate clears every price, freshness and evidence gate. The useful model reads below stay visible without being promoted as value picks.</p>
        </div>
      )}

      {!hasPublishedValue ? (
        <>
          <FallbackSection title="Here are today's leans" eyebrow="Model preference, not a value claim" rows={product.sections.leans} empty="No lean is ready at the current prices" />
          <FallbackSection title="Here is the watchlist" eyebrow="Waiting on odds or evidence" rows={product.sections.watchlist} empty="Nothing is waiting on a refresh" />
          <FallbackSection title="Why today has no picks" eyebrow="No-pick reasons" rows={product.sections.noPicks} empty="No additional no-pick analysis is available" />
        </>
      ) : null}

      <section className="section"><PredictionDisclaimer /></section>
    </main>
  );
}
