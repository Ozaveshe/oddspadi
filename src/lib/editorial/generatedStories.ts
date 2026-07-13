export type EditorialOutcome = {
  id: string; fixture_external_id: string; sport: string; league: string | null; home_team: string | null; away_team: string | null;
  kickoff_at: string | null; market: string; selection: string; recommended_selection: string | null; model_probability: number | string;
  value_edge: number | string; odds: number | string; result: string; settled_at: string | null; created_at: string;
};

export type GeneratedEditorialStory = {
  slug: string; generator: "weekend-preview" | "results-recap" | "value-picks-watch" | "model-vs-market"; title: string; excerpt: string;
  category: string; sport: string; body: string[]; sources: Array<{ label: string; url: string; checkedAt: string }>;
  revision: number; sourceAsOf: string; publishedAt: string; readMinutes: number; dataFingerprint: string;
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const matchName = (row: EditorialOutcome) => row.home_team && row.away_team ? `${row.home_team} vs ${row.away_team}` : row.fixture_external_id;
const pickName = (row: EditorialOutcome) => row.recommended_selection ?? row.selection;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
function fingerprint(rows: EditorialOutcome[]) { let hash = 2166136261; for (const char of rows.map((row) => `${row.id}:${row.result}:${row.model_probability}:${row.odds}`).join("|")) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `fnv1a-${(hash >>> 0).toString(16)}`; }
function distinctFixtures(rows: EditorialOutcome[]) { const seen = new Set<string>(); return rows.filter((row) => { if (seen.has(row.fixture_external_id)) return false; seen.add(row.fixture_external_id); return true; }); }
function base(kind: GeneratedEditorialStory["generator"], date: string, rows: EditorialOutcome[], revision: number, now: Date) { return { slug: `${kind}-${date}`, generator: kind, revision, sourceAsOf: now.toISOString(), publishedAt: now.toISOString(), readMinutes: 3, dataFingerprint: fingerprint(rows), sources: [{ label: "OddsPadi public prediction ledger", url: "/predictions/history", checkedAt: date }, { label: "OddsPadi current predictions", url: "/predictions", checkedAt: date }] }; }

export function generateEditorialStories(rows: EditorialOutcome[], now = new Date(), revisions: Partial<Record<GeneratedEditorialStory["generator"], number>> = {}): GeneratedEditorialStory[] {
  const date = isoDate(now); const stories: GeneratedEditorialStory[] = [];
  const pending = rows.filter((row) => row.result === "pending" && row.kickoff_at && new Date(row.kickoff_at).getTime() >= now.getTime()).sort((a, b) => new Date(a.kickoff_at!).getTime() - new Date(b.kickoff_at!).getTime());
  const weekendEnd = new Date(now); weekendEnd.setUTCDate(weekendEnd.getUTCDate() + 4);
  const preview = distinctFixtures(pending.filter((row) => new Date(row.kickoff_at!).getTime() <= weekendEnd.getTime())).slice(0, 6);
  if (preview.length) stories.push({ ...base("weekend-preview", date, preview, revisions["weekend-preview"] ?? 1, now), title: `Weekend preview: ${preview.length} matches on the OddsPadi radar`, excerpt: `A dated look at ${preview.length} upcoming fixtures, using stored model probabilities without turning analysis into promises.`, category: "Weekend preview", body: [
    `This preview was generated from OddsPadi records available at ${now.toISOString()}. It covers ${preview.length} upcoming fixtures and will change when the underlying evidence changes.`,
    ...preview.map((row) => `${matchName(row)} — ${pickName(row)} carries a stored model probability of ${pct(Number(row.model_probability))}. ${row.league ? `Competition: ${row.league}.` : "The competition label is unavailable."}`),
    "These are model readings, not guaranteed outcomes. Missing or changing lineups, prices and availability can alter the decision before kickoff."
  ], sport: "All sports" });

  const settled = rows.filter((row) => row.settled_at && ["won", "lost", "push", "void"].includes(row.result) && new Date(row.settled_at).getTime() >= now.getTime() - 7 * 86_400_000).sort((a, b) => new Date(b.settled_at!).getTime() - new Date(a.settled_at!).getTime());
  if (settled.length) { const wins = settled.filter((row) => row.result === "won"); const losses = settled.filter((row) => row.result === "lost"); const decided = wins.length + losses.length; stories.push({ ...base("results-recap", date, settled, revisions["results-recap"] ?? 1, now), title: `Results recap: ${wins.length} wins, ${losses.length} losses`, excerpt: `${settled.length} recent picks graded with wins, losses, pushes and voids kept together in the public record.`, category: "Results recap", sport: "All sports", body: [
    `This recap uses every settled OddsPadi ledger row from the previous seven days as checked at ${now.toISOString()}; losses are not removed.`,
    `${settled.length} picks were graded: ${wins.length} wins, ${losses.length} losses, ${settled.filter((row) => row.result === "push").length} pushes and ${settled.filter((row) => row.result === "void").length} voids. Accuracy across decided wins and losses was ${decided ? pct(wins.length / decided) : "not available"}.`,
    ...settled.slice(0, 8).map((row) => `${matchName(row)} — ${pickName(row)} finished ${row.result} at recorded odds ${Number(row.odds).toFixed(2)}.`),
    "Past results describe the record; they do not guarantee the next result."
  ] }); }

  const value = distinctFixtures(pending.filter((row) => Number(row.value_edge) > 0).sort((a, b) => Number(b.value_edge) - Number(a.value_edge))).slice(0, 6);
  if (value.length) stories.push({ ...base("value-picks-watch", date, value, revisions["value-picks-watch"] ?? 1, now), title: `Value watch: ${value.length} positive-edge matches`, excerpt: `The strongest currently stored model-versus-price edges, with confidence kept separate from certainty.`, category: "Value watch", body: [
    `This watchlist reflects stored prices and probabilities at ${now.toISOString()}. It is regenerated because prices and evidence move.`,
    ...value.map((row) => `${matchName(row)} — ${pickName(row)}: model ${pct(Number(row.model_probability))}, recorded odds ${Number(row.odds).toFixed(2)}, edge ${pct(Number(row.value_edge))}.`),
    "Positive edge is not a promise of a win. OddsPadi can publish fewer or no value picks when the evidence gate is not met."
  ], sport: "All sports" });

  const disagreements = distinctFixtures(pending.map((row) => ({ row, gap: Number(row.model_probability) - (Number(row.odds) > 0 ? 1 / Number(row.odds) : Number(row.model_probability)) })).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).map(({ row }) => row)).map((row) => ({ row, gap: Number(row.model_probability) - (Number(row.odds) > 0 ? 1 / Number(row.odds) : Number(row.model_probability)) })).slice(0, 6);
  if (disagreements.length) stories.push({ ...base("model-vs-market", date, disagreements.map(({ row }) => row), revisions["model-vs-market"] ?? 1, now), title: "Model vs market: today’s biggest disagreements", excerpt: "Where stored model probabilities differ most from the raw implied bookmaker price—and why disagreement alone is not a bet.", category: "Model vs market", body: [
    `This comparison uses the latest stored rows available at ${now.toISOString()}. Raw implied probabilities are calculated as one divided by decimal odds and do not remove bookmaker margin.`,
    ...disagreements.map(({ row, gap }) => `${matchName(row)} — ${pickName(row)}: model ${pct(Number(row.model_probability))}, raw market ${pct(1 / Number(row.odds))}, gap ${gap >= 0 ? "+" : ""}${pct(gap)}.`),
    "A large disagreement can reflect missing data or model uncertainty. The normal value and confidence gates still apply."
  ], sport: "All sports" });
  return stories;
}
