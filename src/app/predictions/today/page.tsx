import type { Metadata } from "next";
import { DailyTipsPageView } from "@/components/odds/DailyTipsPageView";
import { fetchLiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { getCachedTodayTipsProduct } from "@/lib/sports/tips/publicReads";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Today's OddsPadi Tips — Value, Leans & Watchlist",
  description: "Provider-backed daily sports tips with the full schedule, value picks, safer leans, watchlist selections and honest no-pick reasons.",
  alternates: { canonical: "/predictions/today" },
  openGraph: {
    title: "Today's OddsPadi Tips",
    description: "Today's full provider-backed schedule, best value reads, safer leans, watchlist and no-pick reasons.",
    url: "/predictions/today"
  }
};

export default async function DailyTipsPage() {
  const [product, liveBoard] = await Promise.all([getCachedTodayTipsProduct(), fetchLiveScoreBoard()]);
  return <DailyTipsPageView product={product} fallbackBoard={liveBoard} />;
}
