// Pure label-to-line recovery, extracted from publicPicks so client components
// (the community tip composer) can share it without pulling in the server-only
// Supabase client that publicPicks imports.
export function marketLineFromLabel(label: string): number | null {
  const match = label.match(/(?:over|under|\s)([+-]?\d+(?:\.\d+)?)\s*$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
