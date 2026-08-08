import type { RecordClass } from "@/lib/domain/states";

/**
 * The evidence classes, as separate sections that are never added together.
 *
 * The failure this prevents is specific and has already happened here: the
 * public track record once showed 144 rows that were paper-mode shadow trades,
 * because one sync trigger used a denylist instead of an allowlist. Every one
 * of those rows was real; none of them was a public pick. Presented under a
 * single "our record" heading they became a claim nobody had made.
 *
 * So the page has one official section and several non-official ones, each
 * with its own heading, its own denominator and its own sentence saying what it
 * is. There is deliberately no combined figure anywhere on the page, and no
 * helper in this module that could compute one.
 *
 * The copy for the classes that already appeared on `/track-record` is carried
 * over verbatim, including the correction that was made to the shadow-decision
 * line — "never public" was false on the page that said it, because the
 * internal model record is built from shadow decisions. What the ledger
 * actually enforces is that they never enter the *official* record.
 */

export type EvidenceClassId =
  | "official-live"
  | "verified-legacy-official"
  | "internal-decisions"
  | "editorial-archive"
  | "shadow-decisions"
  | "backtests"
  | "community";

export type EvidenceClass = {
  id: EvidenceClassId;
  title: string;
  /** The one-line description shown beside the title. */
  summary: string;
  /** Whether rows of this class may enter the official public record. */
  countsOfficially: boolean;
  /** The record class in `@/lib/domain/states` this maps to, where one exists. */
  recordClass: RecordClass | null;
  /** Where a reader can go and look at this class for themselves. */
  href: string | null;
  hrefLabel: string | null;
  /** Longer note explaining what the class is and why it is kept apart. */
  note: string;
};

export const EVIDENCE_CLASSES: EvidenceClass[] = [
  {
    id: "official-live",
    title: "Official public picks",
    summary: "The published ledger. The only class in OddsPadi's public record.",
    countsOfficially: true,
    recordClass: "official_public_pick",
    href: "/predictions/history",
    hrefLabel: "Every published pick",
    note: "Written to op_publications before kickoff, priced at the moment of publication, and settled against a final score. Every number in the summary above comes from this class and from nothing else."
  },
  {
    id: "verified-legacy-official",
    title: "Verified legacy official picks",
    summary: "Pre-ledger picks that could be re-verified against a stored fixture and price.",
    countsOfficially: false,
    recordClass: "official_public_pick",
    href: null,
    hrefLabel: null,
    note: "The 2026-07-31 reconciliation found nothing in the product's history that met the bar: no pre-ledger row carried a server-generated publication time, so none could be shown to have been published before kickoff. This class therefore holds zero rows, and it exists to say that out loud rather than to leave a reader wondering what happened before the ledger."
  },
  {
    id: "internal-decisions",
    title: "Internal decisions",
    summary: "Every call the engine grades, published or not. Training evidence, never public performance.",
    countsOfficially: false,
    recordClass: "internal_decision",
    href: "/predictions/decision-engine",
    hrefLabel: "Engine status",
    note: "Counted once per decision, not once per bookmaker price. The internal record is what tells us whether the model is improving; it is not a record of anything we asked anyone to act on."
  },
  {
    id: "editorial-archive",
    title: "Editorial archive",
    summary: "Something an article said. Never a pick.",
    countsOfficially: false,
    recordClass: "editorial_observation",
    href: "/news",
    hrefLabel: "News archive",
    note: "Articles cite publication ids and re-resolve them at render, so a corrected or retracted claim cannot keep being repeated by a story written before the correction. An observation in an article is not itself a claim on the record."
  },
  {
    id: "shadow-decisions",
    title: "Shadow decisions",
    summary: "Paper-mode runs of candidate models. Shown in the internal record, never counted in the official one.",
    countsOfficially: false,
    recordClass: "shadow_decision",
    href: "/engine/performance",
    hrefLabel: "Calibration & analytics",
    note: "A candidate model runs alongside the live one without publishing anything. Its results are how a challenger earns promotion. A schema allowlist makes it impossible for one of these rows to reach the publication ledger."
  },
  {
    id: "backtests",
    title: "Backtests",
    summary: "Historical replays on the corpus. Never live performance.",
    countsOfficially: false,
    recordClass: "backtest_record",
    href: "/engine/performance",
    hrefLabel: "Calibration & analytics",
    note: "A replay knows how the season ended. However carefully it is constructed, it is a statement about a model fitted to history, and presenting it next to live results would flatter the live results."
  },
  {
    id: "community",
    title: "Community selections",
    summary: "Members' own tips, with their own leaderboard. Never OddsPadi's record.",
    countsOfficially: false,
    recordClass: "community_selection",
    href: "/community",
    hrefLabel: "Community leaderboard",
    note: "Stored in different tables with a different settlement path. A member's good week is theirs, and so is a bad one."
  }
];

export const OFFICIAL_EVIDENCE_CLASS = EVIDENCE_CLASSES[0];

/** Everything that is deliberately excluded from the official record. */
export const NON_OFFICIAL_EVIDENCE_CLASSES = EVIDENCE_CLASSES.filter((entry) => !entry.countsOfficially);

export const EVIDENCE_SEPARATION_STATEMENT =
  "These are never aggregated into one number. Mixing them is how a paper trade becomes a claimed win.";
