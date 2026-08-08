import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import Link from "next/link";
import { DailyDecisionOverview, DailyTipsSections, ProviderRunStrip } from "@/components/odds/IntelligenceSlate";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { RankedFixtureBoard } from "@/components/product/RankedFixtureBoard";
import { readViewerContext } from "@/lib/discovery/viewerContext";
import { getCachedTodayTipsProduct } from "@/lib/sports/tips/publicReads";
import { filterDailyTipsProductBySport } from "@/lib/sports/tips/product";
import { readNavigationContext, withNavigationContext } from "@/lib/navigation/context";
import type { Sport } from "@/lib/sports/types";
import { readTimezonePreference } from "@/lib/time/timezoneCookie";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Today's Provider-Backed Sports Predictions",
  description: "Today's real provider fixtures, model probabilities, fresh odds, value decisions and honest no-pick states from the OddsPadi engine.",
  path: "/predictions",
  socialTitle: "Today's sports predictions — probabilities, odds and value",
  socialDescription: "Every fixture on today's board with model probabilities, live odds and a clear reason whenever there is no pick."
});

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
  const resolvedParams = await searchParams;
  const requestedSport = predictionSport(resolvedParams?.sport);
  const carried = readNavigationContext(resolvedParams);
  const fullProduct = await getCachedTodayTipsProduct(await readTimezonePreference());
  const product = requestedSport ? filterDailyTipsProductBySport(fullProduct, requestedSport) : fullProduct;
  const sportLabel = requestedSport ? requestedSport[0].toUpperCase() + requestedSport.slice(1) : null;
  const viewer = readViewerContext({ preferredSports: requestedSport ? [requestedSport] : [] });
  return (
    <main id="main" className="container">
      <header className="page-heading predictions-heading prediction-desk-heading">
        <div>
          <span className="section-kicker">The Matchday Desk · Today</span>
          <h1>{sportLabel ? <><span className="accent">{sportLabel}</span> decisions</> : <>Today&apos;s match <span className="accent">decisions</span></>}</h1>
          <p className="muted small"><strong>Predictions</strong> are the model&apos;s probabilities for every market on a fixture. The <strong>tip</strong> is the one selection per fixture we would stake if forced — the same data, at two zoom levels.</p>
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
        {/* Switching view must not silently drop the sport filter: someone on
            the tennis board who taps "Week" means the tennis week. */}
        <nav className="prediction-view-row" aria-label="Prediction views">
          <Link href={withNavigationContext("/predictions/today", carried)}>Daily</Link>
          <Link href={withNavigationContext("/predictions/week", carried)}>Week</Link>
          <Link href={withNavigationContext("/predictions/value-picks", carried)}>Published</Link>
          <Link href={withNavigationContext("/predictions/history", carried)}>Results</Link>
        </nav>
      </div>
      <DailyDecisionOverview product={product} />

      {/* Ranked first, then the full sectioned board below. The ranking
          engine, the diversity caps and the today/results/archive split had no
          consumer until here — every one of them tested and none of them
          affecting a pixel. */}
      <RankedFixtureBoard
        rows={product.sections.schedule}
        viewer={viewer}
        viewAllHref={requestedSport ? `/predictions?sport=${requestedSport}` : "/predictions"}
        heading={sportLabel ? `${sportLabel}: what matters now` : "What matters now"}
      />

      <DailyTipsSections product={product} context={carried} />
      <section className="prediction-receipt">
        <div><span className="section-kicker">Data receipt</span><h2>How this slate was built</h2></div>
        <ProviderRunStrip slate={product.slate} />
      </section>
      <PredictionDisclaimer sport={requestedSport ?? undefined} />
    </main>
  );
}
