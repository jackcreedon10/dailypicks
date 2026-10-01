import { randomBytes } from "node:crypto";
import { authPlayer } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { GameError } from "@/lib/game";
import { body, handle, json } from "@/lib/http";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function code(): string {
  return Array.from(randomBytes(7), (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Create a friend group and join it. */
export const POST = handle(async (req: Request) => {
  const me = await authPlayer(req);
  if (!me) throw new GameError("Unknown player", 401);
  const raw = (await body(req)).name;
  const name = (typeof raw === "string" && raw.trim().slice(0, 40)) || `${me.nickname}'s crew`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await db().from("groups").insert({ code: code(), name, created_by: me.id }).select("id, code, name").single();
    if (res.error?.code === "23505") continue; // code collision, retry
    const g = must(res) as { id: string; code: string; name: string };
    must(await db().from("group_members").insert({ group_id: g.id, player_id: me.id }));
    return json({ code: g.code, name: g.name });
  }
  throw new GameError("Could not create group, try again", 500);
});
