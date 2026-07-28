"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveBoardFixture } from "@/lib/sports/liveScoreBoard";

const MAX_ANNOUNCED = 4;

/** Stable key for "has this fixture's scoreline changed since the last poll?". */
function scorelineKey(fixture: LiveBoardFixture): string {
  return `${fixture.id}:${fixture.goals.home ?? "-"}:${fixture.goals.away ?? "-"}:${fixture.phase}`;
}

function scorelineSentence(fixture: LiveBoardFixture): string {
  const { home, away, goals } = fixture;
  const score = goals.home !== null && goals.away !== null ? `${goals.home}–${goals.away}` : "no score yet";
  const state = fixture.phase === "finished" ? "full time" : fixture.statusLabel || "live";
  return `${home.name} ${score} ${away.name}, ${state}.`;
}

/**
 * Announces score *changes* to assistive technology.
 *
 * The board previously marked the whole match list — and the ticker, and the
 * "Updated HH:MM:SS" clock — as `aria-live="polite"`. Every 45-second poll
 * re-rendered those subtrees, so a screen reader read the entire board (and the
 * ticking clock) aloud on repeat, which makes the page unusable rather than
 * accessible. This announces only the fixtures whose scoreline actually moved,
 * capped so a burst of simultaneous goals cannot flood the queue.
 */
export function ScoreAnnouncer({ fixtures }: { fixtures: LiveBoardFixture[] }) {
  const [message, setMessage] = useState("");
  const seenRef = useRef<Map<LiveBoardFixture["id"], string> | null>(null);

  useEffect(() => {
    const current = new Map(fixtures.map((fixture) => [fixture.id, scorelineKey(fixture)]));

    // First pass records the baseline without announcing: arriving on the page
    // should not read out every in-progress match.
    if (seenRef.current === null) {
      seenRef.current = current;
      return;
    }

    const previous = seenRef.current;
    const changed = fixtures.filter((fixture) => {
      const before = previous.get(fixture.id);
      return before !== undefined && before !== scorelineKey(fixture);
    });
    seenRef.current = current;

    if (!changed.length) return;
    const spoken = changed.slice(0, MAX_ANNOUNCED).map(scorelineSentence);
    const overflow = changed.length - spoken.length;
    setMessage(overflow > 0 ? `${spoken.join(" ")} And ${overflow} more updated.` : spoken.join(" "));
  }, [fixtures]);

  return (
    <span className="sr-only" aria-live="polite" aria-atomic="true" role="status">
      {message}
    </span>
  );
}
