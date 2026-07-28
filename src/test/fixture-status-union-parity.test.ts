import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCommunityTipSettlement } from "@/lib/community/tipSettlement";
import { parseHistoricalFootballIngestPayload } from "@/lib/sports/training/historicalIngestion";
import type { MatchStatus } from "@/lib/sports/types";

const ALL_STATUSES: MatchStatus[] = ["scheduled", "live", "finished", "postponed", "cancelled", "suspended"];

/**
 * `reconcileStoredFixtureStatus` demotes a stale live fixture to "suspended",
 * so that state is produced routinely — not only by an abandoned match. Any
 * consumer whose status union omits it will take whichever branch the value
 * falls through to, which in both settlement paths meant "finished".
 */
describe("fixture status union parity", () => {
  it("declares the same six states everywhere a fixture status is modelled", async () => {
    const offenders: string[] = [];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "_archived") await walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const source = await readFile(path, "utf8");
        for (const [index, line] of source.split("\n").entries()) {
          // A union listing "postponed" and "cancelled" is modelling a fixture
          // status; if it stops there it has dropped "suspended".
          if (!/"postponed"\s*\|\s*"cancelled"/.test(line)) continue;
          if (!line.includes('"suspended"')) offenders.push(`${path}:${index + 1}`);
        }
      }
    }

    await walk("src/lib");
    expect(offenders).toEqual([]);
  });

  it("settles a community tip only from a genuinely final provider state", () => {
    const tip = {
      id: "tip-1",
      fixtureId: "api-football:1",
      sport: "football" as const,
      kickoffAt: "2026-07-20T12:00:00.000Z",
      market: "match_winner",
      selection: "home",
      selectionLabel: "Arsenal",
      tippedOdds: 2,
      stakeUnits: 1,
      withdrawnAt: null
    };
    const settledFrom = ALL_STATUSES.filter((status) => {
      const decision = resolveCommunityTipSettlement(
        tip,
        { provider: "api-football", status, homeScore: 2, awayScore: 1, observedAt: "2026-07-20T13:00:00.000Z" },
        new Date("2026-07-20T14:00:00.000Z")
      );
      return decision.status === "settled";
    });

    // "cancelled" settles as a void with zero units, which is correct.
    expect(settledFrom.sort()).toEqual(["cancelled", "finished"]);
  });

  function corpusPayload(status: unknown) {
    return {
      fixtures: [
        {
          externalId: "hist-1",
          kickoffAt: "2026-05-01T12:00:00.000Z",
          league: { externalId: "league-1", name: "Premier League" },
          homeTeam: { externalId: "team-1", name: "Arsenal" },
          awayTeam: { externalId: "team-2", name: "Chelsea" },
          status,
          homeScore: 1,
          awayScore: 0
        }
      ]
    } as never;
  }

  it("refuses an unrecognised status rather than ingesting it as a finished result", () => {
    const parsed = parseHistoricalFootballIngestPayload(corpusPayload("abandoned"));

    expect(parsed).toHaveProperty("errors");
    expect((parsed as { errors: string[] }).errors.join(" ")).toContain("status is not a recognised fixture status");
  });

  it("keeps a suspended historical fixture out of the finished-result corpus", () => {
    // Previously "suspended" was not in the guard's union, so it fell through
    // to the default and was ingested as a completed match carrying the score
    // from the moment play stopped.
    const parsed = parseHistoricalFootballIngestPayload(corpusPayload("suspended"));

    expect(parsed).not.toHaveProperty("errors");
    expect((parsed as { fixtures: Array<{ status: string }> }).fixtures[0].status).toBe("suspended");
  });
});
