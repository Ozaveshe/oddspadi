import Link from "next/link";
import { buildFixtureCard, type CardInput, type ConsumerState } from "@/lib/discovery/fixtureCard";

/**
 * The one fixture card.
 *
 * Today, Explore and Live render this. Three surfaces each building their own
 * card is how the same fixture comes to say "Pick" on one page and "Waiting
 * for odds" on another, and the view-model exists so that cannot happen: this
 * component decides nothing. It lays out what `buildFixtureCard` returns.
 *
 * It reuses the existing `.match-card` styles, which were in globals.css with
 * no component rendering them. Adding a parallel set of class names would have
 * left the app with two card designs and one of them dead — the opposite of
 * what a shared card is for.
 */

export type FixtureCardProps = {
  fixtureId: string;
  href: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  /**
   * A node, not a string. A server component formatting a time itself pins
   * every kickoff to the deploy host's clock — which is UTC — so callers pass
   * `<LocalTime>` and the visitor sees their own. Typing this as a string
   * would have made that mistake the path of least resistance.
   */
  kickoffLabel: React.ReactNode;
  score: { home: number; away: number } | null;
  /** Compact drops the summary line and the odds block for dense lists. */
  variant?: "full" | "compact";
  card: CardInput;
  /** Rendered into the actions row; the card does not know what they are. */
  actions?: React.ReactNode;
};

const STATE_TONE: Record<ConsumerState, string> = {
  pick: "is-pick",
  watch: "is-watch",
  pass: "is-pass",
  waiting_for_odds: "is-waiting",
  analysis_unavailable: "is-unavailable",
  live: "is-live",
  finished: "is-finished",
  result_being_verified: "is-verifying"
};

export function FixtureCard({
  fixtureId,
  href,
  homeTeam,
  awayTeam,
  competition,
  kickoffLabel,
  score,
  variant = "full",
  card: input,
  actions
}: FixtureCardProps) {
  const view = buildFixtureCard(input);
  const compact = variant === "compact";

  return (
    <article
      className={`match-card panel fixture-card ${STATE_TONE[view.state]}${compact ? " is-compact" : ""}`}
      data-fixture-id={fixtureId}
      data-state={view.state}
    >
      <header className="match-card-header">
        <span className="league-tag">{competition}</span>
        <span className="fixture-card-state" aria-label={`Status: ${view.label}`}>
          {view.state === "live" ? <span className="fixture-card-live-dot" aria-hidden="true" /> : null}
          {view.label}
        </span>
        {/* A live card shows a clock, not a kickoff time that has passed. */}
        <span className="fixture-card-time">{kickoffLabel}</span>
      </header>

      <div className="match-main">
        <Link href={href} className="teams fixture-card-link" prefetch={false}>
          <span className="team-inline">
            <span>{homeTeam}</span>
          </span>
          <span className="teams-vs" aria-hidden="true">
            v
          </span>
          <span className="team-inline">
            <span>{awayTeam}</span>
          </span>
        </Link>

        {score ? (
          <p className="fixture-card-score" aria-label={`Score ${score.home} ${score.away}`}>
            {score.home}–{score.away}
          </p>
        ) : view.odds ? (
          // Only ever current odds. The view-model nulls this out for stale
          // prices, finished fixtures and live ones, so there is no branch here
          // that could show a price beside "no odds available".
          <p className="fixture-card-odds">
            <span className="fixture-card-odds-value">{view.odds.label}</span>
            <span className="fixture-card-odds-note">current</span>
          </p>
        ) : view.historicalOddsOnly ? (
          <p className="fixture-card-odds is-historical">Historical odds only</p>
        ) : null}
      </div>

      {!compact ? <p className="fixture-card-summary">{view.summary}</p> : null}

      {actions ? <div className="fixture-card-actions">{actions}</div> : null}
    </article>
  );
}
