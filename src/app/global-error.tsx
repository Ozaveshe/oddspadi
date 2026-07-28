"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics/events";
import "./globals.css";

/**
 * Last-resort boundary for errors thrown in the root layout itself. It must
 * render its own <html>/<body> because it replaces the layout entirely — which
 * also means the root layout's `viewport` export does not apply here, so the
 * meta tag is emitted directly. Without it the fallback rendered zoomed-out on
 * every phone, at exactly the moment the visitor most needs to read it.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error(error);
    // Same blind spot as the route boundary: React swallows the error, so
    // nothing else reports a root-layout crash.
    trackEvent("client_error", {
      error_kind: error.name || "global_boundary",
      boundary: "global",
      ...(error.digest ? { digest: error.digest } : {})
    });
  }, [error]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Something went wrong | OddsPadi</title>
      </head>
      <body>
        <main id="main" className="container">
          <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 20 }}>
            <div>
              <span className="section-kicker">Something went wrong</span>
              <h1>
                We dropped the ball <span className="accent">for a moment</span>.
              </h1>
              <p>An unexpected error interrupted OddsPadi. Please try again.</p>
              <div className="actions">
                <button className="button primary" type="button" onClick={() => reset()}>
                  Try again
                </button>
              </div>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
