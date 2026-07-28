import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { DailyTipsPageView } from "@/components/odds/DailyTipsPageView";
import { getCachedTomorrowTipsProduct } from "@/lib/sports/tips/publicReads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Tomorrow's OddsPadi Tips — Early Leans & Watchlist",
  description: "Tomorrow's provider-backed sports schedule with early model analysis, leans, watchlist selections and clear no-pick reasons.",
  path: "/predictions/tomorrow",
  socialTitle: "Tomorrow's football tips, leans and watchlist",
  socialDescription: "Early model reads on tomorrow's fixtures, refreshed as odds, lineups and injuries land."
});

export default async function TomorrowTipsPage() {
  return <DailyTipsPageView product={await getCachedTomorrowTipsProduct()} />;
}
