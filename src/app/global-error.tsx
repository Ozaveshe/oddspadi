"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort boundary for errors thrown in the root layout itself. It must
 * render its own <html>/<body> because it replaces the layout entirely.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error(error);
  }, [error]);

  return (
    <html lang="en">
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
