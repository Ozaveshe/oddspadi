import type { Metadata } from "next";
import { AnalyticsPreferencesButton } from "@/components/analytics/Analytics";

export const metadata: Metadata = {
  title: "Privacy & analytics",
  description: "How OddsPadi uses analytics, what we measure, and how visitors control their choice.",
  alternates: { canonical: "/privacy" }
};

export default function PrivacyPage() {
  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Plain-language privacy</span>
        <h1>
          Your visit, <span className="accent">your choice</span>
        </h1>
        <p>Effective 12 July 2026. This notice explains the optional analytics used on OddsPadi.</p>
      </div>

      <div className="legal-copy panel">
        <section>
          <h2>What is always required</h2>
          <p className="muted">
            OddsPadi uses essential storage for security, account sessions, and preferences needed to make the site work.
            These are not used for advertising and cannot be disabled through the analytics control.
          </p>
        </section>

        <section>
          <h2>Optional analytics</h2>
          <p className="muted">
            If you choose “Allow analytics,” Google Analytics helps us measure page visits, feature use, technical errors,
            and Core Web Vitals such as loading speed and responsiveness. Advertising storage, Google Signals, ad
            personalization, and ad-user-data sharing stay disabled.
          </p>
        </section>

        <section>
          <h2>What our product events contain</h2>
          <ul>
            <li>The page path you visited, without search-query parameters.</li>
            <li>Feature actions such as opening a prediction, applying a filter, or creating a community post.</li>
            <li>Coarse technical measurements such as performance rating and error type.</li>
          </ul>
          <p className="muted">
            Custom analytics events are designed not to include email addresses, passwords, post or reply text, free-form
            searches, payment information, or the amount someone may choose to stake elsewhere.
          </p>
        </section>

        <section>
          <h2>Who receives analytics data</h2>
          <p className="muted">
            When analytics is allowed, measurement data is processed by Google Analytics on our behalf. Google’s own
            service terms and privacy controls also apply. OddsPadi does not sell this analytics data.
          </p>
        </section>

        <section>
          <h2>Control your choice</h2>
          <p className="muted">
            Analytics is off until you opt in. Your choice is stored in this browser. You can change it at any time;
            turning analytics off also removes OddsPadi’s Google Analytics cookies from this browser where possible. A
            browser Global Privacy Control signal is treated as a “no” when no choice has been saved.
          </p>
          <div>
            <AnalyticsPreferencesButton />
          </div>
        </section>
      </div>
    </main>
  );
}
