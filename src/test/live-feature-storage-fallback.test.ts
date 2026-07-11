import { describe, expect, it, vi } from "vitest";

function liveFeatureClient({ existingId = null }: { existingId?: string | null } = {}) {
  const calls = {
    upsert: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn()
  };

  const client = {
    from: vi.fn(() => ({
      upsert: calls.upsert.mockImplementation(() => ({
        select: vi.fn(async () => ({
          data: null,
          error: { message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" }
        }))
      })),
      select: calls.select.mockImplementation(() => {
        const chain: any = {
          eq: vi.fn(() => chain),
          limit: vi.fn(async () => ({
            data: existingId ? [{ id: existingId }] : [],
            error: null
          }))
        };
        return chain;
      }),
      insert: calls.insert.mockImplementation(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: "fallback-insert-id" }, error: null }))
        }))
      })),
      update: calls.update.mockImplementation(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: existingId ?? "fallback-update-id" }, error: null }))
          }))
        }))
      }))
    }))
  };

  return { client, calls };
}

describe("live feature storage REST conflict fallback", () => {
  it("stores provider-backed live rows when REST upsert cannot infer the unique index", async () => {
    vi.resetModules();
    const { client, calls } = liveFeatureClient();
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: vi.fn(() => client)
    }));

    const { mockSportsDataProvider } = await import("@/lib/sports/providers/mockProvider");
    const { buildFootballProviderLiveFeatureMaterializer } = await import("@/lib/sports/training/footballProviderLiveFeatureMaterializer");
    const { observeFootballProviderLiveFeatureStorageReceipt } = await import("@/lib/sports/training/footballProviderLiveFeatureStorageReceipt");
    const matches = (await mockSportsDataProvider.getFixtures("2026-08-21", "football")).slice(0, 1).map((match) => ({
      ...match,
      dataSource: {
        ...(match.dataSource ?? {}),
        kind: "provider" as const,
        fixtureProvider: "api-football",
        oddsProvider: "the-odds-api",
        fetchedAt: "2026-07-05T10:00:00.000Z"
      }
    }));
    const materializer = buildFootballProviderLiveFeatureMaterializer({
      provider: "api-football+the-odds-api",
      matches,
      targetDate: "2026-08-21",
      now: new Date("2026-07-05T10:00:00.000Z")
    });

    const receipt = await observeFootballProviderLiveFeatureStorageReceipt({
      materializer,
      runRequested: true,
      adminAuthorized: true,
      env: {
        SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
        SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
        ODDSPADI_ADMIN_TOKEN: "admin-token"
      },
      origin: "http://127.0.0.1:3025",
      now: new Date("2026-07-05T10:01:00.000Z")
    });

    expect(calls.upsert).toHaveBeenCalledTimes(1);
    expect(calls.select).toHaveBeenCalledTimes(1);
    expect(calls.insert).toHaveBeenCalledTimes(1);
    expect(calls.update).not.toHaveBeenCalled();
    expect(receipt.status).toBe("stored");
    expect(receipt.storage.inserted).toBe(true);
    expect(receipt.storage.rowsInserted).toBe(1);
    expect(receipt.storage.insertedIds).toEqual(["fallback-insert-id"]);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });
});
