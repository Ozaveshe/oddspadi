import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchHeader } from "@/components/match/MatchIntelligenceSections";
import { SlateFixtureCard } from "@/components/odds/IntelligenceSlate";
import { REPRESENTATIVE_CELLS } from "@/lib/domain/stateMatrix";
import {
  parseSurfaceClaims,
  reconcileClaims,
  type PublicSurface,
  type SurfaceClaim
} from "@/lib/domain/surfaceClaim";
import { buildWorld, WORLD_NOW, type CanonicalWorld } from "./support/canonicalWorld";

/**
 * The same fixture, rendered by every surface that can show it, compared.
 *
 * This is the test the product did not have. Component tests proved each
 * renderer was internally consistent; nothing proved that Today and the match
 * page, reading through different modules, arrived at the same answer. The
 * failures that reached production were all of that shape — a correct function
 * on each side of a disagreement.
 *
 * So: build one world from one state cell, render the real components, parse
 * the claims back out of the HTML they produced, and require them to agree.
 * Nothing here inspects a data structure; every assertion is about output.
 */

/** Render the surfaces that can show a slate row, plus the match page. */
function renderSurfaces(world: CanonicalWorld): { html: string; claims: SurfaceClaim[] } {
  const slateSurfaces: PublicSurface[] = ["today", "prediction-list", "results", "competition"];
  const parts = slateSurfaces.map((surface) =>
    renderToStaticMarkup(
      <SlateFixtureCard row={world.slateRow} surface={surface} asOf={WORLD_NOW} />
    )
  );
  parts.push(
    renderToStaticMarkup(
      <MatchHeader view={world.intelligence} fixtureId={world.fixtureId} availability={world.availability} />
    )
  );
  const html = parts.join("\n");
  return { html, claims: parseSurfaceClaims(html) };
}

describe("every surface tells the same story", () => {
  for (const { id, cell, note } of REPRESENTATIVE_CELLS) {
    it(`${id} — ${note}`, () => {
      const world = buildWorld(id, cell);
      const { claims } = renderSurfaces(world);

      // A surface that renders a fixture without stamping a claim is invisible
      // to this suite, which would make the suite pass by rendering nothing.
      expect(claims.length, "every rendered surface must stamp a claim").toBeGreaterThanOrEqual(5);

      const conflicts = reconcileClaims(claims);
      expect(conflicts, `surfaces disagree about ${world.fixtureId}`).toEqual([]);
    });
  }

  it("agrees on fixture identity", () => {
    const world = buildWorld("identity", REPRESENTATIVE_CELLS[0].cell);
    const { claims } = renderSurfaces(world);
    expect(new Set(claims.map((claim) => claim.fixtureId))).toEqual(new Set([world.fixtureId]));
  });

  it("agrees on the score wherever one exists", () => {
    const world = buildWorld("score", {
      fixture: "finished",
      data: "complete",
      decision: "pick",
      publication: "published",
      settlement: "won"
    });
    const { claims } = renderSurfaces(world);
    const scores = new Set(claims.map((claim) => claim.score).filter((s): s is string => s !== null));
    expect(scores).toEqual(new Set(["2-1"]));
    // Every surface that can show a score must show one for a finished match.
    expect(claims.filter((claim) => claim.score !== null).length).toBeGreaterThan(0);
  });

  it("never shows a score for a fixture that cannot have one", () => {
    for (const status of ["scheduled", "postponed", "cancelled"] as const) {
      const world = buildWorld(`no-score-${status}`, {
        fixture: status,
        data: "complete",
        decision: "pass",
        publication: null,
        settlement: "unsettled"
      });
      const { claims } = renderSurfaces(world);
      const withScore = claims.filter((claim) => claim.score !== null);
      expect(withScore.map((c) => c.surface), `${status} must not carry a score`).toEqual([]);
    }
  });

  it("uses comparable timestamp semantics everywhere", () => {
    const world = buildWorld("timestamps", REPRESENTATIVE_CELLS[0].cell);
    const { claims } = renderSurfaces(world);
    for (const claim of claims) {
      if (claim.asOf === null) continue;
      // A rendered "19:00" is meaningless across surfaces because each renders
      // in the reader's timezone. The claim must carry a UTC instant.
      expect(Number.isFinite(Date.parse(claim.asOf)), `${claim.surface} asOf must parse`).toBe(true);
      expect(claim.asOf, `${claim.surface} asOf must be UTC ISO-8601`).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
      );
    }
  });

  it("does not contradict itself about whether odds exist", () => {
    // "We have a price" and "no odds available" on the same fixture is one of
    // the named prohibited contradictions.
    for (const { id, cell } of REPRESENTATIVE_CELLS) {
      const world = buildWorld(`odds-${id}`, cell);
      const { claims } = renderSurfaces(world);
      const stated = new Set(
        claims.map((claim) => claim.oddsAvailable).filter((v): v is boolean => v !== null)
      );
      expect(stated.size, `${id} disagrees about odds availability`).toBeLessThanOrEqual(1);
    }
  });

  it("agrees on publication identity and settlement", () => {
    const world = buildWorld("settled", {
      fixture: "finished",
      data: "complete",
      decision: "pick",
      publication: "published",
      settlement: "won"
    });
    const { claims } = renderSurfaces(world);
    const ids = new Set(claims.map((c) => c.publicationId).filter(Boolean));
    const settlements = new Set(claims.map((c) => c.settlement).filter(Boolean));
    // Surfaces may stay silent, but none may name a different publication.
    expect(ids.size).toBeLessThanOrEqual(1);
    expect(settlements.size).toBeLessThanOrEqual(1);
  });

  it("shows stale state consistently rather than on one surface only", () => {
    const world = buildWorld("stale", {
      fixture: "scheduled",
      data: "stale",
      decision: "withheld",
      publication: null,
      settlement: "unsettled"
    });
    const { claims } = renderSurfaces(world);
    const availabilities = new Set(claims.map((claim) => claim.dataAvailability));
    expect(availabilities, "staleness must not be visible on some surfaces only").toEqual(new Set(["stale"]));
  });

  it("keeps a failed read unavailable on every surface", () => {
    const world = buildWorld("failed-read", {
      fixture: "scheduled",
      data: "unavailable",
      decision: "unavailable",
      publication: null,
      settlement: "unsettled"
    });
    const { claims } = renderSurfaces(world);
    for (const claim of claims) {
      expect(claim.dataAvailability, `${claim.surface} turned a failed read into something else`).toBe("unavailable");
      // Critically: not "pass". A failed read rendered as a considered no-value
      // verdict is the defect the entire taxonomy exists to prevent.
      expect(claim.decision).not.toBe("pass");
    }
  });
});
