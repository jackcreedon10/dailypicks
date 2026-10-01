import { db, must } from "@/lib/db";
import { GameError } from "@/lib/game";
import { handle, json } from "@/lib/http";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const g = must(
    await db().from("groups").select("id, code, name, players!groups_created_by_fkey(nickname)").eq("code", code).maybeSingle(),
  ) as { id: string; code: string; name: string; players: { nickname: string } } | null;
  if (!g) throw new GameError("Group not found", 404);
  const { count } = await db().from("group_members").select("player_id", { count: "exact", head: true }).eq("group_id", g.id);
  return json({ code: g.code, name: g.name, createdBy: g.players?.nickname ?? null, members: count ?? 0 });
});
