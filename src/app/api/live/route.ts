import { parseIsoDateParam } from "@/app/api/sports/_utils";
import { getCachedLiveScoreBoard } from "@/lib/sports/cachedLiveScoreBoard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // `date` is both a CDN cache key (see Netlify-Vary below) and a provider
  // fan-out key, so it is validated and window-bounded before it reaches
  // either. Unvalidated, a single client could mint unlimited edge-cache
  // entries and upstream provider calls by walking arbitrary dates.
  const parsed = parseIsoDateParam(new URL(request.url).searchParams.get("date"), "");
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const board = await getCachedLiveScoreBoard(parsed.date || undefined);
  return Response.json(board, {
    headers: {
      // Let the CDN absorb polling traffic: one origin hit per 30s window.
      "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
      // Netlify's durable Next.js cache otherwise collapses every requested
      // date onto the first cached board for this pathname.
      "Netlify-Vary": "query=date"
    }
  });
}
