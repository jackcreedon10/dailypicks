import companiesJson from "@/data/sp500.json";
import { db, must } from "./db";
import { GameError } from "./game";
import { BRACKETS } from "./brackets";
import { randomInt } from "node:crypto";
import { addDays, etDate } from "./time";

// Tickr Guesser: guess the day's S&P 500 company from its 1-year chart, in 5 tries.
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

const dayIndex = (date: string) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${FIRST_DAY}T12:00:00Z`)) / 86_400_000);

export function puzzleNumber(date: string) {
  return dayIndex(date) + 1;
}

/** No company repeats within this many days. */
const NO_REPEAT_DAYS = 120;

/**
 * The day's answer. Picked at random the first time the day is played, then saved, so future answers can't be
 * worked out from the (public) code and past answers never change. Practice days (local testing) get a
 * throwaway pick that isn't saved, so testing never locks in a real future answer.
 */
export async function answerFor(date: string, practice = false): Promise<Company> {
  if (practice) {
    const h = [...`practice:${date}`].reduce((x, ch) => (Math.imul(x, 31) + ch.charCodeAt(0)) >>> 0, 7);
    return BY_SYMBOL.get(ANSWER_POOL[h % ANSWER_POOL.length])!;
  }
  const saved = await savedAnswers([date]);
  if (saved[date]) return saved[date];

  const recent = (await db()
    .from("puzzle_answers")
    .select("symbol")
    .lt("puzzle_date", date)
    .order("puzzle_date", { ascending: false })
    .limit(NO_REPEAT_DAYS)
    .then(must)) as { symbol: string }[];
  const used = new Set(recent.map((r) => r.symbol));
  const fresh = ANSWER_POOL.filter((sym) => !used.has(sym));
  const choices = fresh.length ? fresh : ANSWER_POOL;
  const symbol = choices[randomInt(choices.length)];

  // If another request picked first, theirs wins: re-read instead of overwriting.
  const ins = await db().from("puzzle_answers").insert({ puzzle_date: date, symbol });
  if (ins.error && ins.error.code !== "23505") throw new Error(ins.error.message);
  return (await savedAnswers([date]))[date] ?? BY_SYMBOL.get(symbol)!;
}

/** Saved answers for the given days (days with no answer yet are left out). */
async function savedAnswers(dates: string[]): Promise<Record<string, Company>> {
  if (!dates.length) return {};
  const rows = (await db().from("puzzle_answers").select("puzzle_date, symbol").in("puzzle_date", dates).then(must)) as {
    puzzle_date: string;
    symbol: string;
  }[];
  const out: Record<string, Company> = {};
  for (const row of rows) {
    const c = BY_SYMBOL.get(row.symbol);
    if (!c) throw new Error(`Saved answer ${row.symbol} for ${row.puzzle_date} is no longer in the company list`);
    out[row.puzzle_date] = c;
  }
  return out;
}

export const today = () => etDate(new Date());

/** Local testing only: play another day's puzzle with ?day=YYYY-MM-DD. Never allowed in production. */
export function practiceDate(raw: unknown): string | null {
  if (process.env.NODE_ENV === "production" || typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
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
  // The free plan blocks full-market (SIP) data from the last 15 minutes, so never ask past 20 minutes ago.
  const end = new Date(Math.min(Date.parse(`${date}T00:00:00Z`), Date.now() - 20 * 60_000)).toISOString();
  const url = `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&start=${start}&end=${end}&feed=sip&adjustment=all&limit=1000`;
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
    headers: { "user-agent": "TickrGuesser/1.0 (jackcreedon12@gmail.com)" },
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
    founded: String(foundedYear(a)),
    about,
    price,
    asOf: snap?.asOf ?? null,
    dayChange: snap?.prevClose && price ? price / snap.prevClose - 1 : null,
    yearChange: yearAgo && price ? price / yearAgo - 1 : null,
    low52: closes.length ? Math.min(...closes) : null,
    high52: closes.length ? Math.max(...closes) : null,
    marketCap: price ? a.shares * price : a.cap,
    bracket: BRACKETS[bracketOf(a.cap)],
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

  const last = plays.slice(0, 10);
  const answers = await savedAnswers(last.map((p) => p.puzzle_date));
  const recent = last.filter((p) => answers[p.puzzle_date]).map((p) => {
    const a = answers[p.puzzle_date];
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

// ---------------------------------------------------------------------------
// Guess cards: industry, size, founded, HQ. Green only when it truly matches.
// ---------------------------------------------------------------------------

// Uses the stored market caps, so a company's bracket doesn't change from day to day.
const bracketOf = (cap: number) => BRACKETS.findIndex((b) => cap >= b.min);

/** Original founding year: Wikipedia lists e.g. "1983 (1877)" for companies re-formed later. */
export const foundedYear = (c: Company) =>
  Math.min(...(c.foundedText.match(/\b(1[6-9]\d\d|20\d\d)\b/g) ?? [String(c.founded)]).map(Number));

const REGIONS: Record<string, string> = Object.fromEntries(
  Object.entries({
    Northeast: "Connecticut Maine Massachusetts New_Hampshire New_Jersey New_York Pennsylvania Rhode_Island Vermont",
    Midwest: "Illinois Indiana Iowa Kansas Michigan Minnesota Missouri Nebraska North_Dakota Ohio South_Dakota Wisconsin",
    South:
      "Alabama Arkansas D.C. Delaware Florida Georgia Kentucky Louisiana Maryland Mississippi North_Carolina Oklahoma South_Carolina Tennessee Texas Virginia West_Virginia",
    West: "Alaska Arizona California Colorado Hawaii Idaho Montana Nevada New_Mexico Oregon Utah Washington Wyoming",
  }).flatMap(([region, states]) => states.split(" ").map((st) => [st.replace(/_/g, " "), region])),
);
/** US region for a state; anywhere outside the US counts as one "International" region. */
const regionOf = (state: string) => REGIONS[state] ?? "International";

/** match = green, close = yellow, miss = grey. dir: which way the answer is (size and founded only). */
export type Mark = "match" | "close" | "miss";
export type Card = { value: string; mark: Mark; dir?: "up" | "down" | null };
export type GuessCards = { industry: Card; size: Card; founded: Card; hq: Card };

/** Same/one-off/further on an ordered scale, with an arrow toward the answer. */
function scale(guess: number, answer: number, value: string): Card {
  const gap = Math.abs(guess - answer);
  return { value, mark: gap === 0 ? "match" : gap === 1 ? "close" : "miss", dir: gap === 0 ? null : answer > guess ? "up" : "down" };
}

export function cards(g: Company, a: Company): GuessCards {
  const gb = bracketOf(g.cap), ab = bracketOf(a.cap);
  const gd = Math.floor(foundedYear(g) / 10), ad = Math.floor(foundedYear(a) / 10);
  return {
    industry: { value: g.industry, mark: g.industry === a.industry ? "match" : g.sector === a.sector ? "close" : "miss" },
    // Brackets are listed biggest first, so a lower index means bigger: flip for the arrow.
    size: scale(-gb, -ab, BRACKETS[gb].label),
    founded: scale(gd, ad, `${gd * 10}s`),
    hq: { value: g.state, mark: g.state === a.state ? "match" : regionOf(g.state) === regionOf(a.state) ? "close" : "miss" },
  };
}

export type GuessResult = { symbol: string; name: string; correct: boolean; cards: GuessCards };

/** Check a list of guesses: right or wrong, plus the four cards. Once finished, records the play (first finish counts) and reveals. */
export async function play(playerId: string, date: string, rawGuesses: unknown) {
  const practice = date !== today() && practiceDate(date) === date;
  if (date !== today() && !practice) throw new GameError("A new puzzle is out. Refresh to play it.", 409);
  const answer = await answerFor(date, practice);
  const guesses = parseGuesses(rawGuesses);
  const solvedAt = guesses.findIndex((g) => g.symbol === answer.symbol);
  if (solvedAt >= 0 && solvedAt < guesses.length - 1) throw new GameError("The puzzle was already solved");
  const results: GuessResult[] = guesses.map((g) => ({
    symbol: g.symbol,
    name: g.name,
    correct: g.symbol === answer.symbol,
    cards: cards(g, answer),
  }));
  const solved = solvedAt >= 0;
  const done = solved || guesses.length === MAX_GUESSES;

  if (!done) return { guesses: results, done, solved, reveal: null, stats: null };

  // First finish counts; a replay from another device keeps the original result. Practice games aren't saved.
  if (!practice) {
    const ins = await db()
      .from("mystery_plays")
      .insert({ puzzle_date: date, player_id: playerId, guesses: guesses.map((g) => g.symbol), solved });
    if (ins.error && ins.error.code !== "23505") throw new Error(ins.error.message);
  }

  const [rev, st] = await Promise.all([reveal(answer, date), stats(playerId, date)]);
  return { guesses: results, done, solved, reveal: rev, stats: st };
}
