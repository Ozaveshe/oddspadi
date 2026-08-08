import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { convertSelection, platformTarget, PLATFORM_TARGETS } from "@/lib/markets/conversion";
import type { MarketAlias } from "@/lib/markets/alias";

export const dynamic = "force-dynamic";

/**
 * Platform conversion for workspace legs.
 *
 * Wraps the Market Mapping service with the live alias store. The route
 * returns exactly what the conversion service concluded — including
 * `unsupported` and `unavailable` — because the honest answer set is the
 * feature. There is no "all platforms" option: callers name a registered
 * target, and the registered list is all we claim.
 */

const MAX_KEYS = 20;

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const service = getSupabaseServerClient();
  if (!service) return privateJson({ error: "Conversion is not configured." }, { status: 503 });

  const parsed = await readBoundedJson<{ platformId?: unknown; selectionKeys?: unknown }>(request, 16_000);
  if (!parsed.ok) return parsed.response;

  const platformId = typeof parsed.value.platformId === "string" ? parsed.value.platformId : "";
  const platform = platformTarget(platformId);
  if (!platform) {
    return privateJson(
      {
        error: "Unknown platform.",
        supportedPlatforms: PLATFORM_TARGETS.map((target) => ({ id: target.id, displayName: target.displayName }))
      },
      { status: 400 }
    );
  }

  const keys = Array.isArray(parsed.value.selectionKeys)
    ? parsed.value.selectionKeys.filter((value): value is string => typeof value === "string" && value.length <= 120)
    : null;
  if (!keys || !keys.length) return privateJson({ error: "Send { selectionKeys: [...] }." }, { status: 400 });
  if (keys.length > MAX_KEYS) return privateJson({ error: `At most ${MAX_KEYS} selections convert at once.` }, { status: 400 });

  const { data, error } = await service
    .from("op_market_aliases")
    .select("*")
    .eq("provider", platform.id)
    .eq("status", "active");
  if (error) return databaseUnavailable("workspace convert aliases", error, "Conversion is temporarily unavailable.");
  const aliases = (data ?? []) as unknown as MarketAlias[];

  const asOf = new Date().toISOString();
  return privateJson({
    platform: { id: platform.id, displayName: platform.displayName },
    conversions: Object.fromEntries(keys.map((key) => [key, convertSelection(key, { platform, aliases, asOf })])),
    asOf
  });
}
