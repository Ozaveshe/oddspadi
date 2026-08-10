/**
 * Public-facing error text.
 *
 * Raw provider/database exception strings have reached public surfaces —
 * "Storage: canceling statement due to statement timeout", provider slugs,
 * internal table names. A reader learns nothing useful from them and an
 * attacker learns the stack. Public copy states only a coarse operational
 * condition; the real text stays in server logs (by error code).
 */

const DELAYED_MARKERS = /timeout|timed out|statement|canceling|deadlock|connection|econn|network|fetch failed|429|rate/i;

/**
 * Collapse any raw failure detail to a fixed operational phrase. Never returns
 * provider names, table names, run ids, SQL, or vendor detail.
 */
export function toPublicReason(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  if (DELAYED_MARKERS.test(text)) {
    return "Some data is delayed. The figures shown are the last we could confirm.";
  }
  return "This data is temporarily unavailable. Nothing has been substituted.";
}

/** A public, coarse status derived from a run/availability state. */
export function toPublicStatusLabel(status: string | null | undefined): "operational" | "delayed" | "partial" | "unavailable" {
  switch (status) {
    case "completed":
    case "ready":
    case "ok":
    case "operational":
      return "operational";
    case "partial":
    case "preliminary":
      return "partial";
    case "failed":
    case "unavailable":
    case "refresh_failed":
      return "unavailable";
    default:
      return "delayed";
  }
}

export type PublicProviderStatus = {
  /** Coarse operational state — never a run status enum or provider name. */
  status: "operational" | "delayed" | "partial" | "unavailable";
  /** How many data sources contributed, without naming any of them. */
  sourceCount: number;
  /** Last successful refresh instant, or null. Never a run id. */
  lastUpdatedAt: string | null;
};

/**
 * Reduce the internal provider block (run ids, provider slugs, raw error
 * strings) to a public-safe status. This is the shape public slate/tips
 * endpoints and the provider strip may carry.
 */
export function sanitisePublicProvider(provider: {
  status?: string | null;
  providers?: string[] | null;
  lastRun?: { status?: string | null; finishedAt?: string | null } | null;
} | null | undefined): PublicProviderStatus {
  return {
    status: toPublicStatusLabel(provider?.status ?? provider?.lastRun?.status ?? null),
    sourceCount: Array.isArray(provider?.providers) ? provider!.providers!.length : 0,
    lastUpdatedAt: provider?.lastRun?.finishedAt ?? null
  };
}
