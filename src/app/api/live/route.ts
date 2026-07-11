import { fetchLiveScoreBoard } from "@/lib/sports/liveScoreBoard";

export const dynamic = "force-dynamic";

export async function GET() {
  const board = await fetchLiveScoreBoard();
  return Response.json(board, {
    headers: {
      // Let the CDN absorb polling traffic: one origin hit per 30s window.
      "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60"
    }
  });
}
