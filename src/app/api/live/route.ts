import { fetchLiveScoreBoard } from "@/lib/sports/liveScoreBoard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? undefined;
  const board = await fetchLiveScoreBoard(date);
  return Response.json(board, {
    headers: {
      // Let the CDN absorb polling traffic: one origin hit per 30s window.
      "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60"
    }
  });
}
