import type { LiveScoreBoard } from "@/lib/sports/liveScoreBoard";

export const LIVE_BOARD_INITIAL_FIXTURES = 36;

/**
 * Keep the server-rendered board useful without serializing a full worldwide
 * matchday into the initial HTML. Aggregate counts remain authoritative; the
 * browser can request the complete cached board when the viewer asks for it.
 */
export function initialLiveBoardWindow(board: LiveScoreBoard): LiveScoreBoard {
  if (board.fixtures.length <= LIVE_BOARD_INITIAL_FIXTURES) return board;
  return { ...board, fixtures: board.fixtures.slice(0, LIVE_BOARD_INITIAL_FIXTURES) };
}
