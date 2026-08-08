import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FixtureCard, type FixtureCardProps } from "@/components/product/FixtureCard";
import type { CardInput } from "@/lib/discovery/fixtureCard";

function card(overrides: Partial<CardInput> = {}): CardInput {
  return {
    fixtureStatus: "scheduled",
    decision: "pick",
    hasOfficialPick: false,
    settlement: null,
    oddsAreCurrent: true,
    hasHistoricalOdds: false,
    decimalOdds: 2.1,
    modelProbability: 0.55,
    reason: "The model sees value at the current price.",
    ...overrides
  };
}

function render(overrides: Partial<FixtureCardProps> = {}): string {
  return renderToStaticMarkup(
    <FixtureCard
      fixtureId="fx-1"
      href="/predictions/fx-1"
      homeTeam="Arsenal"
      awayTeam="Chelsea"
      competition="Premier League"
      kickoffLabel="Today 19:00"
      score={null}
      card={card()}
      {...overrides}
    />
  );
}

describe("the shared card renders one state", () => {
  it("shows the label and tags the state on the element", () => {
    const html = render();
    expect(html).toContain("Pick");
    expect(html).toContain('data-state="pick"');
    expect(html).toContain("is-pick");
  });

  it("reuses the existing match-card styles rather than a parallel set", () => {
    // A second card design with one of them dead is the opposite of a shared
    // card.
    expect(render()).toContain("match-card");
  });

  it("carries a stable fixture id for scroll restoration", () => {
    expect(render()).toContain('data-fixture-id="fx-1"');
  });
});

describe("what reaches the markup", () => {
  it("shows current odds and marks them current", () => {
    const html = render();
    expect(html).toContain("2.10");
    expect(html).toContain("current");
  });

  it("labels historical odds instead of showing a price", () => {
    const html = render({ card: card({ oddsAreCurrent: false, hasHistoricalOdds: true }) });
    expect(html).toContain("Historical odds only");
    expect(html).not.toContain("2.10");
  });

  it("shows no price at all when there is none to show", () => {
    const html = render({ card: card({ oddsAreCurrent: false, hasHistoricalOdds: false }) });
    expect(html).not.toContain("2.10");
    expect(html).not.toContain("Historical odds only");
  });

  it("shows a score instead of odds once there is one", () => {
    const html = render({ score: { home: 2, away: 1 }, card: card({ fixtureStatus: "finished" }) });
    expect(html).toContain("2–1");
    expect(html).not.toContain("fixture-card-odds");
  });

  it("drops the pre-kickoff rationale once the match has started", () => {
    // "The model sees value at the current price" is present tense about a
    // market that closed hours ago.
    const finished = render({ score: { home: 2, away: 1 }, card: card({ fixtureStatus: "finished" }) });
    expect(finished).not.toContain("sees value");
    expect(finished).toContain("This fixture has finished.");

    const live = render({ card: card({ fixtureStatus: "live" }) });
    expect(live).not.toContain("sees value");
    expect(live).toContain("In play.");
  });

  it("never renders internal gate text", () => {
    const html = render({ card: card({ reason: "blocked: calibration_support below 0.62" }) });
    expect(html).not.toContain("calibration_support");
    expect(html).not.toContain("blocked");
    expect(html).toContain("The model sees value");
  });

  it("drops the summary in the compact variant", () => {
    const html = render({ variant: "compact" });
    expect(html).toContain("is-compact");
    expect(html).not.toContain("The model sees value");
    // The state and the teams survive, because a compact card is still a card.
    expect(html).toContain("Pick");
    expect(html).toContain("Arsenal");
  });

  it("distinguishes a result being verified from a finished fixture", () => {
    const verifying = render({
      score: { home: 1, away: 1 },
      card: card({ fixtureStatus: "finished", hasOfficialPick: true, settlement: "unsettled" })
    });
    expect(verifying).toContain("Result being verified");
    expect(render({ score: { home: 1, away: 1 }, card: card({ fixtureStatus: "finished" }) })).toContain("Finished");
  });

  it("marks a live fixture with an indicator", () => {
    const html = render({ card: card({ fixtureStatus: "live" }) });
    expect(html).toContain("fixture-card-live-dot");
    expect(html).toContain("is-live");
  });

  it("renders caller actions without knowing what they are", () => {
    const html = render({ actions: <button type="button">Add to slip</button> });
    expect(html).toContain("Add to slip");
    expect(html).toContain("fixture-card-actions");
  });

  it("omits the actions row entirely when there are none", () => {
    expect(render()).not.toContain("fixture-card-actions");
  });
});

describe("accessibility", () => {
  it("gives the state an accessible label rather than colour alone", () => {
    expect(render()).toContain('aria-label="Status: Pick"');
  });

  it("labels the score for a screen reader", () => {
    expect(render({ score: { home: 2, away: 1 }, card: card({ fixtureStatus: "finished" }) })).toContain(
      'aria-label="Score 2 1"'
    );
  });

  it("hides the decorative separator and the live dot from assistive tech", () => {
    const html = render({ card: card({ fixtureStatus: "live" }) });
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
