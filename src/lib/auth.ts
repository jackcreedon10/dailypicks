import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db";

// Anonymous identity: the browser keeps { id, token } in localStorage and sends
// "Authorization: Player <id>.<token>". Only a SHA-256 of the token is stored.

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type Player = { id: string; nickname: string };

export async function authPlayer(req: Request): Promise<Player | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Player ([0-9a-f-]{36})\.([A-Za-z0-9_-]+)$/.exec(header);
  if (!m) return null;
  const [, id, token] = m;
  const { data } = await db().from("players").select("id, nickname, token_hash").eq("id", id).maybeSingle();
  if (!data) return null;
  const a = Buffer.from(data.token_hash, "hex");
  const b = Buffer.from(hashToken(token), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: data.id, nickname: data.nickname };
}

export function cleanNickname(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[^\p{L}\p{N} _.'-]/gu, "").trim().slice(0, 20);
  return s.length ? s : null;
}
