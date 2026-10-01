import { authPlayer } from "@/lib/auth";
import { GameError, submitPicks } from "@/lib/game";
import { body, handle, json } from "@/lib/http";

export const POST = handle(async (req: Request) => {
  const me = await authPlayer(req);
  if (!me) throw new GameError("Unknown player", 401);
  const b = await body(req);
  const result = await submitPicks(me.id, b.symbols, b.allocs);
  return json(result);
});
