import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertSizes: number[] = [];
const successfulClient = {
  from: vi.fn(() => ({
    upsert: vi.fn((rows: Array<{ fixture_external_id: string }>) => {
      upsertSizes.push(rows.length);
      return {
        select: vi.fn(async () => ({
          data: rows.map((row) => ({ id: `stored:${row.fixture_external_id}` })),
          error: null
        }))
      };
    })
  }))
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => successfulClient)
}));

const READY_ENV = {
  SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
  SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test_service_role",
  ODDSPADI_ADMIN_TOKEN: "admin-token"
};

describe("football feature storage chunks", () => {
  beforeEach(() => {
    upsertSizes.length = 0;
    vi.clearAllMocks();
  });

  it("stores a unified corpus in bounded idempotent chunks", async () => {
    const { buildDemoFootballProviderFeatureFixture, buildFootballProviderFeatureMaterializer } = await import(
      "@/lib/sports/training/footballDataProviderFeatureMaterializer"
    );
    const { observeFootballProviderFeatureStorageReceipt } = await import(
      "@/lib/sports/training/footballDataProviderFeatureStorageReceipt"
    );
    const materializer = buildFootballProviderFeatureMaterializer({
      provider: "api_football",
      fixtures: [buildDemoFootballProviderFeatureFixture()],
      now: new Date("2026-07-10T10:00:00.000Z")
    });
    const seed = materializer.previewRows[0]!;
    materializer.previewRows = Array.from({ length: 501 }, (_, index) => ({
      ...seed,
      id: `row-${index}`,
      fixture_external_id: `fixture-${index}`,
      feature_hash: `hash-${index}`
    }));
    materializer.corpus.rowsPreviewed = materializer.previewRows.length;

    const receipt = await observeFootballProviderFeatureStorageReceipt({
      materializer,
      runRequested: true,
      adminAuthorized: true,
      env: READY_ENV,
      origin: "http://127.0.0.1:3025",
      now: new Date("2026-07-10T10:01:00.000Z")
    });

    expect(upsertSizes).toEqual([250, 250, 1]);
    expect(receipt.status).toBe("stored");
    expect(receipt.storage).toEqual(expect.objectContaining({
      inserted: true,
      rowsInserted: 501,
      chunkSize: 250,
      chunksAttempted: 3,
      chunksCompleted: 3,
      error: null
    }));
  }, 15_000);
});
