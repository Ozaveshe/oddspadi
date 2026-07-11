import { describe, expect, it } from "vitest";
import type { DecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import type { DecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import { buildDecisionProviderDryRunObservationLedger } from "@/lib/sports/prediction/decisionProviderDryRunObservationLedger";

function providerReceipt(status: DecisionEplProviderDryRunReceipt["status"]): DecisionEplProviderDryRunReceipt {
  return {
    date: "2026-08-21",
    status,
    receiptHash: "fnv1a-provider",
    summary: "provider summary",
    observation: {
      attempted: status !== "not-run",
      dryRun: status !== "not-run" ? true : null,
      fetched: 0,
      normalized: 0,
      responseHash: status !== "not-run" ? "fnv1a-provider-response" : null,
      reason: "Exact EPL opener and opening-window fallback returned zero fixtures.",
      error: null,
      signals: ["status:dry-run", "normalized:0"]
    },
    controls: {
      canRunProviderDryRun: status === "not-run",
      canWriteFixtures: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: ["/api/sports/decision/epl-provider-dry-run-receipt"],
    locks: ["provider receipt remains read-only"]
  } as unknown as DecisionEplProviderDryRunReceipt;
}

function oddsReceipt(status: DecisionEplOddsDryRunReceipt["status"], reason: string | null): DecisionEplOddsDryRunReceipt {
  return {
    date: "2026-08-21",
    status,
    receiptHash: "fnv1a-odds",
    summary: "odds summary",
    observation: {
      attempted: status !== "not-run",
      dryRun: status !== "not-run" ? true : null,
      fetchedEvents: 0,
      normalizedOddsRows: 0,
      responseHash: status !== "not-run" ? "fnv1a-odds-response" : null,
      reason,
      error: reason,
      signals: ["status:provider-error", "oddsRows:0"]
    },
    controls: {
      canRunOddsDryRun: status === "not-run",
      canWriteOddsSnapshots: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: ["/api/sports/decision/epl-odds-dry-run-receipt"],
    locks: ["odds receipt remains read-only"]
  } as unknown as DecisionEplOddsDryRunReceipt;
}

describe("provider dry-run observation ledger", () => {
  it("records zero-fixture and paid-plan observations without unlocking writes", () => {
    const ledger = buildDecisionProviderDryRunObservationLedger({
      eplProviderDryRunReceipt: providerReceipt("observed-warning"),
      eplOddsDryRunReceipt: oddsReceipt("provider-error", "Historical odds are only available on paid usage plans."),
      runRequested: true,
      adminAuthorized: true,
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(ledger.mode).toBe("provider-dry-run-observation-ledger");
    expect(ledger.status).toBe("odds-plan-blocked");
    expect(ledger.rows.map((row) => [row.id, row.status])).toEqual([
      ["football-fixtures", "observed-zero"],
      ["odds-markets", "plan-blocked"]
    ]);
    expect(ledger.nextAction.label).toBe("Upgrade odds plan and rerun dry-run");
    expect(ledger.controls.canRunAdminDryRun).toBe(false);
    expect(ledger.controls.canWriteFixtures).toBe(false);
    expect(ledger.controls.canWriteOddsSnapshots).toBe(false);
    expect(ledger.controls.canWriteProviderRows).toBe(false);
    expect(ledger.controls.canPersistDecisions).toBe(false);
    expect(ledger.controls.canWriteTrainingRows).toBe(false);
    expect(ledger.controls.canTrainModels).toBe(false);
    expect(ledger.controls.canPublishPicks).toBe(false);
    expect(ledger.controls.canStake).toBe(false);
    expect(ledger.locks.join(" ")).toContain("Zero-row and provider-plan observations are evidence");
  });

  it("does not mark provider proof ready when fixtures verify but odds are still plan-blocked", () => {
    const ledger = buildDecisionProviderDryRunObservationLedger({
      eplProviderDryRunReceipt: {
        ...providerReceipt("observed-warning"),
        status: "verified",
        observation: {
          ...providerReceipt("observed-warning").observation,
          normalized: 1
        }
      } as DecisionEplProviderDryRunReceipt,
      eplOddsDryRunReceipt: oddsReceipt("provider-error", "Historical odds are only available on paid usage plans."),
      runRequested: true,
      adminAuthorized: true,
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(ledger.status).toBe("odds-plan-blocked");
    expect(ledger.rows.map((row) => [row.id, row.status])).toEqual([
      ["football-fixtures", "verified"],
      ["odds-markets", "plan-blocked"]
    ]);
    expect(ledger.controls.canWriteOddsSnapshots).toBe(false);
    expect(ledger.controls.canPublishPicks).toBe(false);
    expect(ledger.controls.canStake).toBe(false);
  });

  it("classifies API-Football HTTP 429 as rate-limited provider evidence", () => {
    const ledger = buildDecisionProviderDryRunObservationLedger({
      eplProviderDryRunReceipt: {
        ...providerReceipt("observed-warning"),
        status: "provider-error",
        observation: {
          ...providerReceipt("observed-warning").observation,
          reason: "Provider returned HTTP 429.",
          error: "Provider returned HTTP 429."
        }
      } as DecisionEplProviderDryRunReceipt,
      eplOddsDryRunReceipt: {
        ...oddsReceipt("verified", null),
        observation: {
          ...oddsReceipt("verified", null).observation,
          normalizedOddsRows: 3
        }
      } as DecisionEplOddsDryRunReceipt,
      runRequested: true,
      adminAuthorized: true,
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(ledger.status).toBe("provider-rate-limited");
    expect(ledger.rows.map((row) => [row.id, row.status])).toEqual([
      ["football-fixtures", "rate-limited"],
      ["odds-markets", "verified"]
    ]);
    expect(ledger.nextAction.label).toBe("Wait for provider quota window and rerun dry-run");
    expect(ledger.controls.canTrainModels).toBe(false);
    expect(ledger.controls.canPublishPicks).toBe(false);
    expect(ledger.controls.canStake).toBe(false);
  });

  it("shows preview readiness before an admin dry-run is requested", () => {
    const ledger = buildDecisionProviderDryRunObservationLedger({
      eplProviderDryRunReceipt: providerReceipt("not-run"),
      eplOddsDryRunReceipt: oddsReceipt("not-run", null),
      runRequested: false,
      adminAuthorized: false,
      now: new Date("2026-07-09T12:00:00.000Z")
    });

    expect(ledger.status).toBe("not-run");
    expect(ledger.controls.canInspectReadOnly).toBe(true);
    expect(ledger.controls.canRunAdminDryRun).toBe(true);
    expect(ledger.controls.canWriteProviderRows).toBe(false);
    expect(ledger.proofUrls).toContain("/api/sports/decision/provider-dry-run-observation-ledger");
  });
});
