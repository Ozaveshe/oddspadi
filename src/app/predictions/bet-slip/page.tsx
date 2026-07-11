import type { Metadata } from "next";
import Link from "next/link";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";

export const metadata: Metadata = {
  title: "Slip Check — Coming Soon",
  description:
    "Paste your accumulator and let the OddsPadi engine grade it: combined odds, weak legs, risk warnings, and smarter alternatives. Coming soon.",
  alternates: { canonical: "/predictions/bet-slip" },
  robots: { index: false, follow: true }
};

export default function BetSlipPage() {
  return (
    <main className="container">
      <div className="page-heading">
        <h1>
          Slip Check is <span className="accent">coming soon</span>
        </h1>
        <p>
          Soon you&apos;ll be able to build a slip here and let the engine grade it before you commit — no more
          carrying one weak leg that spoils the whole ticket.
        </p>
      </div>

      <section className="grid-2">
        <div className="panel">
          <h2>What it will do</h2>
          <div className="match-list" style={{ marginTop: 12 }}>
            <div className="step-card">
              <span className="step-num">⚖️</span>
              <h3>Grade every leg</h3>
              <p>Each selection gets a value, confidence, and risk score from the same engine behind our predictions.</p>
            </div>
            <div className="step-card">
              <span className="step-num">🚨</span>
              <h3>Flag the weak links</h3>
              <p>We&apos;ll point at the leg most likely to sink your slip — and suggest safer alternatives.</p>
            </div>
            <div className="step-card">
              <span className="step-num">🧮</span>
              <h3>Show the true price</h3>
              <p>Combined odds versus the model&apos;s combined probability, so you see the real chance of it landing.</p>
            </div>
          </div>
        </div>
        <div className="panel">
          <h2>While you wait</h2>
          <p className="muted">The engine is already grading single picks every day — start there:</p>
          <div className="card-actions">
            <Link className="button primary" href="/predictions/value-picks">
              See today&apos;s value picks
            </Link>
            <Link className="button" href="/predictions">
              Browse all predictions
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <ResponsibleUseNotice />
      </section>
    </main>
  );
}
