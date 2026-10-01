import { authPlayer } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { GameError } from "@/lib/game";
import { handle, json } from "@/lib/http";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const me = await authPlayer(req);
  if (!me) throw new GameError("Unknown player", 401);
  const { code } = await ctx.params;
  const g = must(await db().from("groups").select("id, code, name").eq("code", code).maybeSingle()) as
    | { id: string; code: string; name: string }
    | null;
  if (!g) throw new GameError("Group not found", 404);
  must(
    await db()
      .from("group_members")
      .upsert({ group_id: g.id, player_id: me.id }, { onConflict: "group_id,player_id", ignoreDuplicates: true }),
  );
  return json({ code: g.code, name: g.name });
});
