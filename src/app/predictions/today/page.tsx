import type { Metadata } from "next";
import { DailyTipsPageView } from "@/components/odds/DailyTipsPageView";
import { getDailyTipsProduct } from "@/lib/sports/tips/product";

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
  return <DailyTipsPageView product={await getDailyTipsProduct({ day: "today" })} />;
}
