import {
  buildDemoFootballProviderFeatureFixture,
  buildFootballProviderFeatureMaterializer,
  type FootballProviderFeatureMaterializerReceipt
} from "./footballDataProviderFeatureMaterializer";
import {
  readStoredFootballProviderFixtures,
  type StoredFootballProviderFixtures
} from "./footballProviderFeatureCorpusRepository";

type CorpusReader = (options: {
  provider: string;
  limit: number;
  batchLimit: number;
  season?: string;
  leagueExternalId?: string;
}) => Promise<StoredFootballProviderFixtures | { error: string }>;

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function boundedInteger(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function cleanText(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

function cleanProvider(value: string | null): string | null {
  const provider = value?.trim().toLowerCase() || "api_football";
  return /^[a-z0-9_-]{1,64}$/.test(provider) ? provider : null;
}

export async function materializeFootballProviderCorpus({
  url,
  reader = readStoredFootballProviderFixtures
}: {
  url: URL;
  reader?: CorpusReader;
}): Promise<FootballProviderFeatureMaterializerReceipt | { error: string }> {
  if (enabled(url.searchParams.get("demo"))) {
    return buildFootballProviderFeatureMaterializer({
      provider: "demo_provider",
      fixtures: [buildDemoFootballProviderFeatureFixture()]
    });
  }

  const provider = cleanProvider(url.searchParams.get("provider"));
  if (!provider) return { error: "provider must contain only lowercase letters, numbers, underscores, or hyphens." };

  const corpus = await reader({
    provider,
    limit: boundedInteger(url.searchParams.get("limit"), 100, 3000),
    batchLimit: boundedInteger(url.searchParams.get("batches"), 50, 1000),
    season: cleanText(url.searchParams.get("season")),
    leagueExternalId: cleanText(url.searchParams.get("league"))
  });
  if ("error" in corpus) return corpus;

  return buildFootballProviderFeatureMaterializer({
    provider: corpus.provider,
    fixtures: corpus.fixtures,
    source: corpus.source
  });
}
