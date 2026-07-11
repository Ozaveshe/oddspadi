import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  description: "That page has left the pitch. Head back to live scores, predictions, or today's value picks.",
  robots: { index: false, follow: true }
};

const shortcuts = [
  { href: "/live-scores", label: "Live scores", note: "Follow every goal, minute by minute" },
  { href: "/predictions", label: "Today's predictions", note: "Probabilities, odds and honest value reads" },
  { href: "/predictions/value-picks", label: "Value picks", note: "Where the numbers actually smile" },
  { href: "/predictions/history", label: "Results & accuracy", note: "Every outcome — wins and losses" }
];

export default function NotFound() {
  return (
    <main id="main" className="container">
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 20 }}>
        <div>
          <span className="section-kicker">Error 404 · Off target</span>
          <h1>
            That page has <span className="accent">left the pitch</span>.
          </h1>
          <p>
            We couldn&apos;t find what you were looking for. The link may be old, or the match may have wrapped up.
            No stress — here&apos;s the way back.
          </p>
          <div className="actions">
            <Link className="button primary" href="/">
              Back to home
            </Link>
            <Link className="button" href="/live-scores">
              Watch live scores
            </Link>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 8 }}>
        <div className="section-title">
          <div>
            <span className="section-kicker">Popular pages</span>
            <h2>Jump back in</h2>
          </div>
        </div>
        <div className="link-grid">
          {shortcuts.map((item) => (
            <Link className="mini-match" key={item.href} href={item.href} style={{ gridTemplateColumns: "1fr auto" }}>
              <span>
                <strong style={{ display: "block", fontSize: 15 }}>{item.label}</strong>
                <span className="muted small">{item.note}</span>
              </span>
              <span className="inline-link" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
