import { beforeEach, describe, expect, it, vi } from "vitest";

const isTrainingAdminAuthorized = vi.hoisted(() => vi.fn());
const readActiveCalibrationPromotion = vi.hoisted(() => vi.fn());
const approveCalibrationCandidate = vi.hoisted(() => vi.fn());
const revokeCalibrationPromotion = vi.hoisted(() => vi.fn());
const readCalibrationDriftReceipt = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sports/training/adminAuth", () => ({
  isTrainingAdminAuthorized,
  trainingUnauthorized: () => Response.json({ success: false, data: null, error: "Unauthorized." }, { status: 401 }),
  requireTrainingAdmin: (request: Request) =>
    isTrainingAdminAuthorized(request)
      ? null
      : Response.json({ success: false, data: null, error: "Unauthorized." }, { status: 401 })
}));
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

  it("refuses an anonymous read of the promotion state", async () => {
    isTrainingAdminAuthorized.mockReturnValue(false);
    const response = await GET(new Request("http://localhost/api/sports/decision/training/calibration-promotion?sport=football"));
    expect(response.status).toBe(401);
  });

  it("reads the active promotion without revealing credentials", async () => {
    isTrainingAdminAuthorized.mockReturnValue(true);
    readActiveCalibrationPromotion.mockResolvedValue({ status: "not-found" });

    const response = await GET(new Request("http://localhost/api/sports/decision/training/calibration-promotion?sport=football"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: { status: "not-found" } });
    expect(readActiveCalibrationPromotion).toHaveBeenCalledWith("football");
  });

  it("returns the exact out-of-sample drift receipt with an active promotion", async () => {
    isTrainingAdminAuthorized.mockReturnValue(true);
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

  it("refuses approval without step-up, even with the admin token", async () => {
    isTrainingAdminAuthorized.mockReturnValue(true);
    process.env.ODDSPADI_ADMIN_STEPUP_TOKEN = "stepup-secret-123456";
    const response = await POST(
      new Request("http://localhost/api/sports/decision/training/calibration-promotion", {
        method: "POST",
        headers: { "x-oddspadi-admin-token": "admin-token" },
        // No step-up token, no confirm: model promotion is a destructive action.
        body: JSON.stringify({ action: "approve", candidateId: "candidate-1", rationale: "checked" })
      })
    );
    expect(response.status).toBe(403);
    expect(approveCalibrationCandidate).not.toHaveBeenCalled();
    delete process.env.ODDSPADI_ADMIN_STEPUP_TOKEN;
  });

  it("approves only a named candidate with step-up, confirmation and an operator rationale", async () => {
    isTrainingAdminAuthorized.mockReturnValue(true);
    process.env.ODDSPADI_ADMIN_TOKEN = "admin-token";
    process.env.ODDSPADI_ADMIN_STEPUP_TOKEN = "stepup-secret-123456";
    approveCalibrationCandidate.mockResolvedValue({ status: "approved", configured: true, table: "op_calibration_promotions", id: "promotion-1" });

    const response = await POST(
      new Request("http://localhost/api/sports/decision/training/calibration-promotion", {
        method: "POST",
        headers: { "x-oddspadi-admin-token": "admin-token", "x-oddspadi-stepup-token": "stepup-secret-123456" },
        body: JSON.stringify({ action: "approve", candidateId: "candidate-1", comparisonReceiptId: "comparison-1", approvedBy: "risk-operator", rationale: "Validated prospective cohort.", confirm: "promote_calibration" })
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
    delete process.env.ODDSPADI_ADMIN_TOKEN;
    delete process.env.ODDSPADI_ADMIN_STEPUP_TOKEN;
  });
});
