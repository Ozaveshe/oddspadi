import type { Metadata } from "next";
import { DailyTipsPageView } from "@/components/odds/DailyTipsPageView";
import { fetchLiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { getCachedTodayTipsProduct } from "@/lib/sports/tips/publicReads";
import { readTimezonePreference } from "@/lib/time/timezoneCookie";

export const dynamic = "force-dynamic";

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

/**
 * The live board is a fallback here, not the substance of the page, so it must
 * never hold the render. `fetchLiveScoreBoard` fans out to three providers and
 * can take ~6s on a cold cache; unguarded, that became this page's floor. The
 * view already handles a null board.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    })
  ]);
}

export default async function DailyTipsPage() {
  // Which day this is depends on where the visitor is, so the zone has to be
  // resolved before the read rather than applied to the times afterwards.
  const timeZone = await readTimezonePreference();
  const [product, liveBoard] = await Promise.all([
    getCachedTodayTipsProduct(timeZone),
    withTimeout(fetchLiveScoreBoard(), 2_500, null)
  ]);
  return <DailyTipsPageView product={product} fallbackBoard={liveBoard} />;
}
