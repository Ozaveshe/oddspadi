export type SupabasePublicConfig = { url: string; key: string };

/**
 * Public (browser-safe) Supabase config for auth. Returns null when the URL or
 * publishable/anon key is missing or a placeholder — callers then degrade to a
 * "community coming soon" state instead of throwing. Never exposes secrets: the
 * publishable/anon key is designed to be public.
 */
export function supabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !key) return null;
  if (/^(your|changeme|placeholder|example)/i.test(key)) return null;
  return { url, key };
}

export function isCommunityConfigured(): boolean {
  return supabasePublicConfig() !== null;
}
