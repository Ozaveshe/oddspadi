import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";

const CSV = [
  "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A,PSH,PSD,PSA,AvgH,AvgD,AvgA",
  "E0,13/08/98,12:30,Hull,Leicester,2,1,H,4.50,3.50,1.91,4.65,3.62,1.88,4.52,3.55,1.90",
  "E0,13/08/98,15:00,Burnley,Swansea,0,1,A,2.40,3.30,3.25,2.44,3.28,3.21,2.42,3.31,3.22",
  "E0,20/08/98,15:00,Leicester,Arsenal,0,0,D,2.70,3.40,2.80,2.76,3.42,2.74,2.73,3.41,2.77"
].join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ODDSPADI_PUBLIC_HISTORY_CACHE_TTL_MS;
});

describe("football-data historical learning dossier cache", () => {
  it("reuses the default read-only dossier across equivalent server requests", async () => {
    const fetchMock = vi.fn(async () => new Response(CSV, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const request = {
      seasonFrom: 1998,
      seasonTo: 1998,
      maxSeasons: 1,
      trainRatio: 0.5,
      minEdge: 0,
      minModelProbability: 0.2,
      minPickCount: 2,
      minTrainingSeasons: 1
    };
    const first = await buildFootballDataHistoricalLearningDossier(request);
    const second = await buildFootballDataHistoricalLearningDossier(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(second.dossierHash).toBe(first.dossierHash);
  });
});
