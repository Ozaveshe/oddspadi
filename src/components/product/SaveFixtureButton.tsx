"use client";

import { useEffect, useState } from "react";
import { FIXTURE_SHELF_CHANGED_EVENT, isFixtureSaved, toggleSavedFixture, type ShelfFixture } from "@/lib/product/fixtureShelf";

/**
 * Save-this-fixture toggle for the canonical match page. Guest-first: the
 * shelf is localStorage, so the action works signed out and never prompts.
 */
export function SaveFixtureButton({ fixture }: { fixture: Omit<ShelfFixture, "touchedAt"> }) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const sync = () => setSaved(isFixtureSaved(fixture.matchId));
    sync();
    window.addEventListener(FIXTURE_SHELF_CHANGED_EVENT, sync);
    return () => window.removeEventListener(FIXTURE_SHELF_CHANGED_EVENT, sync);
  }, [fixture.matchId]);

  return (
    <button
      type="button"
      className={`save-fixture-button${saved ? " is-saved" : ""}`}
      aria-pressed={saved}
      onClick={() => setSaved(toggleSavedFixture(fixture))}
    >
      {saved ? "★ Saved" : "☆ Save fixture"}
    </button>
  );
}
