import { db, must } from "./db";
import { market } from "./market";
import { addDays, etDate, etToUtc, minuteBucket } from "./time";

export const PORTFOLIO_START = 100_000;
export const MIN_PRICE = 1;

export type Game = {
  trade_date: string;
  open_at: string;
  close_at: string;
  status: "scheduled" | "live" | "settled";
  settled_at: string | null;
};

export type Schedule = { live: Game | null; upcoming: Game | null; last: Game | null };

export class GameError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export async function ensureGames(): Promise<void> {
  const today = etDate();
  const ahead = must(
    await db().from("games").select("trade_date").gte("trade_date", addDays(today, 7)).limit(1),
  );
  if (!ahead.length) await syncCalendar();
}

/**
 * Load the next 30 days of the exchange calendar. New days are added; days that haven't
 * started yet get their open/close corrected (holidays, early closes, calendar changes).
 * Days already live or settled are never touched.
 */
export async function syncCalendar(): Promise<number> {
  const today = etDate();
  const days = await market().calendar(today, addDays(today, 30));
  const tradingDates = new Set(days.map((d) => d.date));
  const existing = must(
    await db().from("games").select("trade_date, status").gte("trade_date", today),
  ) as { trade_date: string; status: Game["status"] }[];
  const started = new Set(existing.filter((g) => g.status !== "scheduled").map((g) => g.trade_date));
  const rows = days
    .filter((d) => !started.has(d.date))
    .map((d) => ({
      trade_date: d.date,
      open_at: etToUtc(d.date, d.open).toISOString(),
      close_at: etToUtc(d.date, d.close).toISOString(),
    }));
  if (rows.length) must(await db().from("games").upsert(rows, { onConflict: "trade_date" }));
  // A scheduled day that's no longer a trading day (e.g. a newly announced closure) is dropped,
  // unless someone already locked in picks for it.
  for (const g of existing) {
    if (g.status !== "scheduled" || tradingDates.has(g.trade_date)) continue;
    const { count } = await db().from("entries").select("player_id", { count: "exact", head: true }).eq("trade_date", g.trade_date);
    if (!count) must(await db().from("games").delete().eq("trade_date", g.trade_date));
  }
  return rows.length;
}

export async function getSchedule(now = new Date()): Promise<Schedule> {
  const today = etDate(now);
  const rows = must(
    await db()
      .from("games")
      .select("*")
      .gte("trade_date", addDays(today, -14))
      .lte("trade_date", addDays(today, 14))
      .order("trade_date"),
  ) as Game[];
  const t = now.getTime();
  const open = (g: Game) => Date.parse(g.open_at);
  const close = (g: Game) => Date.parse(g.close_at);
  return {
    live: rows.find((g) => open(g) <= t && t < close(g)) ?? null,
    upcoming: rows.find((g) => open(g) > t) ?? null,
    last: [...rows].reverse().find((g) => close(g) <= t) ?? null,
  };
}

export async function gameNumber(date: string): Promise<number> {
  const { count } = await db()
    .from("games")
    .select("trade_date", { count: "exact", head: true })
    .lte("trade_date", date);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Tick: called every ~30s by the scheduler.
// ---------------------------------------------------------------------------

async function syncAssetsIfStale(): Promise<number> {
  const latest = must(
    await db().from("assets").select("updated_at").order("updated_at", { ascending: false }).limit(1),
  );
  if (latest.length && Date.now() - Date.parse(latest[0].updated_at) < 20 * 3600_000) return 0;
  await syncCalendar(); // daily, alongside the stock list
  const assets = await market().assets();
  const now = new Date().toISOString();
  for (let i = 0; i < assets.length; i += 1000) {
    const rows = assets.slice(i, i + 1000).map((a) => ({ ...a, updated_at: now }));
    must(await db().from("assets").upsert(rows, { onConflict: "symbol" }));
  }
  return assets.length;
}

async function daySymbols(date: string): Promise<string[]> {
  const rows = must(await db().rpc("day_symbols", { p_date: date })) as string[];
  return rows;
}

/** Write latest prices to quotes + ticks. */
async function recordPrices(
  date: string,
  prices: Record<string, { price: number; open?: number | null }>,
  at: Date,
): Promise<void> {
  const updatedAt = at.toISOString();
  const ts = minuteBucket(at).toISOString();
  const entries = Object.entries(prices);
  if (!entries.length) return;
  // Split so a null open never overwrites an open we already have.
  const withOpen = entries.filter(([, p]) => p.open != null);
  const withoutOpen = entries.filter(([, p]) => p.open == null);
  if (withOpen.length)
    must(
      await db()
        .from("quotes")
        .upsert(
          withOpen.map(([symbol, p]) => ({
            trade_date: date, symbol, last_price: p.price, open_price: p.open, updated_at: updatedAt,
          })),
          { onConflict: "trade_date,symbol" },
        ),
    );
  if (withoutOpen.length)
    must(
      await db()
        .from("quotes")
        .upsert(
          withoutOpen.map(([symbol, p]) => ({ trade_date: date, symbol, last_price: p.price, updated_at: updatedAt })),
          { onConflict: "trade_date,symbol" },
        ),
    );
  must(
    await db()
      .from("ticks")
      .upsert(
        entries.map(([symbol, p]) => ({ trade_date: date, symbol, ts, price: p.price })),
        { onConflict: "trade_date,symbol,ts" },
      ),
  );
}

async function updateLive(game: Game, now: Date) {
  if (game.status === "scheduled") {
    must(await db().from("games").update({ status: "live" }).eq("trade_date", game.trade_date));
  }
  const symbols = await daySymbols(game.trade_date);
  if (!symbols.length) return { symbols: 0 };
  const snaps = await market().snapshots(symbols);
  await recordPrices(game.trade_date, snaps, now);
  const filled = must(await db().rpc("fill_open_bases", { p_date: game.trade_date })) as number;
  const ranked = must(await db().rpc("refresh_standings", { p_date: game.trade_date })) as number;
  return { symbols: symbols.length, priced: Object.keys(snaps).length, basesFilled: filled, ranked };
}

async function settle(game: Game) {
  const symbols = await daySymbols(game.trade_date);
  const closeAt = new Date(game.close_at);
  if (symbols.length) {
    // Make sure every symbol has an open (covers games where no tick ran mid-session).
    must(await db().rpc("fill_open_bases", { p_date: game.trade_date }));
    const closes = await market().closingPrices(symbols, closeAt);
    const rows = Object.entries(closes).map(([symbol, close_price]) => ({
      trade_date: game.trade_date, symbol, close_price, last_price: close_price,
    }));
    if (rows.length) {
      must(await db().from("quotes").upsert(rows, { onConflict: "trade_date,symbol" }));
      must(
        await db()
          .from("ticks")
          .upsert(
            rows.map((r) => ({ trade_date: r.trade_date, symbol: r.symbol, ts: closeAt.toISOString(), price: r.close_price })),
            { onConflict: "trade_date,symbol,ts" },
          ),
      );
    }
  }
  const n = must(await db().rpc("settle_game", { p_date: game.trade_date })) as number;
  return { date: game.trade_date, results: n };
}

export async function tick(now = new Date()) {
  await ensureGames();
  const assets = await syncAssetsIfStale();
  const sched = await getSchedule(now);
  const live = sched.live ? await updateLive(sched.live, now) : null;

  // Settle anything that closed more than a minute ago (gives the feed time to print final bars).
  const due = must(
    await db()
      .from("games")
      .select("*")
      .neq("status", "settled")
      .lt("close_at", new Date(now.getTime() - 60_000).toISOString())
      .order("trade_date"),
  ) as Game[];
  const settled = [];
  for (const g of due) settled.push(await settle(g));

  return { now: now.toISOString(), assetsSynced: assets, live, settled };
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

export function normalizeSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new GameError("Pick exactly three stocks");
  const syms = [...new Set(raw.map((s) => String(s).trim().toUpperCase()))];
  if (syms.length !== 3 || syms.some((s) => !/^[A-Z.]{1,6}$/.test(s)))
    throw new GameError("Pick exactly three different stocks");
  return syms;
}

export const MIN_ALLOC = 1_000;

/** Whole-dollar amounts for each of the three stocks, at least MIN_ALLOC each, summing to the portfolio. */
export function normalizeAllocs(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some((x) => !Number.isInteger(x)))
    throw new GameError("Split your $100,000 across all three stocks");
  if (raw.some((x) => x < MIN_ALLOC)) throw new GameError("Each stock needs at least $1,000");
  if (raw.reduce((a, b) => a + b, 0) !== PORTFOLIO_START) throw new GameError("Your split has to add up to exactly $100,000");
  return raw as number[];
}

const LOCKED = "Your picks for that day are already locked in";

export async function submitPicks(playerId: string, rawSymbols: unknown, rawAllocs: unknown, now = new Date()) {
  const symbols = normalizeSymbols(rawSymbols);
  const allocs = normalizeAllocs(rawAllocs);
  await ensureGames();

  const known = must(await db().from("assets").select("symbol").in("symbol", symbols)) as { symbol: string }[];
  const unknown = symbols.filter((s) => !known.some((k) => k.symbol === s));
  if (unknown.length) throw new GameError(`Not an eligible stock: ${unknown.join(", ")}`);

  const sched = await getSchedule(now);
  let target: Game | null = null;
  let late = false;
  if (sched.live) {
    const existing = must(
      await db().from("entries").select("player_id").eq("trade_date", sched.live.trade_date).eq("player_id", playerId),
    );
    if (existing.length) target = sched.upcoming; // already playing today -> these are tomorrow's picks
    else {
      target = sched.live;
      late = true;
    }
  } else target = sched.upcoming;
  if (!target) throw new GameError("No upcoming trading day found", 503);
  if (!late) {
    const already = must(
      await db().from("entries").select("player_id").eq("trade_date", target.trade_date).eq("player_id", playerId),
    );
    if (already.length) throw new GameError(LOCKED, 409);
  }

  const snaps = await market().snapshots(symbols);
  const tooCheap = symbols.filter((s) => !snaps[s] || snaps[s].price < MIN_PRICE);
  if (tooCheap.length)
    throw new GameError(`Stocks must trade above $${MIN_PRICE}: ${tooCheap.join(", ")}`);

  // Re-check the clock after the network round-trip: a pre-open pick must not slip past the bell.
  if (!late && Date.now() >= Date.parse(target.open_at))
    throw new GameError("The market just opened. Submit again to join today's game.", 409);

  const date = target.trade_date;
  const enteredAt = late ? now.toISOString() : null;
  // Submitting locks the picks: a plain insert, so a second submission for the same day fails.
  const ins = await db()
    .from("entries")
    .insert({ trade_date: date, player_id: playerId, symbols, allocs, entered_at: enteredAt, updated_at: now.toISOString() });
  if (ins.error?.code === "23505") throw new GameError(LOCKED, 409);
  must(ins);
  must(
    await db().from("legs").insert(
      symbols.map((symbol, i) => ({
        trade_date: date, player_id: playerId, symbol, alloc: allocs[i], base_price: late ? snaps[symbol].price : null,
      })),
    ),
  );
  if (late) {
    await recordPrices(date, snaps, now);
    must(await db().rpc("refresh_standings", { p_date: date })); // show up on boards right away
  }

  return { date, symbols, allocs, late };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type LegView = { symbol: string; alloc: number; base: number | null; price: number | null; ret: number };
export type EntryView = {
  date: string;
  number: number;
  status: Game["status"];
  symbols: string[];
  allocs: number[];
  late: boolean;
  enteredAt: string | null;
  legs: LegView[];
  ret: number;
  value: number;
  series: { t: string; v: number }[];
  rank: number | null;
  fieldSize: number | null;
  /** How many players today scored strictly lower (for the percentile). */
  beaten: number | null;
};

const num = (x: unknown) => (x == null ? null : Number(x));

export async function entryView(game: Game, playerId: string): Promise<EntryView | null> {
  const date = game.trade_date;
  const entry = must(
    await db().from("entries").select("*").eq("trade_date", date).eq("player_id", playerId).maybeSingle(),
  ) as { symbols: string[]; allocs: number[]; entered_at: string | null } | null;
  if (!entry) return null;

  const settled = game.status === "settled";
  const [legRows, quoteRows, result, number, ...tickSets] = await Promise.all([
    db().from("legs").select("*").eq("trade_date", date).eq("player_id", playerId).then(must),
    db().from("quotes").select("*").eq("trade_date", date).in("symbol", entry.symbols).then(must),
    // Global rank: frozen in results once settled, otherwise the latest live standings.
    db().from(settled ? "results" : "standings").select("return_pct, rank, field_size")
      .eq("trade_date", date).eq("player_id", playerId).maybeSingle().then(must),
    gameNumber(date),
    ...entry.symbols.map((s) =>
      db().from("ticks").select("ts, price").eq("trade_date", date).eq("symbol", s).order("ts").then(must),
    ),
  ]);

  const legs: LegView[] = entry.symbols.map((symbol, i) => {
    const l = (legRows as Record<string, unknown>[]).find((x) => x.symbol === symbol);
    const q = (quoteRows as Record<string, unknown>[]).find((x) => x.symbol === symbol);
    const base = num(l?.base_price) ?? (entry.entered_at ? null : num(q?.open_price));
    const price = settled ? num(l?.final_price) : num(q?.last_price);
    const ret = base && price ? price / base - 1 : 0;
    return { symbol, alloc: entry.allocs[i], base, price, ret };
  });
  const ret =
    settled && result
      ? Number(result.return_pct)
      : legs.reduce((a, l) => a + l.alloc * l.ret, 0) / PORTFOLIO_START;

  // Portfolio line: each stock's dollars at its base price, forward-filling missing minutes.
  const series: { t: string; v: number }[] = [];
  const startAt = entry.entered_at ?? game.open_at;
  if (legs.every((l) => l.base)) {
    series.push({ t: startAt, v: PORTFOLIO_START });
    const last: Record<string, number> = {};
    const points = (tickSets as { ts: string; price: number }[][])
      .flatMap((rows, i) => rows.map((r) => ({ symbol: entry.symbols[i], ts: r.ts, price: Number(r.price) })))
      .filter((p) => Date.parse(p.ts) >= Date.parse(minuteBucket(new Date(startAt)).toISOString()))
      .sort((a, b) => a.ts.localeCompare(b.ts));
    for (let i = 0; i < points.length; i++) {
      last[points[i].symbol] = points[i].price;
      if (i + 1 < points.length && points[i + 1].ts === points[i].ts) continue;
      if (Object.keys(last).length < 3) continue;
      const v = legs.reduce((a, l) => a + (l.alloc * last[l.symbol]) / l.base!, 0);
      if (Date.parse(points[i].ts) > Date.parse(startAt)) series.push({ t: points[i].ts, v });
    }
  }

  let beaten: number | null = null;
  if (result) {
    const { count } = await db()
      .from(settled ? "results" : "standings")
      .select("player_id", { count: "exact", head: true })
      .eq("trade_date", date)
      .lt("return_pct", result.return_pct);
    beaten = count ?? 0;
  }

  return {
    date,
    number,
    status: game.status,
    symbols: entry.symbols,
    allocs: entry.allocs,
    late: !!entry.entered_at,
    enteredAt: entry.entered_at,
    legs,
    ret,
    value: PORTFOLIO_START * (1 + ret),
    series,
    rank: result ? result.rank : null,
    fieldSize: result ? result.field_size : null,
    beaten,
  };
}

export type BoardRow = {
  rank: number;
  playerId: string;
  nickname: string;
  ret: number;
  symbols: string[];
  allocs: number[];
  fieldSize: number;
  globalRank: number;
  globalField: number;
};

export async function board(game: Game, opts: { groupId?: string; playerId?: string; limit?: number } = {}) {
  const rows = must(
    await db().rpc("day_board", {
      p_date: game.trade_date,
      p_group: opts.groupId ?? null,
      p_player: opts.playerId ?? null,
      p_limit: opts.limit ?? 50,
    }),
  ) as Record<string, unknown>[];
  return rows.map(
    (r): BoardRow => ({
      rank: Number(r.rank),
      playerId: String(r.player_id),
      nickname: String(r.nickname),
      ret: Number(r.return_pct),
      symbols: r.symbols as string[],
      allocs: r.allocs as number[],
      fieldSize: Number(r.field_size),
      globalRank: Number(r.global_rank),
      globalField: Number(r.global_field),
    }),
  );
}

/**
 * What a player's share link shows: their most relevant picks (today's if they're playing,
 * otherwise their next day's, otherwise their last) with live or final performance.
 */
export async function sharedPicks(playerId: string) {
  const player = must(await db().from("players").select("nickname").eq("id", playerId).maybeSingle()) as
    | { nickname: string }
    | null;
  if (!player) return null;
  const sched = await getSchedule();
  for (const g of [sched.live, sched.upcoming, sched.last]) {
    if (!g) continue;
    if (g === sched.upcoming) {
      const e = must(
        await db().from("entries").select("symbols, allocs").eq("trade_date", g.trade_date).eq("player_id", playerId).maybeSingle(),
      ) as { symbols: string[]; allocs: number[] } | null;
      if (e) return { nickname: player.nickname, date: g.trade_date, status: g.status, number: await gameNumber(g.trade_date), ...e, ret: null, legs: null };
      continue;
    }
    const v = await entryView(g, playerId);
    if (v)
      return {
        nickname: player.nickname, date: v.date, status: v.status, number: v.number, symbols: v.symbols, allocs: v.allocs,
        ret: v.ret, legs: v.legs.map((l) => ({ symbol: l.symbol, ret: l.ret })),
      };
  }
  return { nickname: player.nickname, date: null, status: null, number: null, symbols: [], allocs: [], ret: null, legs: null };
}

// ---------------------------------------------------------------------------
// Results-card stats
// ---------------------------------------------------------------------------

/**
 * Days played, and the current streak of consecutive trading days played. A live day you
 * haven't joined yet doesn't break the streak (you can still join).
 */
export async function playerStats(playerId: string, now = new Date()) {
  const [{ count: played }, entryRows, gameRows] = await Promise.all([
    db().from("entries").select("trade_date", { count: "exact", head: true }).eq("player_id", playerId),
    db().from("entries").select("trade_date").eq("player_id", playerId).order("trade_date", { ascending: false }).limit(400).then(must),
    db().from("games").select("trade_date, close_at").lte("open_at", now.toISOString()).order("trade_date", { ascending: false }).limit(400).then(must),
  ]);
  const playedDates = new Set((entryRows as { trade_date: string }[]).map((r) => r.trade_date));
  const days = gameRows as { trade_date: string; close_at: string }[];
  let i = 0;
  if (days[0] && !playedDates.has(days[0].trade_date) && Date.parse(days[0].close_at) > now.getTime()) i = 1;
  let streak = 0;
  for (; i < days.length && playedDates.has(days[i].trade_date); i++) streak++;
  return { played: played ?? 0, streak };
}

/** Score buckets (in points) for the "Where you landed" chart, best first. */
const BUCKETS = [
  { label: "+200 or more", min: 0.02, max: null },
  { label: "+50 to +200", min: 0.005, max: 0.02 },
  { label: "−50 to +50", min: -0.005, max: 0.005 },
  { label: "−200 to −50", min: -0.02, max: -0.005 },
  { label: "−200 or less", min: null, max: -0.02 },
] as const;

export async function distribution(game: Game) {
  const table = game.status === "settled" ? "results" : "standings";
  const counts = await Promise.all(
    BUCKETS.map(async (b) => {
      let q = db().from(table).select("player_id", { count: "exact", head: true }).eq("trade_date", game.trade_date);
      if (b.min != null) q = q.gte("return_pct", b.min);
      if (b.max != null) q = q.lt("return_pct", b.max);
      return (await q).count ?? 0;
    }),
  );
  return BUCKETS.map((b, i) => ({ label: b.label, min: b.min, max: b.max, count: counts[i] }));
}
