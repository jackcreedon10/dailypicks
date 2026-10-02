import companiesJson from "@/data/sp500.json";
import { db, must } from "./db";
import { GameError } from "./game";
import { addDays, etDate } from "./time";

// Daily Tickr: guess the day's S&P 500 company from its 1-year chart, in 5 tries.
// The answer never leaves the server until the puzzle is finished.

export type Company = {
  symbol: string;
  name: string;
  wiki: string | null;
  sector: string;
  industry: string;
  hq: string;
  state: string;
  founded: number;
  foundedText: string;
  shares: number;
  cap: number;
  rank: number;
};

export const COMPANIES = companiesJson as Company[];
const BY_SYMBOL = new Map(COMPANIES.map((c) => [c.symbol, c]));

export const MAX_GUESSES = 5;

/** Puzzle #1. One new puzzle every day at midnight New York time. */
const FIRST_DAY = "2026-10-02";

/** Household names only, so the answer is get-able. Any S&P 500 company can be guessed. */
export const ANSWER_POOL = `AAPL MSFT NVDA AMZN GOOGL META TSLA NFLX DIS NKE SBUX MCD KO PEP WMT COST TGT HD LOW JPM BAC
WFC GS MS V MA AXP PYPL JNJ PFE MRK ABBV LLY UNH CVS XOM CVX BA GE CAT DE F GM UPS FDX DAL UAL LUV MAR HLT ABNB
UBER BKNG EXPE CMG YUM DPZ HSY MDLZ GIS KHC CL PG KMB EL ULTA BBY ORCL CRM ADBE INTC AMD QCOM CSCO IBM DELL HPQ
AVGO MU T VZ TMUS CMCSA WBD TTWO HAS LULU TJX ROST DG DLTR KR SYY TSN HRL CLX LVS WYNN MGM CCL RCL NCLH MMM HON
LMT RTX NOC GD BLK SCHW ALL PGR KDP STZ MNST PM MO AZO ORLY TSCO DECK PLTR COIN HOOD ADP INTU GILD AMGN BMY SHW
EBAY WM RL TPR CHTR`
  .split(/\s+/)
  .filter((s) => BY_SYMBOL.has(s));

/** Deterministic shuffle so the order is fixed but not alphabetical. */
function shuffled<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const dayIndex = (date: string) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${FIRST_DAY}T12:00:00Z`)) / 86_400_000);

export function puzzleNumber(date: string) {
  return dayIndex(date) + 1;
}

export function answerFor(date: string): Company {
  const i = Math.max(0, dayIndex(date));
  const cycle = Math.floor(i / ANSWER_POOL.length);
  return BY_SYMBOL.get(shuffled(ANSWER_POOL, 20261002 + cycle)[i % ANSWER_POOL.length])!;
}

export const today = () => etDate(new Date());

// ---------------------------------------------------------------------------
// Guess feedback
// ---------------------------------------------------------------------------

/** match = right; close = near (same sector, same state, within 2x size or 15 years); miss = far off. */
export type Mark = "match" | "close" | "miss";
/** For size and founded: which way the answer is from your guess. */
export type Dir = "up" | "down" | null;

export type GuessRow = {
  symbol: string;
  name: string;
  correct: boolean;
  industry: { value: string; mark: Mark };
  size: { value: number; mark: Mark; dir: Dir };
  founded: { value: number; mark: Mark; dir: Dir };
  hq: { value: string; mark: Mark };
};

export function compare(g: Company, a: Company): GuessRow {
  const ratio = a.cap / g.cap;
  const years = a.founded - g.founded;
  return {
    symbol: g.symbol,
    name: g.name,
    correct: g.symbol === a.symbol,
    industry: { value: g.industry, mark: g.industry === a.industry ? "match" : g.sector === a.sector ? "close" : "miss" },
    size: {
      value: g.cap,
      mark: ratio >= 0.8 && ratio <= 1.25 ? "match" : ratio >= 0.5 && ratio <= 2 ? "close" : "miss",
      dir: ratio >= 0.8 && ratio <= 1.25 ? null : ratio > 1 ? "up" : "down",
    },
    founded: {
      value: g.founded,
      mark: years === 0 ? "match" : Math.abs(years) <= 15 ? "close" : "miss",
      dir: years === 0 ? null : years > 0 ? "up" : "down",
    },
    hq: { value: g.hq, mark: g.hq === a.hq ? "match" : g.state === a.state ? "close" : "miss" },
  };
}

/** Clues that unlock as wrong guesses pile up, so everyone can get there. */
export function hints(a: Company, wrong: number) {
  const out: { label: string; value: string }[] = [{ label: "Sector", value: a.sector }];
  if (wrong >= 1) out.push({ label: "Industry", value: a.industry });
  if (wrong >= 2) out.push({ label: "Headquarters", value: a.hq });
  if (wrong >= 3) out.push({ label: "Founded", value: a.foundedText });
  if (wrong >= 4) out.push({ label: "Starts with", value: `"${a.name[0]}" (ticker ${a.symbol[0]}…)` });
  return out;
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

const alpacaHeaders = () => ({
  "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID ?? "",
  "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY ?? "",
});

export type Bar = { t: string; c: number };

/** One year of daily closes up to the end of the day before the puzzle (fixed for the whole day). */
export async function yearChart(symbol: string, date: string): Promise<Bar[]> {
  const start = addDays(date, -366);
  const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&start=${start}&end=${date}T00:00:00Z&feed=sip&adjustment=all&limit=1000`;
  const res = await fetch(url, { headers: alpacaHeaders(), next: { revalidate: 6 * 3600 } });
  if (!res.ok) throw new Error(`Alpaca bars ${symbol}: ${res.status}`);
  const data = (await res.json()) as { bars?: { t: string; c: number }[] };
  return (data.bars ?? []).map((b) => ({ t: b.t.slice(0, 10), c: b.c }));
}

type AlpacaSnapshot = {
  latestTrade?: { p: number; t: string };
  dailyBar?: { c: number };
  prevDailyBar?: { c: number };
};

async function snapshot(symbol: string): Promise<{ price: number; prevClose: number | null; asOf: string | null } | null> {
  const url = `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symbol)}&feed=${process.env.ALPACA_FEED ?? "iex"}`;
  const res = await fetch(url, { headers: alpacaHeaders(), next: { revalidate: 60 } });
  if (!res.ok) return null;
  const s = ((await res.json()) as Record<string, AlpacaSnapshot>)[symbol];
  const price = s?.latestTrade?.p ?? s?.dailyBar?.c;
  if (!price) return null;
  return { price, prevClose: s?.prevDailyBar?.c ?? null, asOf: s?.latestTrade?.t ?? null };
}

type AlpacaNews = { headline: string; url: string; source: string; created_at: string; symbols: string[]; summary?: string };

/** Recent headlines that are mainly about this company (skips market roundups that tag dozens of tickers). */
async function news(symbol: string, name: string): Promise<{ headline: string; url: string; source: string; date: string }[]> {
  const url = `https://data.alpaca.markets/v1beta1/news?symbols=${encodeURIComponent(symbol)}&limit=30&sort=desc`;
  const res = await fetch(url, { headers: alpacaHeaders(), next: { revalidate: 1800 } });
  if (!res.ok) return [];
  const items = ((await res.json()) as { news?: AlpacaNews[] }).news ?? [];
  const seen = new Set<string>();
  // Prefer headlines that name the company; analyst price-target notes only as a last resort.
  const word = name.replace(/^The /, "").split(/[\s,.]/)[0].toLowerCase();
  const score = (n: AlpacaNews) => {
    const h = n.headline.toLowerCase();
    const named = h.includes(word) || new RegExp(`\\b${symbol.toLowerCase()}\\b`).test(h);
    return (named ? 0 : 2) + (/\b(maintains|reiterates|price target)\b/.test(h) ? 1 : 0);
  };
  const ranked = items.filter((n) => n.symbols.length <= 3 && n.url).sort((x, y) => score(x) - score(y));
  const out = [];
  for (const n of ranked) {
    const key = n.headline.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ headline: n.headline, url: n.url, source: n.source, date: n.created_at.slice(0, 10) });
    if (out.length === 3) break;
  }
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

async function wikiSummary(title: string | null): Promise<string | null> {
  if (!title) return null;
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, {
    headers: { "user-agent": "DailyTickr/1.0 (jackcreedon12@gmail.com)" },
    next: { revalidate: 7 * 86_400 },
  });
  if (!res.ok) return null;
  const extract = ((await res.json()) as { extract?: string }).extract;
  if (!extract) return null;
  // Up to three sentences, kept short.
  // A sentence ends at . ! or ? followed by a space and a capital (so "146.8 million" stays whole).
  const sentences = extract.match(/[\s\S]*?[.!?](?=\s+[A-Z"(]|\s*$)/g)?.map((x) => x.trim() + " ") ?? [extract];
  let out = "";
  for (const s of sentences.slice(0, 3)) {
    if (out && (out + s).length > 420) break;
    out += s;
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// Reveal and stats
// ---------------------------------------------------------------------------

export async function reveal(a: Company, date: string) {
  const [chart, snap, headlines, about, market] = await Promise.all([
    yearChart(a.symbol, date),
    snapshot(a.symbol),
    news(a.symbol, a.name),
    wikiSummary(a.wiki),
    // SPY, the biggest fund that tracks the S&P 500, stands in for "the market".
    yearChart("SPY", date).catch(() => [] as Bar[]),
  ]);
  const closes = chart.map((b) => b.c);
  const price = snap?.price ?? closes.at(-1) ?? null;
  const yearAgo = closes[0] ?? null;
  return {
    symbol: a.symbol,
    name: a.name,
    sector: a.sector,
    industry: a.industry,
    hq: a.hq,
    founded: a.foundedText,
    about,
    price,
    asOf: snap?.asOf ?? null,
    dayChange: snap?.prevClose && price ? price / snap.prevClose - 1 : null,
    yearChange: yearAgo && price ? price / yearAgo - 1 : null,
    low52: closes.length ? Math.min(...closes) : null,
    high52: closes.length ? Math.max(...closes) : null,
    marketCap: price ? a.shares * price : a.cap,
    /** Same year of daily closes for the S&P 500, for the "vs the market" chart. */
    market,
    news: headlines,
  };
}

export type Reveal = Awaited<ReturnType<typeof reveal>>;

/** Your own record only: totals, streaks, how many guesses you usually need, and your recent puzzles. */
export async function stats(playerId: string, date: string) {
  const plays = (await db()
    .from("mystery_plays")
    .select("puzzle_date, solved, guesses")
    .eq("player_id", playerId)
    .order("puzzle_date", { ascending: false })
    .limit(1000)
    .then(must)) as { puzzle_date: string; solved: boolean; guesses: string[] }[];
  const wins = plays.filter((p) => p.solved).length;

  // Streaks count consecutive days solved. The current one ends today (or yesterday, if today isn't finished).
  const solvedDays = new Set(plays.filter((p) => p.solved).map((p) => p.puzzle_date));
  let day = solvedDays.has(date) ? date : addDays(date, -1);
  let streak = 0;
  while (solvedDays.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  let best = 0;
  for (const d of solvedDays) {
    if (solvedDays.has(addDays(d, -1))) continue; // only count from the start of each run
    let n = 0;
    while (solvedDays.has(addDays(d, n))) n++;
    best = Math.max(best, n);
  }

  // How many of your games you solved in 1..5 guesses; the last slot is misses.
  const dist = Array.from({ length: MAX_GUESSES + 1 }, () => 0);
  for (const p of plays) dist[p.solved ? Math.min(p.guesses.length, MAX_GUESSES) - 1 : MAX_GUESSES]++;

  const recent = plays.slice(0, 10).map((p) => {
    const a = answerFor(p.puzzle_date);
    return { number: puzzleNumber(p.puzzle_date), date: p.puzzle_date, name: a.name, symbol: a.symbol, guesses: p.guesses.length, solved: p.solved };
  });

  return { played: plays.length, winPct: plays.length ? Math.round((wins / plays.length) * 100) : 0, streak, best, dist, recent };
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

export function parseGuesses(raw: unknown): Company[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_GUESSES) throw new GameError(`Send 1 to ${MAX_GUESSES} guesses`);
  const out = raw.map((s) => {
    const c = typeof s === "string" ? BY_SYMBOL.get(s.toUpperCase()) : undefined;
    if (!c) throw new GameError(`Not an S&P 500 company: ${String(s)}`);
    return c;
  });
  if (new Set(out.map((c) => c.symbol)).size !== out.length) throw new GameError("You already guessed that one");
  return out;
}

/** Score a list of guesses. Once the puzzle is finished, records the play (first finish counts) and reveals. */
export async function play(playerId: string, date: string, rawGuesses: unknown) {
  if (date !== today()) throw new GameError("A new puzzle is out. Refresh to play it.", 409);
  const answer = answerFor(date);
  const guesses = parseGuesses(rawGuesses);
  const solvedAt = guesses.findIndex((g) => g.symbol === answer.symbol);
  if (solvedAt >= 0 && solvedAt < guesses.length - 1) throw new GameError("The puzzle was already solved");
  const rows = guesses.map((g) => compare(g, answer));
  const solved = solvedAt >= 0;
  const done = solved || guesses.length === MAX_GUESSES;
  const wrong = guesses.length - (solved ? 1 : 0);

  if (!done) return { rows, hints: hints(answer, wrong), done, solved, reveal: null, stats: null };

  // First finish counts; a replay from another device keeps the original result.
  const ins = await db()
    .from("mystery_plays")
    .insert({ puzzle_date: date, player_id: playerId, guesses: guesses.map((g) => g.symbol), solved });
  if (ins.error && ins.error.code !== "23505") throw new Error(ins.error.message);

  const [rev, st] = await Promise.all([reveal(answer, date), stats(playerId, date)]);
  return { rows, hints: hints(answer, wrong), done, solved, reveal: rev, stats: st };
}
