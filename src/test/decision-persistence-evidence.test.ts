import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseRuntimeStatusMock = vi.hoisted(() => vi.fn());
const getSupabaseServerClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseRuntimeStatus: getSupabaseRuntimeStatusMock,
  getSupabaseServerClient: getSupabaseServerClientMock
}));

import { persistDecisionRun } from "@/lib/sports/prediction/decisionPersistence";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";

describe("immutable decision evidence persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseRuntimeStatusMock.mockReturnValue({ serverWriteReady: true, missingServerEnv: [] });
  });

  it("keeps the decision write available but reports a migration gate when immutable evidence storage is absent", async () => {
    const [fixture] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const match = {
      ...fixture,
      dataSource: {
        ...fixture.dataSource,
        kind: "provider" as const,
        fixtureProvider: "api-football",
        fixtureProviderId: "fixture-123",
        oddsProvider: "the-odds-api",
        oddsProviderEventId: "odds-123"
      }
    };
    const prediction = buildPrediction(match);
    const missingBundleQuery = {
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: null,
        error: { message: "Could not find the table 'public.op_decision_evidence_bundles' in the schema cache" }
      }))
    };
    missingBundleQuery.eq.mockReturnValue(missingBundleQuery);
    const decisionRunQuery = {
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: "decision-run-1" }, error: null })) }))
      }))
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "op_decision_runs") return decisionRunQuery;
        if (table === "op_decision_evidence_bundles") return { select: vi.fn(() => missingBundleQuery) };
        throw new Error(`Unexpected table ${table}`);
      })
    };
    getSupabaseServerClientMock.mockReturnValue(client);

    const result = await persistDecisionRun({ match, prediction });

    expect(result).toMatchObject({
      status: "stored",
      id: "decision-run-1",
      evidenceBundle: {
        status: "pending-migration",
        table: "op_decision_evidence_bundles",
        evidenceHash: expect.stringMatching(/^fnv1a-[a-f0-9]{8}$/),
        decisionHash: expect.stringMatching(/^fnv1a-[a-f0-9]{8}$/)
      }
    });
    expect(client.from).toHaveBeenCalledWith("op_decision_runs");
    expect(client.from).toHaveBeenCalledWith("op_decision_evidence_bundles");
    expect(client.from).not.toHaveBeenCalledWith("op_model_versions");
  });

  it("links a registered model and appends an immutable evidence bundle when the migration is present", async () => {
    const [fixture] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const match = {
      ...fixture,
      dataSource: {
        ...fixture.dataSource,
        kind: "provider" as const,
        fixtureProvider: "api-football",
        fixtureProviderId: "fixture-124",
        oddsProvider: "the-odds-api",
        oddsProviderEventId: "odds-124"
      }
    };
    const prediction = buildPrediction(match);
    const existingBundleQuery = {
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null }))
    };
    existingBundleQuery.eq.mockReturnValue(existingBundleQuery);
    const modelVersionQuery = {
      eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: "model-version-1" }, error: null })) }))
    };
    const insertedBundleQuery = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: "bundle-1" }, error: null })) }))
      }))
    };
    const decisionRunQuery = {
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: "decision-run-2" }, error: null })) }))
      }))
    };
    let bundleTableCalls = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === "op_decision_runs") return decisionRunQuery;
        if (table === "op_model_versions") return { select: vi.fn(() => modelVersionQuery) };
        if (table === "op_decision_evidence_bundles") {
          bundleTableCalls += 1;
          return bundleTableCalls === 1 ? { select: vi.fn(() => existingBundleQuery) } : insertedBundleQuery;
        }
        throw new Error(`Unexpected table ${table}`);
      })
    };
    getSupabaseServerClientMock.mockReturnValue(client);

    const result = await persistDecisionRun({ match, prediction });

    expect(result).toMatchObject({
      status: "stored",
      id: "decision-run-2",
      evidenceBundle: { status: "stored", id: "bundle-1", table: "op_decision_evidence_bundles" }
    });
    expect(insertedBundleQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        decision_run_id: "decision-run-2",
        model_version_id: "model-version-1",
        fixture_external_id: match.id,
        evidence_schema_version: "decision-evidence-bundle-v1"
      })
    );
  });
});
