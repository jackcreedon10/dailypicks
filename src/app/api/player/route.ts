import { authPlayer, cleanNickname, newToken } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { GameError } from "@/lib/game";
import { body, handle, json } from "@/lib/http";

/** Create an anonymous player. Returns the only copy of the token. */
export const POST = handle(async (req: Request) => {
  const nickname = cleanNickname((await body(req)).nickname);
  if (!nickname) throw new GameError("Pick a nickname");
  const { token, hash } = newToken();
  const row = must(
    await db().from("players").insert({ nickname, token_hash: hash }).select("id, nickname").single(),
  ) as { id: string; nickname: string };
  return json({ ...row, token });
});

/** Rename. */
export const PATCH = handle(async (req: Request) => {
  const me = await authPlayer(req);
  if (!me) throw new GameError("Unknown player", 401);
  const nickname = cleanNickname((await body(req)).nickname);
  if (!nickname) throw new GameError("Pick a nickname");
  must(await db().from("players").update({ nickname }).eq("id", me.id));
  return json({ id: me.id, nickname });
});
