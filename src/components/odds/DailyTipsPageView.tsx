import Link from "next/link";
import { DailyTipsSections, ProviderRunStrip } from "@/components/odds/IntelligenceSlate";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { TipsSharePreview } from "@/components/odds/TipsSharePreview";
import type { LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import type { DailyTipsProduct } from "@/lib/sports/tips/product";
import { formatDailyTipsForTelegram, formatDailyTipsForWhatsApp, formatValuePickPost } from "@/lib/sports/tips/social";

export function DailyTipsPageView({ product, fallbackBoard = null }: { product: DailyTipsProduct; fallbackBoard?: LiveScoreBoard | null }) {
  const isToday = product.day === "today";
  const heading = isToday ? "Today’s OddsPadi Tips" : "Tomorrow’s OddsPadi Tips";
  const formats = [
    { id: "whatsapp", label: "WhatsApp", text: formatDailyTipsForWhatsApp(product) },
    { id: "telegram", label: "Telegram", text: formatDailyTipsForTelegram(product) }
  ];
  const firstValue = product.sections.valuePicks[0];
  if (firstValue) formats.push({ id: "value-pick", label: "Value Pick", text: formatValuePickPost(firstValue) });

  return (
    <main id="main" className="container">
      <div className="page-heading product-heading tips-heading">
        <span className="section-kicker">The Matchday Desk · {isToday ? "Today" : "Tomorrow"}</span>
        <h1>{heading}</h1>
        <p>Every available match is scanned by the OddsPadi engine. We show value picks when the numbers clear our guardrails, leans when the model likes a side but price is tight, and no-pick reasons when the edge is not there.</p>
        <nav className="intelligence-nav">
          {!isToday ? <Link className="button" href="/predictions/today">Today&apos;s tips</Link> : <Link className="button" href="/predictions/tomorrow">Tomorrow&apos;s tips</Link>}
          <Link className="button" href="/predictions/week">Weekly radar</Link>
          <Link className="button" href="/predictions/history">Yesterday&apos;s results</Link>
        </nav>
      </div>
      <ProviderRunStrip slate={product.slate} />
      <DailyTipsSections product={product} fallbackBoard={fallbackBoard} />
      <TipsSharePreview formats={formats} />
      <PredictionDisclaimer />
    </main>
  );
}
