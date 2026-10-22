import type { Metadata } from "next";
import { SlipCheckClient } from "@/components/odds/SlipCheckClient";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { pageMetadata } from "@/lib/seo/pageMetadata";

export const metadata: Metadata = pageMetadata({
  title: "Bet Workspace — Evaluate Your Bets",
  description: "Check combined decimal odds, model-implied probability, bookmaker pricing and the weakest leg in your accumulator. Analysis only — no bets or payments.",
  path: "/predictions/bet-slip",
  socialTitle: "Slip Check — OddsPadi",
  socialDescription: "See the honest probability behind your accumulator before matchday."
});
export default function BetSlipPage() { return <main id="main" className="container"><div className="page-heading"><span className="section-kicker">Bet Workspace</span><h1>Understand your bet <span className="accent">before kickoff</span></h1><p>Find the exact fixture, enter your bookmaker&apos;s price, and compare it with the available evidence. See missing data, stale prices and correlated selections before freezing your own record.</p></div><SlipCheckClient /><section className="section"><ResponsibleUseNotice /></section></main>; }
