import { GameError, sharedPicks } from "@/lib/game";
import { handle, json } from "@/lib/http";

/** Public view of a player's shared picks (what friends see when they open a share link). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new GameError("Player not found", 404);
  const picks = await sharedPicks(id);
  if (!picks) throw new GameError("Player not found", 404);
  return json(picks);
});
