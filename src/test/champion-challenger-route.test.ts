import { beforeEach, describe, expect, it, vi } from "vitest";

const previewChampionChallengerComparison = vi.hoisted(() => vi.fn());
const runAndStoreChampionChallengerComparison = vi.hoisted(() => vi.fn());
const isTrainingAdminAuthorized = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sports/prediction/championChallengerRepository", () => ({
  previewChampionChallengerComparison,
  runAndStoreChampionChallengerComparison
}));
vi.mock("@/lib/sports/training/adminAuth", () => ({ isTrainingAdminAuthorized }));

import { GET, POST } from "@/app/api/sports/decision/training/champion-challenger/route";

describe("champion challenger route", () => {
  beforeEach(() => vi.resetAllMocks());

  it("previews paired evidence without a write", async () => {
    previewChampionChallengerComparison.mockResolvedValue({ status: "ready", receipt: { status: "warming" } });
    const response = await GET(new Request("http://localhost/api/sports/decision/training/champion-challenger?sport=football&challengerCandidateId=candidate-2"));

    expect(response.status).toBe(200);
    expect(previewChampionChallengerComparison).toHaveBeenCalledWith({ sport: "football", challengerCandidateId: "candidate-2" });
    expect(runAndStoreChampionChallengerComparison).not.toHaveBeenCalled();
  });

  it("requires admin authorization before storing a receipt", async () => {
    isTrainingAdminAuthorized.mockReturnValue(false);
    const response = await POST(new Request("http://localhost/api/sports/decision/training/champion-challenger", {
      method: "POST",
      body: JSON.stringify({ sport: "football", challengerCandidateId: "candidate-2" })
    }));

    expect(response.status).toBe(401);
    expect(runAndStoreChampionChallengerComparison).not.toHaveBeenCalled();
  });

  it("stores an immutable comparison receipt through the authenticated POST path", async () => {
    isTrainingAdminAuthorized.mockReturnValue(true);
    runAndStoreChampionChallengerComparison.mockResolvedValue({ status: "stored", id: "comparison-1" });
    const response = await POST(new Request("http://localhost/api/sports/decision/training/champion-challenger", {
      method: "POST",
      body: JSON.stringify({ sport: "tennis", challengerCandidateId: "candidate-2" })
    }));

    expect(response.status).toBe(200);
    expect(runAndStoreChampionChallengerComparison).toHaveBeenCalledWith({ sport: "tennis", challengerCandidateId: "candidate-2" });
  });
});
