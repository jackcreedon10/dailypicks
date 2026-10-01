import { authPlayer } from "@/lib/auth";
import { db, must } from "@/lib/db";
import { ensureGames, entryView, gameNumber, getSchedule, type Game } from "@/lib/game";
import { handle, json } from "@/lib/http";
import { isMockMarket } from "@/lib/market";

const info = async (g: Game | null) =>
  g && { date: g.trade_date, openAt: g.open_at, closeAt: g.close_at, status: g.status, number: await gameNumber(g.trade_date) };

/** Everything the home screen needs in one request. Polled every ~30s. */
export const GET = handle(async (req: Request) => {
  await ensureGames();
  const [me, sched] = await Promise.all([authPlayer(req), getSchedule()]);

  let liveEntry = null, lastEntry = null, upcomingPicks: { symbols: string[]; allocs: number[] } | null = null;
  let groups: { code: string; name: string }[] = [];
  // How many players have locked in for the next game (shown before the open).
  const upcomingCount = sched.upcoming
    ? ((await db().from("entries").select("player_id", { count: "exact", head: true }).eq("trade_date", sched.upcoming.trade_date)).count ?? 0)
    : 0;
  if (me) {
    const [l, p, u, g] = await Promise.all([
      sched.live ? entryView(sched.live, me.id) : null,
      sched.last ? entryView(sched.last, me.id) : null,
      sched.upcoming
        ? db().from("entries").select("symbols, allocs").eq("trade_date", sched.upcoming.trade_date).eq("player_id", me.id).maybeSingle().then(must)
        : null,
      db().from("group_members").select("groups(code, name)").eq("player_id", me.id).order("joined_at").then(must),
    ]);
    liveEntry = l;
    lastEntry = p;
    upcomingPicks = (u as { symbols: string[]; allocs: number[] } | null) ?? null;
    groups = (g as unknown as { groups: { code: string; name: string } }[]).map((r) => r.groups);
  }

  return json({
    now: new Date().toISOString(),
    mock: isMockMarket(),
    me,
    live: await info(sched.live),
    upcoming: await info(sched.upcoming),
    last: await info(sched.last),
    liveEntry,
    lastEntry,
    upcomingPicks,
    upcomingCount,
    groups,
  });
});
