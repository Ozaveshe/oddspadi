import Link from "next/link";
import { AnalyticsPreferencesButton } from "@/components/analytics/Analytics";
import { BrandWord, LogoMark } from "./Logo";

const year = new Date().getFullYear();

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link className="brand" href="/" aria-label="OddsPadi home">
            <LogoMark size={34} />
            <BrandWord />
          </Link>
          <p>
            Your matchday padi. Live scores, model-led predictions, transparent results, and sports stories in plain language.
          </p>
        </div>

        <div>
          <h2>Explore</h2>
          <div className="footer-links">
            <Link href="/live-scores">Live scores</Link>
            <Link href="/predictions">Today&apos;s predictions</Link>
            <Link href="/predictions/value-picks">Value picks</Link>
            <Link href="/predictions/history">Results &amp; accuracy</Link>
            <Link href="/predictions/league/premier-league/table">League tables</Link>
            <Link href="/season-outlooks">Season outlooks</Link>
            <Link href="/news">Matchday news</Link>
            <Link href="/forums">Fan forums</Link>
            <Link href="/account">Sign in / account</Link>
          </div>
        </div>

        <div>
          <h2>The engine</h2>
          <div className="footer-links">
            <Link href="/predictions/decision-engine">AI decision engine</Link>
            <Link href="/predictions/bet-slip">Slip Check</Link>
            <Link href="/predictions?sport=basketball">Basketball</Link>
            <Link href="/predictions?sport=tennis">Tennis</Link>
          </div>
        </div>

        <div>
          <h2>Play responsibly</h2>
          <div className="footer-links">
            <span className="muted">
              Predictions are informed opinions, never guarantees. Only stake what you can afford to lose.
            </span>
            <span className="muted">OddsPadi does not take bets or hold money.</span>
            <Link href="/privacy">Privacy</Link>
            <AnalyticsPreferencesButton />
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <span>© {year} OddsPadi. Built with love for African football fans.</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span className="age-pill" aria-label="18 plus only">
              18+
            </span>
            Analysis only — no betting, no payments.
          </span>
        </div>
      </div>
    </footer>
  );
}
