import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The plain-language terms for using OddsPadi: analysis only, no betting, no guarantees, 18+ framing, and community rules.",
  alternates: { canonical: "/terms" }
};

export default function TermsPage() {
  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Plain-language terms</span>
        <h1>
          The <span className="accent">deal</span> between us
        </h1>
        <p>Effective 13 July 2026. Using OddsPadi means you accept these terms.</p>
      </div>

      <div className="legal-copy panel">
        <section>
          <h2>Analysis only — never betting</h2>
          <p className="muted">
            OddsPadi publishes sports analysis, statistics and predictions. We do not accept bets, hold funds, or
            process payments of any kind. Nothing on this site is an invitation to gamble, and nothing here is
            financial advice.
          </p>
        </section>

        <section>
          <h2>No guarantees</h2>
          <p className="muted">
            Predictions are model-generated opinions with visible uncertainty. Sport is unpredictable by nature and
            past model performance never guarantees future results. You act on any information here entirely at your
            own risk, and OddsPadi accepts no liability for losses arising from decisions you make elsewhere.
          </p>
        </section>

        <section>
          <h2>18+ and responsible play</h2>
          <p className="muted">
            OddsPadi content discusses bookmaker odds and is intended for adults (18+, or the legal age in your
            country if higher). If you choose to bet with a licensed operator, only stake what you can afford to lose.
            If gambling stops being fun, seek help — for example through{" "}
            <a className="inline-link" href="https://www.begambleaware.org" rel="noopener noreferrer" target="_blank">
              BeGambleAware
            </a>.
          </p>
        </section>

        <section>
          <h2>Your account and the community</h2>
          <p className="muted">
            Community posts and forum threads are fan opinions, not OddsPadi analysis. Keep it friendly: no abuse, no
            spam, no impersonation, no illegal content, and no posting other people&apos;s personal information. We may
            remove content or accounts that break these rules. You keep ownership of what you post but grant OddsPadi a
            licence to display it on the site.
          </p>
        </section>

        <section>
          <h2>Fair use of the site</h2>
          <p className="muted">
            Don&apos;t scrape at abusive volume, attack the service, or resell our data or predictions without written
            permission. The OddsPadi name, brand and site design belong to us.
          </p>
        </section>

        <section>
          <h2>Privacy and changes</h2>
          <p className="muted">
            How we handle analytics and data is described in the <Link className="inline-link" href="/privacy">privacy notice</Link>.
            We may update these terms as the product evolves; the effective date above always reflects the current
            version.
          </p>
        </section>
      </div>
    </main>
  );
}
