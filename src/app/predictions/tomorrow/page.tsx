import type { Metadata } from "next";
import { DailyTipsPageView } from "@/components/odds/DailyTipsPageView";
import { getCachedTomorrowTipsProduct } from "@/lib/sports/tips/publicReads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tomorrow's OddsPadi Tips — Early Leans & Watchlist",
  description: "Tomorrow's provider-backed sports schedule with early model analysis, leans, watchlist selections and clear no-pick reasons.",
  alternates: { canonical: "/predictions/tomorrow" }
};

export default async function TomorrowTipsPage() {
  return <DailyTipsPageView product={await getCachedTomorrowTipsProduct()} />;
}
