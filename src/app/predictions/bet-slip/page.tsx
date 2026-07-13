import type { Metadata } from "next";
import { SlipCheckClient } from "@/components/odds/SlipCheckClient";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";

export const metadata: Metadata = { title: "Slip Check — Accumulator Probability Analysis", description: "Check combined decimal odds, model-implied probability, bookmaker pricing and the weakest leg in your accumulator. Analysis only — no bets or payments.", alternates: { canonical: "/predictions/bet-slip" }, openGraph: { title: "Slip Check — OddsPadi", description: "See the honest probability behind your accumulator before matchday." } };
export default function BetSlipPage() { return <main id="main" className="container"><div className="page-heading"><span className="section-kicker">Slip Check</span><h1>See the chance behind your <span className="accent">accumulator</span></h1><p>Build from OddsPadi predictions and compare combined odds with the model&apos;s combined chance. No betting, no payments — just the honest maths.</p></div><SlipCheckClient /><section className="section"><ResponsibleUseNotice /></section></main>; }
