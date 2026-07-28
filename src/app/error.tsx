"use client";

import Link from "next/link";
import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics/events";

/**
 * Route-level error boundary. Keeps a runtime error on one page from blanking
 * the whole app and gives the visitor a clear way back.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error(error);
    // React error boundaries swallow the error, so it never reaches the
    // window `error`/`unhandledrejection` listeners that feed telemetry. This
    // boundary catching a page crash was therefore completely silent in
    // production — the single most important thing to know about. `trackEvent`
    // is consent-gated and never throws.
    trackEvent("client_error", {
      error_kind: error.name || "route_boundary",
      boundary: "route",
      ...(error.digest ? { digest: error.digest } : {})
    });
  }, [error]);

  return (
    <main id="main" className="container">
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 20 }}>
        <div>
          <span className="section-kicker">Something went wrong</span>
          <h1>
            We dropped the ball <span className="accent">for a moment</span>.
          </h1>
          <p>
            An unexpected error interrupted this page. Give it another go — most of the time it sorts itself out. If it
            keeps happening, check back shortly.
          </p>
          <div className="actions">
            <button className="button primary" type="button" onClick={() => reset()}>
              Try again
            </button>
            <Link className="button" href="/">
              Back to home
            </Link>
          </div>
          {error.digest ? (
            <p className="small muted" style={{ marginTop: 16 }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
