import type { Metadata } from "next";
import Link from "next/link";
import { MyShelves } from "@/components/product/MyShelves";

export const metadata: Metadata = {
  title: "My Padi — Your Workspace",
  description: "Your bet workspace, saved fixtures, recently viewed matches and followed teams. Works without an account; everything stays on your device unless you sign in.",
  // Personal shelves are per-visitor localStorage — an index entry would show
  // crawlers an empty page and users someone else's nothing.
  robots: { index: false, follow: true }
};

/**
 * My Padi: the visitor's own corner of the product. Guest-first by
 * architecture — the shelves are localStorage keyed on canonical fixture ids,
 * so nothing here requires registration (docs/product-architecture.md).
 * An account only adds cross-device follows, community identity and alerts.
 */
export default function MyPadiPage() {
  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">My Padi</span>
        <h1>Your <span className="accent">workspace</span></h1>
        <p>Slip selections, saved fixtures and your recent research — kept on this device, no account needed. Sign in only if you want your clubs and alerts to follow you across devices.</p>
      </div>
      <MyShelves />
      <section className="section" aria-labelledby="my-account-heading">
        <div className="section-title"><div><span className="section-kicker">Account</span><h2 id="my-account-heading">Optional, never required</h2></div><Link className="button" href="/account">Account &amp; alerts</Link></div>
        <p className="muted small">An account adds followed teams that sync across devices, a community identity for the feed and forums, and matchday push alerts. Reading, analysis and the workspace never need one.</p>
      </section>
    </main>
  );
}
