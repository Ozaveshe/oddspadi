import { getCachedLiveScoreBoard } from "@/lib/sports/cachedLiveScoreBoard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? undefined;
  const board = await getCachedLiveScoreBoard(date);
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
