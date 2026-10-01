import { authPlayer } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { board, GameError, getSchedule, type Game } from "@/lib/game";
import { handle, json } from "@/lib/http";

/**
 * GET /api/leaderboard?group=<code>&date=YYYY-MM-DD
 * Defaults to the live game, else the most recent one. Omit group for the global board.
 */
export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const me = await authPlayer(req);

  let game: Game | null;
  const date = params.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    game = must(await db().from("games").select("*").eq("trade_date", date).maybeSingle()) as Game | null;
  } else {
    const s = await getSchedule();
    game = s.live ?? s.last;
  }
  if (!game) throw new GameError("No game found", 404);

  let groupId: string | undefined;
  const code = params.get("group");
  if (code) {
    const g = must(await db().from("groups").select("id").eq("code", code).maybeSingle()) as { id: string } | null;
    if (!g) throw new GameError("Group not found", 404);
    groupId = g.id;
  }

  const rows = await board(game, { groupId, playerId: me?.id, limit: groupId ? 200 : 50 });
  return json({ date: game.trade_date, status: game.status, rows });
});
