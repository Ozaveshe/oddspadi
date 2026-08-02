"use client";

import { useEffect } from "react";
import { recordRecentFixture, type ShelfFixture } from "@/lib/product/fixtureShelf";

/**
 * Invisible: opening a canonical match page records it on the recently-viewed
 * shelf, which feeds "pick up where you left off" on My Padi. Local only.
 */
export function RecentFixtureRecorder({ fixture }: { fixture: Omit<ShelfFixture, "touchedAt"> }) {
  useEffect(() => {
    recordRecentFixture(fixture);
    // The fixture identity is stable for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture.matchId]);
  return null;
}
