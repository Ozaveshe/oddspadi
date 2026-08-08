import { describe, expect, it } from "vitest";
import { groupResults, isAmbiguous, normaliseQuery, searchEntities, type SearchableEntity } from "@/lib/discovery/search";
import {
  continuityHolds,
  fixturePhase,
  fixtureRoute,
  resolveContinuity,
  type ContinuityInput
} from "@/lib/discovery/liveContinuity";

function entity(overrides: Partial<SearchableEntity> = {}): SearchableEntity {
  return { kind: "team", id: "t1", name: "Arsenal", context: "England", ...overrides };
}

const CATALOGUE: SearchableEntity[] = [
  entity({ id: "arsenal", name: "Arsenal", context: "England", prominence: 20, aliases: ["Gunners", "AFC"] }),
  entity({ id: "arsenal-sarandi", name: "Arsenal de Sarandí", context: "Argentina", prominence: 2 }),
  entity({ id: "atletico", name: "Atlético Madrid", context: "Spain", prominence: 18 }),
  entity({ id: "man-utd", name: "Manchester United", context: "England", prominence: 20, aliases: ["Man Utd"] }),
  entity({ id: "sunderland", name: "Sunderland", context: "England", prominence: 6 }),
  entity({ kind: "player", id: "saka", name: "Bukayo Saka", context: "Arsenal", prominence: 10 }),
  entity({ kind: "competition", id: "epl", name: "Premier League", context: "England", prominence: 25 }),
  entity({
    kind: "fixture",
    id: "fx-tonight",
    name: "Arsenal v Chelsea",
    context: "Premier League",
    kickoffAt: "2026-08-08T19:00:00.000Z"
  }),
  entity({
    kind: "fixture",
    id: "fx-old",
    name: "Arsenal v Everton",
    context: "Premier League",
    kickoffAt: "2026-03-01T19:00:00.000Z"
  })
];

const NOW = new Date("2026-08-08T12:00:00.000Z");

function search(query: string, options = {}) {
  return searchEntities(query, CATALOGUE, { now: NOW, ...options });
}

describe("search normalisation", () => {
  it("folds accents so plain ASCII finds the accented name", () => {
    expect(normaliseQuery("Atlético")).toBe("atletico");
    expect(search("atletico")[0]?.entity.id).toBe("atletico");
  });

  it("ignores punctuation and extra whitespace", () => {
    expect(normaliseQuery("  Man.  Utd!  ")).toBe("man utd");
    expect(search("man utd")[0]?.entity.id).toBe("man-utd");
  });

  it("refuses a one-character query", () => {
    // Ranking most of the catalogue by prominence is a popularity list, not a
    // search result.
    expect(search("a")).toEqual([]);
    expect(search("ar").length).toBeGreaterThan(0);
  });
});

describe("ranking", () => {
  it("prefers an exact match over a prefix of a longer name", () => {
    expect(search("arsenal")[0]?.entity.id).toBe("arsenal");
  });

  it("breaks equal textual matches by prominence", () => {
    // Both are "Arsenal…"; the top-flight club is what almost everyone means.
    const ids = search("arsenal").map((result) => result.entity.id);
    expect(ids.indexOf("arsenal")).toBeLessThan(ids.indexOf("arsenal-sarandi"));
  });

  it("matches on a word boundary rather than anywhere in the string", () => {
    // "land" must not pull in Sunderland; every such hit is noise a reader has
    // to read past to reach what they typed.
    expect(search("land").map((r) => r.entity.id)).not.toContain("sunderland");
    expect(search("sund").map((r) => r.entity.id)).toContain("sunderland");
    // A second word still matches at its own boundary.
    expect(search("madrid").map((r) => r.entity.id)).toContain("atletico");
  });

  it("finds an entity by alias and says which string matched", () => {
    const [top] = search("gunners");
    expect(top?.entity.id).toBe("arsenal");
    expect(top?.matchedOn).toBe("Gunners");
  });

  it("prefers a name match over an alias match of the same quality", () => {
    const nameMatch = search("arsenal").find((r) => r.entity.id === "arsenal")!;
    const aliasMatch = search("afc").find((r) => r.entity.id === "arsenal")!;
    expect(nameMatch.score).toBeGreaterThan(aliasMatch.score);
  });

  it("prefers tonight's fixture over one from five months ago", () => {
    const fixtures = search("arsenal v").filter((r) => r.entity.kind === "fixture");
    expect(fixtures[0]?.entity.id).toBe("fx-tonight");
  });
});

describe("entity kinds", () => {
  it("returns teams and fixtures for a club name, and players by their own name", () => {
    // A player is not findable by their club: context disambiguates a result,
    // it is not a second name for the entity.
    const club = new Set(search("arsenal").map((result) => result.entity.kind));
    expect(club.has("team")).toBe(true);
    expect(club.has("fixture")).toBe(true);
    expect(club.has("player")).toBe(false);
    expect(search("saka")[0]?.entity.kind).toBe("player");
    expect(search("premier")[0]?.entity.kind).toBe("competition");
  });

  it("filters to requested kinds", () => {
    const results = search("arsenal", { kinds: ["fixture"] });
    expect(results.every((result) => result.entity.kind === "fixture")).toBe(true);
  });

  it("groups without losing rank inside a group", () => {
    const groups = groupResults(search("arsenal"));
    expect(groups.map((group) => group.kind)[0]).toBe("team");
    const fixtures = groups.find((group) => group.kind === "fixture")!;
    expect(fixtures.results[0]?.entity.id).toBe("fx-tonight");
  });

  it("resolves every result to a canonical id", () => {
    for (const result of search("arsenal")) {
      expect(result.entity.id).toBeTruthy();
      expect(result.entity.kind).toBeTruthy();
    }
  });
});

describe("ambiguity", () => {
  it("reports a genuine tie rather than picking one", () => {
    const twins: SearchableEntity[] = [
      entity({ id: "a", name: "Rangers", context: "Scotland", prominence: 10 }),
      entity({ id: "b", name: "Rangers", context: "England", prominence: 10 })
    ];
    expect(isAmbiguous(searchEntities("rangers", twins, { now: NOW }))).toBe(true);
  });

  it("is not ambiguous when prominence separates them", () => {
    expect(isAmbiguous(search("arsenal"))).toBe(false);
  });
});

describe("live continuity", () => {
  function input(overrides: Partial<ContinuityInput> = {}): ContinuityInput {
    return { fixtureId: "fx-1", status: "scheduled", hasPreMatchDecision: true, hasApprovedLiveModel: false, ...overrides };
  }

  it("keeps one route across every phase", () => {
    const routes = (["scheduled", "live", "finished", "postponed"] as const).map(
      (status) => resolveContinuity(input({ status })).route
    );
    expect(new Set(routes).size).toBe(1);
    expect(routes[0]).toBe(fixtureRoute("fx-1"));
  });

  it("retains user state through every transition", () => {
    for (const status of ["scheduled", "live", "finished"] as const) {
      expect(resolveContinuity(input({ status })).retainsUserState).toBe(true);
    }
  });

  it("stops calling a pre-match decision current once the ball moves", () => {
    const before = resolveContinuity(input({ status: "scheduled" }));
    const during = resolveContinuity(input({ status: "live" }));
    expect(before.analysisIsCurrent).toBe(true);
    expect(during.analysisIsCurrent).toBe(false);
    expect(during.provenance).toBe("pre_match");
    expect(during.historicalNote).toContain("before kickoff");
  });

  it("lets an approved live model speak in the present tense", () => {
    const live = resolveContinuity(input({ status: "live", hasApprovedLiveModel: true }));
    expect(live.analysisIsCurrent).toBe(true);
    expect(live.provenance).toBe("live_approved");
    expect(live.historicalNote).toBeNull();
  });

  it("presents a result once the fixture is done", () => {
    const finished = resolveContinuity(input({ status: "finished" }));
    expect(finished.presentsResult).toBe(true);
    expect(finished.analysisIsCurrent).toBe(false);
    expect(finished.historicalNote).toContain("what actually happened");
  });

  it("says nothing historical when there was no decision to preserve", () => {
    expect(resolveContinuity(input({ status: "live", hasPreMatchDecision: false })).historicalNote).toBeNull();
    expect(resolveContinuity(input({ status: "live", hasPreMatchDecision: false })).provenance).toBe("none");
  });

  it("maps every terminal status to the completed phase", () => {
    for (const status of ["finished", "postponed", "cancelled", "abandoned"] as const) {
      expect(fixturePhase(status)).toBe("completed");
    }
    expect(fixturePhase("scheduled")).toBe("pre_match");
    expect(fixturePhase("live")).toBe("live");
  });
});

describe("transitions that must not break", () => {
  function at(status: ContinuityInput["status"], overrides: Partial<ContinuityInput> = {}) {
    return resolveContinuity({
      fixtureId: "fx-1",
      status,
      hasPreMatchDecision: true,
      hasApprovedLiveModel: false,
      ...overrides
    });
  }

  it("holds from scheduled to live", () => {
    expect(continuityHolds(at("scheduled"), at("live")).held).toBe(true);
  });

  it("holds from live to finished", () => {
    expect(continuityHolds(at("live"), at("finished")).held).toBe(true);
  });

  it("catches a moved route", () => {
    const before = at("scheduled");
    const after = { ...at("live"), route: "/live/fx-1" };
    const check = continuityHolds(before, after);
    expect(check.held).toBe(false);
    expect(check.broken[0]).toContain("route moved");
  });

  it("catches a pre-match decision relabelled as an approved live model", () => {
    // The failure that matters most: a number made before kickoff, presented
    // as a read on a match in progress.
    const check = continuityHolds(at("scheduled"), at("live", { hasApprovedLiveModel: true }));
    expect(check.held).toBe(false);
    expect(check.broken.join(" ")).toContain("re-presented as an approved live model");
  });

  it("catches a finished fixture reverting to a forecast", () => {
    const check = continuityHolds(at("finished"), at("live"));
    expect(check.held).toBe(false);
    expect(check.broken.join(" ")).toContain("presenting a forecast");
  });
});
