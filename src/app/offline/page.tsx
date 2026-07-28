import type { Metadata } from "next";
import Link from "next/link";

// The service worker's fallback shell. It has no standalone value in search and
// would read as a soft 404, so it is kept out of the index (robots.txt disallows
// it too, and a disallowed URL can still be indexed from links without this).
export const metadata: Metadata = {
  title: "You are offline",
  description: "OddsPadi pages you have already visited stay available offline.",
  robots: { index: false, follow: false }
};

export default function OfflinePage() {
  return (
    <main id="main" className="container">
      <div className="empty-state">
        <h1>You&apos;re offline, padi</h1>
        <p className="muted">
          Saved OddsPadi pages are still available. Reconnect for live scores and fresh match data.
        </p>
        <Link className="button primary" href="/">Try home again</Link>
      </div>
    </main>
  );
}
