import { describe, expect, it } from "vitest";
import {
  DATA_AVAILABILITY_STATES,
  DECISION_STATUSES,
  FIXTURE_STATUSES,
  PUBLICATION_STATUSES,
  SETTLEMENT_STATUSES
} from "@/lib/domain/states";
import {
  actionLanguageAllowed,
  coherentCells,
  explainIncoherence,
  isCoherent,
  mayHaveScore,
  REPRESENTATIVE_CELLS,
  representativeCoverage,
  type StateCell
} from "@/lib/domain/stateMatrix";

describe("the coherence model", () => {
  it("keeps every representative cell coherent", () => {
    const broken = REPRESENTATIVE_CELLS.filter(({ cell }) => !isCoherent(cell)).map(({ id, cell }) => ({
      id,
      why: explainIncoherence(cell)
    }));
    expect(broken).toEqual([]);
  });

  it("covers every value of every dimension", () => {
    // A representative set that stops exercising a state is worse than no set:
    // it reads as coverage while the state goes untested.
    const coverage = representativeCoverage();
    expect(coverage.fixture).toEqual([...FIXTURE_STATUSES].filter((s) => s !== "unknown").sort());
    expect(coverage.data).toEqual([...DATA_AVAILABILITY_STATES].sort());
    expect(coverage.decision).toEqual([...DECISION_STATUSES].sort());
    expect(coverage.publication).toEqual(["none", ...PUBLICATION_STATUSES].sort());
    // Every settlement except the ones no coherent cell can reach.
    expect(coverage.settlement).toEqual(
      [...SETTLEMENT_STATUSES].filter((s) => s !== "cancelled").sort()
    );
  });

  it("rejects a settlement on a fixture that has not ended", () => {
    const cell: StateCell = {
      fixture: "scheduled",
      data: "complete",
      decision: "pick",
      publication: "published",
      settlement: "won"
    };
    expect(explainIncoherence(cell)).toContainEqual(expect.stringContaining("has not ended"));
  });

  it("rejects a settlement with nothing published to settle", () => {
    const cell: StateCell = {
      fixture: "finished",
      data: "complete",
      decision: "pick",
      publication: null,
      settlement: "won"
    };
    expect(explainIncoherence(cell)).toContainEqual(expect.stringContaining("no published claim"));
  });

  it("refuses to let a failed read become anything but unavailable", () => {
    // The single most important rule in the file.
    for (const decision of DECISION_STATUSES) {
      const cell: StateCell = {
        fixture: "scheduled",
        data: "unavailable",
        decision,
        publication: null,
        settlement: "unsettled"
      };
      const coherent = isCoherent(cell);
      expect(coherent, `data unavailable + decision ${decision}`).toBe(decision === "unavailable");
    }
  });

  it("refuses to publish anything that is not a pick", () => {
    for (const decision of DECISION_STATUSES) {
      const cell: StateCell = {
        fixture: "scheduled",
        data: "complete",
        decision,
        publication: "published",
        settlement: "unsettled"
      };
      expect(isCoherent(cell), `decision ${decision} published`).toBe(decision === "pick");
    }
  });

  it("refuses a decided outcome on an abandoned or cancelled fixture", () => {
    for (const fixture of ["abandoned", "cancelled"] as const) {
      for (const settlement of ["won", "lost", "push"] as const) {
        const cell: StateCell = { fixture, data: "complete", decision: "pick", publication: "published", settlement };
        expect(isCoherent(cell), `${fixture} + ${settlement}`).toBe(false);
      }
      const voided: StateCell = {
        fixture,
        data: "complete",
        decision: "pick",
        publication: "published",
        settlement: "void"
      };
      expect(isCoherent(voided), `${fixture} + void`).toBe(true);
    }
  });

  it("allows pre-kickoff language only before a fixture starts", () => {
    for (const status of FIXTURE_STATUSES) {
      expect(actionLanguageAllowed(status), status).toBe(status === "scheduled" || status === "delayed");
    }
  });

  it("allows a score only where one can exist", () => {
    for (const status of FIXTURE_STATUSES) {
      expect(mayHaveScore(status), status).toBe(status === "live" || status === "finished" || status === "abandoned");
    }
  });

  it("produces a matrix far smaller than the cross-product", () => {
    const cells = coherentCells();
    const crossProduct =
      (FIXTURE_STATUSES.length - 1) *
      DATA_AVAILABILITY_STATES.length *
      DECISION_STATUSES.length *
      (PUBLICATION_STATUSES.length + 1) *
      SETTLEMENT_STATUSES.length;

    expect(cells.length).toBeGreaterThan(50);
    expect(cells.length).toBeLessThan(crossProduct / 3);
    // Every generated cell must survive its own rules.
    expect(cells.every(isCoherent)).toBe(true);
  });
});
