import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About OddsPadi",
  description:
    "What OddsPadi is, how the prediction engine works, and the promises we make to fans: transparent results, plain language, and responsible-play framing.",
  alternates: { canonical: "/about" }
};

export default function AboutPage() {
  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Who we are</span>
        <h1>
          Your football <span className="accent">padi</span>, with receipts
        </h1>
        <p>
          OddsPadi is a free sports analysis site built for African fans — live scores, model-led predictions, and
          honest results, all in plain language.
        </p>
      </div>

      <div className="legal-copy panel">
        <section>
          <h2>What OddsPadi does</h2>
          <p className="muted">
            We follow live football, basketball and tennis, and run every fixture through a prediction engine that
            compares real bookmaker odds against its own estimated probabilities. When the model&apos;s probability
            beats the bookmaker&apos;s implied price after their margin is removed, we flag it as value — and when
            there&apos;s no value, we say so plainly.
          </p>
        </section>

        <section>
          <h2>What makes us different</h2>
          <p className="muted">
            Every stored pick lands on the public <Link className="inline-link" href="/predictions/history">results ledger</Link> —
            wins, losses, pushes and voids. No deleted losses, no &ldquo;sure odds&rdquo;, no fake accuracy claims.
            Uncertainty stays visible on every card: confidence, risk and the reasoning behind each number.
          </p>
        </section>

        <section>
          <h2>What OddsPadi is not</h2>
          <p className="muted">
            We are not a bookmaker. We don&apos;t take bets, hold money, or process payments — OddsPadi is analysis
            only. If you choose to bet elsewhere you must be 18+, and you should only ever stake what you can afford
            to lose. Our predictions are informed opinions, never guarantees.
          </p>
        </section>

        <section>
          <h2>Talk to us</h2>
          <p className="muted">
            Join the conversation on the <Link className="inline-link" href="/community">community feed</Link> or the{" "}
            <Link className="inline-link" href="/forums">fan forums</Link> — the padi feed is where matchday talk lives.
          </p>
        </section>
      </div>
    </main>
  );
}
