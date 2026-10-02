import { authPlayer } from "@/lib/auth";
import { GameError } from "@/lib/game";
import { body, handle, json } from "@/lib/http";
import { play } from "@/lib/mystery";

/** Score your guesses so far. The full list is sent each time, so a refresh can rebuild the board. */
export const POST = handle(async (req: Request) => {
  const me = await authPlayer(req);
  if (!me) throw new GameError("Unknown player", 401);
  const b = await body(req);
  return json(await play(me.id, String(b.date ?? ""), b.guesses));
});
