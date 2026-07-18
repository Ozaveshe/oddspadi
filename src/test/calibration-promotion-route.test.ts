import { beforeEach, describe, expect, it, vi } from "vitest";

const isTrainingAdminAuthorized = vi.hoisted(() => vi.fn());
const readActiveCalibrationPromotion = vi.hoisted(() => vi.fn());
const approveCalibrationCandidate = vi.hoisted(() => vi.fn());
const revokeCalibrationPromotion = vi.hoisted(() => vi.fn());
const readCalibrationDriftReceipt = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sports/training/adminAuth", () => ({ isTrainingAdminAuthorized }));
vi.mock("@/lib/sports/prediction/decisionCalibrationPromotion", () => ({
  readActiveCalibrationPromotion,
  approveCalibrationCandidate,
  revokeCalibrationPromotion
}));
vi.mock("@/lib/sports/prediction/calibrationDriftGuard", () => ({ readCalibrationDriftReceipt }));

import { GET, POST } from "@/app/api/sports/decision/training/calibration-promotion/route";

describe("calibration promotion route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads the active promotion without revealing credentials", async () => {
    readActiveCalibrationPromotion.mockResolvedValue({ status: "not-found" });

    const response = await GET(new Request("http://localhost/api/sports/decision/training/calibration-promotion?sport=football"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: { status: "not-found" } });
    expect(readActiveCalibrationPromotion).toHaveBeenCalledWith("football");
  });

  it("returns the exact out-of-sample drift receipt with an active promotion", async () => {
    const activePromotion = { id: "promotion-1", candidateId: "candidate-1", sport: "football", modelKey: "model-1", engineVersion: "engine-1" };
    const driftReceipt = { version: "live-calibration-drift-v1", status: "pass", eligibleForLive: true };
    readActiveCalibrationPromotion.mockResolvedValue({ status: "found", promotion: activePromotion });
    readCalibrationDriftReceipt.mockResolvedValue(driftReceipt);

    const response = await GET(new Request("http://localhost/api/sports/decision/training/calibration-promotion?sport=football"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { status: "found", promotion: activePromotion, driftReceipt }
    });
    expect(readCalibrationDriftReceipt).toHaveBeenCalledWith(activePromotion);
  });

  it("requires an admin token before any approval write", async () => {
    isTrainingAdminAuthorized.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/sports/decision/training/calibration-promotion", {
        method: "POST",
        body: JSON.stringify({ action: "approve", candidateId: "candidate-1", rationale: "checked" })
      })
    );

    expect(response.status).toBe(401);
    expect(approveCalibrationCandidate).not.toHaveBeenCalled();
  });

  it("approves only a named candidate with an operator rationale", async () => {
    isTrainingAdminAuthorized.mockReturnValue(true);
    approveCalibrationCandidate.mockResolvedValue({ status: "approved", configured: true, table: "op_calibration_promotions", id: "promotion-1" });

    const response = await POST(
      new Request("http://localhost/api/sports/decision/training/calibration-promotion", {
        method: "POST",
        body: JSON.stringify({ action: "approve", candidateId: "candidate-1", comparisonReceiptId: "comparison-1", approvedBy: "risk-operator", rationale: "Validated prospective cohort." })
      })
    );

    expect(response.status).toBe(200);
    expect(approveCalibrationCandidate).toHaveBeenCalledWith({
      candidateId: "candidate-1",
      approvedBy: "risk-operator",
      rationale: "Validated prospective cohort.",
      expiresAt: null,
      comparisonReceiptId: "comparison-1"
    });
  });
});
