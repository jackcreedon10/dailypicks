import { timingSafeEqual } from "node:crypto";
import { tick } from "@/lib/game";
import { json } from "@/lib/http";

// Called every 30-60s by the scheduler (Supabase pg_cron + pg_net, or `npm run ticker` locally).
// Pulls prices for every picked stock, updates quotes/ticks, and settles closed games.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function run(req: Request) {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  try {
    return json(await tick());
  } catch (e) {
    console.error("tick failed", e);
    return json({ error: String(e) }, 500);
  }
}

export const GET = run;
export const POST = run;
