/**
 * Sport adapters: which sections each entity surface can HONESTLY support,
 * given the data OddsPadi actually holds. An unsupported section always
 * carries a reason — pages render the reason, never a fabricated section.
 */

export type EntitySport = "football" | "basketball" | "tennis";

export type EntitySectionKey =
  | "table"
  | "fixtures"
  | "results"
  | "form"
  | "goals"
  | "efficiency"
  | "squad"
  | "roster"
  | "projection"
  | "surface_ratings"
  | "tournament_draw"
  | "head_to_head";

export type SectionSupport = { key: EntitySectionKey; supported: boolean; note: string | null };

const SQUAD_NOTE =
  "Squad and availability need a dedicated provider feed; OddsPadi does not show a squad it cannot verify.";
const STANDINGS_NOTE = "No approved basketball standings source is wired yet, so no table is shown.";
const DRAW_NOTE = "Tournament draws need a dedicated provider feed and are not shown until one is verified.";
const H2H_NOTE =
  "Head-to-head samples are small, old and surface-confounded; treat them as context, never as evidence.";
const PROJECTION_QUEUE_NOTE = "A season projection for this competition is on the coverage queue, not yet published.";

const supported = (key: EntitySectionKey, note: string | null = null): SectionSupport => ({ key, supported: true, note });
const unsupported = (key: EntitySectionKey, note: string): SectionSupport => ({ key, supported: false, note });

export function competitionSections(sport: EntitySport): SectionSupport[] {
  if (sport === "football") {
    return [
      supported("table"),
      supported("fixtures"),
      supported("results"),
      supported("form"),
      supported("goals"),
      supported("projection", "Premier League only today; linked as a separate research object, never mixed into the table."),
      unsupported("squad", SQUAD_NOTE)
    ];
  }
  if (sport === "basketball") {
    return [
      unsupported("table", STANDINGS_NOTE),
      supported("fixtures"),
      supported("results"),
      supported("efficiency", "Pace and efficiency come from stored rating evidence where present."),
      unsupported("roster", SQUAD_NOTE),
      unsupported("projection", PROJECTION_QUEUE_NOTE)
    ];
  }
  return [
    supported("fixtures"),
    supported("results"),
    supported("form"),
    supported("surface_ratings", "Per-surface ratings come from the historical corpus with sample sizes attached."),
    unsupported("tournament_draw", DRAW_NOTE),
    supported("head_to_head", H2H_NOTE)
  ];
}

export function teamSections(sport: EntitySport): SectionSupport[] {
  if (sport === "football") {
    return [
      supported("table"),
      supported("fixtures"),
      supported("results"),
      supported("form"),
      supported("goals"),
      unsupported("squad", SQUAD_NOTE)
    ];
  }
  if (sport === "basketball") {
    return [
      unsupported("table", STANDINGS_NOTE),
      supported("fixtures"),
      supported("results"),
      supported("efficiency", "Pace and efficiency come from stored rating evidence where present."),
      unsupported("roster", SQUAD_NOTE)
    ];
  }
  return playerSections("tennis");
}

export function playerSections(sport: EntitySport): SectionSupport[] {
  if (sport === "tennis") {
    return [
      supported("fixtures"),
      supported("results"),
      supported("form"),
      supported("surface_ratings", "Per-surface ratings come from the historical corpus with sample sizes attached."),
      unsupported("tournament_draw", DRAW_NOTE),
      supported("head_to_head", H2H_NOTE)
    ];
  }
  // Football/basketball player data is not durable enough for a page section
  // set: no ratings, no availability feed, no per-player public corpus.
  return [
    unsupported("fixtures", "Per-player fixture data is not tracked for this sport."),
    unsupported("form", "Per-player form needs a player-performance feed OddsPadi does not publish yet."),
    unsupported("surface_ratings", "Surface ratings only exist for tennis."),
    unsupported("head_to_head", H2H_NOTE)
  ];
}
