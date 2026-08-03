import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchHeader } from "@/components/match/MatchIntelligenceSections";
import { SlateFixtureCard } from "@/components/odds/IntelligenceSlate";
import { isCoherent, type StateCell } from "@/lib/domain/stateMatrix";
import { parseSurfaceClaims } from "@/lib/domain/surfaceClaim";
import { OFFICIAL_LEDGER_CLASSES, RECORD_CLASSES } from "@/lib/domain/states";
import { buildWorld, WORLD_NOW } from "./support/canonicalWorld";

/**
 * The thirteen states the product is forbidden to be in.
 *
 * Each of these has either happened here or is one edit away. They are grouped
 * by how they are prevented, because the prevention matters more than the
 * assertion: a contradiction blocked by a type or a database constraint cannot
 * recur, while one blocked only by a test recurs the moment someone writes the
 * code before running the suite.
 *
 * Two of the thirteen are enforced elsewhere and asserted there rather than
 * duplicated: raw operational objects in public responses
 * (`job-endpoint-security.test.ts`) and unauthenticated job endpoints
 * (`operational-boundary.test.ts`). This file asserts those files still exist
 * and still carry those checks, so deleting them fails CI here too.
 */

function render(id: string, cell: StateCell): string {
  const world = buildWorld(id, cell);
  return [
    renderToStaticMarkup(<SlateFixtureCard row={world.slateRow} surface="today" asOf={WORLD_NOW} />),
    renderToStaticMarkup(
      <MatchHeader view={world.intelligence} fixtureId={world.fixtureId} availability={world.availability} />
    )
  ].join("\n");
}

/** Strip tags so copy assertions read prose, not attribute values. */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").toLowerCase();
}

describe("1. a finished match never carries pre-kickoff language", () => {
  const PRE_KICKOFF = [
    "before kickoff",
    "before kick-off",
    "kicks off in",
    "starts in",
    "add to your slip",
    "back this",
    "still time",
    "monitor this",
    "check back before"
  ];

  for (const status of ["finished", "cancelled", "abandoned", "postponed"] as const) {
    it(`${status} fixtures use no countdown or action copy`, () => {
      const cell: StateCell = {
        fixture: status,
        data: "complete",
        decision: status === "postponed" ? "pass" : "pick",
        publication: status === "postponed" ? null : "published",
        settlement: status === "finished" ? "won" : status === "postponed" ? "unsettled" : "void"
      };
      const body = text(render(`terminal-${status}`, cell));
      for (const phrase of PRE_KICKOFF) {
        expect(body, `${status} rendered "${phrase}"`).not.toContain(phrase);
      }
    });
  }

  it("marks the fixture terminal in the claim so other surfaces cannot disagree", () => {
    const claims = parseSurfaceClaims(
      render("terminal-claim", {
        fixture: "finished",
        data: "complete",
        decision: "pick",
        publication: "published",
        settlement: "won"
      })
    );
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(claim.fixtureStatus).toBe("finished");
  });
});

describe("2. stored odds and \"no odds available\" cannot both be true", () => {
  it("never states both on one fixture", () => {
    for (const data of ["complete", "partial", "stale", "unavailable", "confirmed_empty"] as const) {
      const html = render(`odds-${data}`, {
        fixture: "scheduled",
        data,
        decision: data === "unavailable" ? "unavailable" : data === "complete" ? "pick" : "watch",
        publication: null,
        settlement: "unsettled"
      });
      const stated = new Set(parseSurfaceClaims(html).map((c) => c.oddsAvailable).filter((v) => v !== null));
      expect(stated.size, `${data} produced conflicting odds availability`).toBeLessThanOrEqual(1);
    }
  });
});

describe("3. a database failure is never rendered as zero", () => {
  it("keeps an unavailable read unavailable rather than confirmed empty", () => {
    const html = render("read-failed", {
      fixture: "scheduled",
      data: "unavailable",
      decision: "unavailable",
      publication: null,
      settlement: "unsettled"
    });
    for (const claim of parseSurfaceClaims(html)) {
      expect(claim.dataAvailability).toBe("unavailable");
      // The two states that would misrepresent a failure as a finding.
      expect(claim.dataAvailability).not.toBe("confirmed_empty");
      expect(claim.decision).not.toBe("pass");
    }
  });

  it("treats confirmed-empty as a different state entirely", () => {
    const html = render("genuinely-empty", {
      fixture: "scheduled",
      data: "confirmed_empty",
      decision: "pass",
      publication: null,
      settlement: "unsettled"
    });
    for (const claim of parseSurfaceClaims(html)) expect(claim.dataAvailability).toBe("confirmed_empty");
  });
});

describe("4. an official pick always has a publication time", () => {
  it("cannot represent a published claim without one", () => {
    const world = buildWorld("published", {
      fixture: "scheduled",
      data: "complete",
      decision: "pick",
      publication: "published",
      settlement: "unsettled"
    });
    expect(world.publication).not.toBeNull();
    expect(world.publication!.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // And it must precede kickoff, or it is not evidence of a forecast.
    expect(Date.parse(world.publication!.publishedAt)).toBeLessThan(Date.parse(world.publication!.kickoffAt));
  });
});

describe("5. settlement without publication is incoherent", () => {
  it("is rejected by the coherence model for every settled state", () => {
    for (const settlement of ["won", "lost", "push", "void", "pending_verification"] as const) {
      expect(
        isCoherent({ fixture: "finished", data: "complete", decision: "pick", publication: null, settlement }),
        `${settlement} with no publication`
      ).toBe(false);
    }
  });
});

describe("6. an article's pick count cites publication IDs", () => {
  it("keeps the editorial gate wired to the ledger, not to a recount", async () => {
    // The specific failure: a story said "3 winning picks" computed from a
    // query, while the ledger held none. Counts in copy must come from IDs.
    const source = await readFile("src/lib/editorial/articleValidation.ts", "utf8").catch(() => "");
    expect(source, "the editorial validation gate must still exist").not.toBe("");
    expect(source).toMatch(/publicationId|publication_id/);
  });
});

describe("7. a live model label requires a live model run", () => {
  it("never labels a pre-match run as live", () => {
    const world = buildWorld("live-label", {
      fixture: "live",
      data: "complete",
      decision: "pick",
      publication: "published",
      settlement: "unsettled"
    });
    const model = world.intelligence.model;
    if (model.state !== "available") return;
    // The world builds `isLiveRun: false`, so the view-model must not claim a
    // live basis merely because the fixture is in play.
    expect(model.basis).toBe("pre-match");
    expect(model.basisNote, "a pre-match model on a live fixture must say so").not.toBeNull();
  });
});

describe("8. one decision cannot be both high and low uncertainty", () => {
  it("derives every uncertainty statement from one interval", () => {
    const world = buildWorld("uncertainty", {
      fixture: "scheduled",
      data: "complete",
      decision: "pick",
      publication: "published",
      settlement: "unsettled"
    });
    const model = world.intelligence.model;
    if (model.state !== "available" || !model.interval) return;
    expect(model.interval.low).toBeLessThanOrEqual(model.interval.high);
    // A single interval means there is no second place for a contradictory
    // confidence label to come from.
    expect(model.probabilities.home).toBeGreaterThanOrEqual(model.interval.low);
    expect(model.probabilities.home).toBeLessThanOrEqual(model.interval.high);
  });
});

describe("9-11. only official picks reach the official record", () => {
  it("allows exactly one record class into the ledger", () => {
    expect([...OFFICIAL_LEDGER_CLASSES]).toEqual(["official_public_pick"]);
  });

  it("excludes community selections, backtests, simulations and shadow runs", () => {
    for (const excluded of ["community_selection", "backtest_record", "simulation", "shadow_decision"] as const) {
      expect(RECORD_CLASSES).toContain(excluded);
      expect(OFFICIAL_LEDGER_CLASSES.has(excluded)).toBe(false);
    }
  });
});

describe("12. a pre-season zero table is not an official ranking", () => {
  it("keeps the pre-season state distinguishable from a real standings read", async () => {
    const source = await readFile("src/lib/discovery/tableState.ts", "utf8").catch(() => "");
    expect(source, "the table-state module must still exist").not.toBe("");
    // A table of zeroes before a ball is kicked is not a ranking, and must not
    // be presented as one.
    expect(source).toMatch(/pre-?season/i);
  });
});

describe("13. the checks enforced elsewhere still exist", () => {
  it("keeps the public-response sanitisation suite", async () => {
    const source = await readFile("src/test/job-endpoint-security.test.ts", "utf8");
    expect(source).toContain("toPublicRunReceipt");
    expect(source).toContain("statement timeout");
  });

  it("keeps the operational-boundary suite", async () => {
    const source = await readFile("src/test/operational-boundary.test.ts", "utf8");
    expect(source).toContain("guards every handler");
    expect(source).toContain("fails closed");
  });
});
