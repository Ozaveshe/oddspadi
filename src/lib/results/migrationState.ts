/**
 * Telling "not migrated yet" apart from "the read failed".
 *
 * Both surface as an error on a Supabase read and both would otherwise take a
 * cron to 503. But shipping code ahead of its migration is an ordering fact
 * that resolves itself the moment the migration lands, while a permission
 * error or a timeout is a real failure that must stay loud — and a denied read
 * returns the same zero rows as an empty table, which is precisely the
 * confusion that has cost this codebase before.
 *
 * So the match is narrow: Postgres 42P01 against a named relation, and nothing
 * else. Widening it would start forgiving the failures worth shouting about.
 */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined, relation: string): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("does not exist") && message.includes(relation.toLowerCase());
}
