import Link from "next/link";
import { AnalyticsPreferencesButton } from "@/components/analytics/Analytics";
import { BrandWord, LogoMark } from "./Logo";

const year = new Date().getFullYear();

const exploreLinks = [
  { href: "/live-scores", label: "Live scores" },
  { href: "/predictions", label: "Today's predictions" },
  { href: "/predictions/value-picks", label: "Value picks" },
  { href: "/predictions/history", label: "Results & accuracy" },
  { href: "/predictions/league/premier-league/table", label: "League tables" },
  { href: "/season-outlooks", label: "Season outlooks" },
  { href: "/news", label: "Matchday news" }
];

const communityLinks = [
  { href: "/community", label: "The padi feed" },
  { href: "/forums", label: "Fan forums" },
  { href: "/account", label: "Sign in / account" },
  { href: "/about", label: "About OddsPadi" }
];

const engineLinks = [
  { href: "/predictions/decision-engine", label: "Decision engine" },
  { href: "/engine/performance", label: "Engine performance" },
  { href: "/predictions/bet-slip", label: "Slip Check" },
  { href: "/predictions?sport=basketball", label: "Basketball" },
  { href: "/predictions?sport=tennis", label: "Tennis" }
];

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
            {exploreLinks.map((link) => (
              <Link href={link.href} key={link.href}>{link.label}</Link>
            ))}
          </div>
        </div>

        <div>
          <h2>Community</h2>
          <div className="footer-links">
            {communityLinks.map((link) => (
              <Link href={link.href} key={link.href}>{link.label}</Link>
            ))}
          </div>
        </div>

        <div>
          <h2>The engine</h2>
          <div className="footer-links">
            {engineLinks.map((link) => (
              <Link href={link.href} key={link.href}>{link.label}</Link>
            ))}
          </div>
        </div>

        <div>
          <h2>Play responsibly</h2>
          <div className="footer-links">
            <span className="muted">
              Predictions are informed opinions and outcomes remain uncertain. Only stake what you can afford to lose.
            </span>
            <span className="muted">OddsPadi does not take bets or hold money.</span>
            <a href="https://www.begambleaware.org" rel="noopener noreferrer" target="_blank">
              Need help? BeGambleAware
            </a>
            <Link href="/terms">Terms of use</Link>
            <Link href="/privacy">Privacy</Link>
            <AnalyticsPreferencesButton />
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <span>© {year} OddsPadi. Built with love for African football fans.</span>
          <span className="footer-responsible-note">
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
