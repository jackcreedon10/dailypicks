"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, clock, loadIdentity, pct, saveIdentity, shareText, tone, type Identity } from "@/lib/client";
import { BRACKETS, SECTOR_MEANING } from "@/lib/brackets";
import type { Bar, GuessResult, Mark, Reveal } from "@/lib/mystery";

type Puzzle = {
  date: string;
  number: number;
  maxGuesses: number;
  chart: Bar[];
  sector: string;
  finishedGuesses: string[] | null;
  streak: number;
  played: number;
};
type Stats = {
  played: number;
  winPct: number;
  streak: number;
  best: number;
  dist: number[];
  recent: { number: number; date: string; name: string; symbol: string; guesses: number; solved: boolean }[];
};
type Result = { guesses: GuessResult[]; done: boolean; solved: boolean; reveal: Reveal | null; stats: Stats | null };

// Bump the version to make every device forget its saved guesses (e.g. after clearing plays from the database).
const saved = (date: string) => `tickr.v2.${date}`;
const SHOW_SECTOR = "tickr.showSector";

function loadGuesses(date: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(saved(date)) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function storeGuesses(date: string, guesses: string[]) {
  try {
    localStorage.setItem(saved(date), JSON.stringify(guesses));
  } catch {
    // Private mode: the board still works until reload.
  }
}

export const capLabel = (x: number) =>
  x >= 1e12 ? `$${(x / 1e12).toFixed(1)}T` : x >= 1e9 ? `$${Math.round(x / 1e9)}B` : `$${Math.round(x / 1e6)}M`;

const usd = (x: number | null) => (x == null ? "--" : `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const usd0 = (x: number | null) => (x == null ? "--" : `$${Math.round(x).toLocaleString("en-US")}`);

/** "Oct '25" */
const month = (d: string) =>
  `${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} '${d.slice(2, 4)}`;

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Seconds until midnight New York time, when the next puzzle comes out. */
function msToNextPuzzle(now: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(now))
      .map((x) => [x.type, Number(x.value)]),
  );
  return (86_400 - (p.hour * 3600 + p.minute * 60 + p.second)) * 1000;
}

const SQUARE: Record<Mark, string> = { match: "🟩", close: "🟨", miss: "⬜" };

const CARD_ORDER = ["industry", "size", "founded", "hq"] as const;
const CARD_LABEL = { industry: "Industry", size: "Size", founded: "Founded", hq: "HQ" } as const;

/** One row of four squares per guess, Wordle style, for the result and share text. */
const grid = (gs: GuessResult[]) => gs.map((g) => CARD_ORDER.map((k) => SQUARE[g.cards[k].mark]).join("")).join("\n");

const TILE: Record<Mark, string> = {
  match: "bg-up text-white",
  close: "bg-amber-400 text-black",
  miss: "bg-line text-fg",
};

function GuessRow({ g }: { g: GuessResult }) {
  const arrow = (d?: "up" | "down" | null) => (d === "up" ? " ↑" : d === "down" ? " ↓" : "");
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-semibold">
          {g.correct ? <span className="mr-1.5 text-up">✓</span> : <span className="mr-1.5 font-mono text-xs text-down">✗</span>}
          {g.name}
        </span>
        <span className="font-mono text-xs text-muted">{g.symbol}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {CARD_ORDER.map((k) => (
          <div key={k} className={`flex min-h-12 items-center justify-center rounded-lg px-1 py-1.5 text-center ${TILE[g.cards[k].mark]}`}>
            <span className="line-clamp-2 text-[11px] font-semibold leading-tight [overflow-wrap:anywhere]">
              {g.cards[k].value}
              {arrow(g.cards[k].dir)}
            </span>
          </div>
        ))}
      </div>
    </li>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-4 sm:p-5 ${className}`}>{children}</section>;
}

function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`font-mono text-[11px] uppercase tracking-[0.18em] text-muted ${className}`}>{children}</p>;
}

/** 1-year price chart. Unlabeled during play; the reveal passes the company name. */
function Chart({ bars, compact = false }: { bars: Bar[]; compact?: boolean }) {
  if (bars.length < 2) return <div className="h-36 rounded-xl bg-line/40" />;
  const W = 320, H = 140, P = 4;
  const closes = bars.map((b) => b.c);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const x = (i: number) => P + (i / (bars.length - 1)) * (W - 2 * P);
  const y = (c: number) => P + (1 - (c - lo) / (hi - lo || 1)) * (H - 2 * P);
  const line = bars.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(b.c).toFixed(1)}`).join("");
  const up = closes.at(-1)! >= closes[0];
  const color = up ? "var(--up)" : "var(--down)";
  return (
    <div>
      <div className="flex justify-between font-mono text-[11px] text-muted tabular">
        <span>
          High {usd(hi)} · Low {usd(lo)}
        </span>
        <span className={up ? "text-up" : "text-down"}>{pct(closes.at(-1)! / closes[0] - 1, 1)} in a year</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={`mt-1 w-full ${compact ? "h-28" : "h-36"}`} preserveAspectRatio="none" role="img" aria-label="One-year stock chart">
        <defs>
          <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.25" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${x(bars.length - 1)},${H}L${x(0)},${H}Z`} fill="url(#fill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between font-mono text-[11px] text-muted tabular">
        <span>
          {month(bars[0].t)} · {usd(closes[0])}
        </span>
        <span>
          {month(bars.at(-1)!.t)} · {usd(closes.at(-1)!)}
        </span>
      </div>
    </div>
  );
}

/** The stock vs the S&P 500 over the same year, both as % change from the start. */
function VsMarket({ symbol, stock, market }: { symbol: string; stock: Bar[]; market: Bar[] }) {
  const spy = new Map(market.map((b) => [b.t, b.c]));
  const days = stock.filter((b) => spy.has(b.t));
  if (days.length < 2) return null;
  const s0 = days[0].c, m0 = spy.get(days[0].t)!;
  const s = days.map((b) => b.c / s0 - 1);
  const m = days.map((b) => spy.get(b.t)! / m0 - 1);
  const W = 320, H = 150, P = 6;
  const lo = Math.min(0, ...s, ...m), hi = Math.max(0, ...s, ...m);
  const x = (i: number) => P + (i / (days.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const sEnd = s.at(-1)!, mEnd = m.at(-1)!;
  const gap = Math.round((sEnd - mEnd) * 100);
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-accent" />
          <span className="font-semibold">{symbol}</span>
          <span className={`font-mono tabular ${tone(sEnd)}`}>{pct(sEnd, 1)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-muted" />
          <span className="font-semibold">S&amp;P 500</span>
          <span className={`font-mono tabular ${tone(mEnd)}`}>{pct(mEnd, 1)}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-36 w-full" preserveAspectRatio="none" role="img" aria-label={`${symbol} versus the S&P 500 over one year`}>
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <path d={path(m)} fill="none" stroke="var(--muted)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={path(s)} fill="none" stroke="var(--accent)" strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between font-mono text-[11px] text-muted">
        <span>{month(days[0].t)}</span>
        <span>dashed line = 0%</span>
        <span>{month(days.at(-1)!.t)}</span>
      </div>
      <p className="mt-2 text-sm leading-snug">
        {gap === 0
          ? `${symbol} moved in line with the market over the last year.`
          : gap > 0
            ? `${symbol} beat the market by ${gap} percentage point${gap === 1 ? "" : "s"} over the last year.`
            : `${symbol} trailed the market by ${-gap} percentage point${gap === -1 ? "" : "s"} over the last year.`}
      </p>
      <p className="mt-1 text-xs leading-snug text-muted">
        The S&amp;P 500 tracks 500 of the biggest US companies. Buying a fund that holds all of them is the simplest way to
        &quot;own the market&quot;, so it&apos;s the yardstick for any single stock.
      </p>
    </div>
  );
}

/** Every possible answer, A to Z, with no grouping (grouping by sector would give it away). Tapping a name fills the guess box; it doesn't guess. */
function AnswerBank({ bank, taken, onPick }: { bank: [string, string][]; taken: Set<string>; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1.5 font-mono text-xs text-muted">
        <span className="flex h-4 w-4 items-center justify-center rounded border border-line text-[11px] leading-none">{open ? "−" : "+"}</span>
        {open ? "Hide stock list" : "Stuck? Browse possible answers"}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line">
          <p className="border-b border-line px-3 py-2 text-xs text-muted">
            Every answer is one of these {bank.length} companies. Tap one to put it in the guess box.
          </p>
          <div className="flex max-h-72 flex-wrap gap-1.5 overflow-y-auto p-3">
            {bank.map(([sym, name]) => (
              <button
                key={sym}
                onClick={() => onPick(name)}
                disabled={taken.has(sym)}
                className="rounded-full border border-line px-2.5 py-1 text-xs active:bg-line/60 disabled:line-through disabled:opacity-40"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Guesser({ companies, bank, taken, disabled, onGuess }: { companies: [string, string][]; bank: [string, string][]; taken: Set<string>; disabled: boolean; onGuess: (s: string) => void }) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const scored = companies
      .filter(([sym]) => !taken.has(sym))
      .map(([sym, name]) => {
        const n = name.toLowerCase();
        const score = sym.toLowerCase() === s ? 0 : n.startsWith(s) ? 1 : sym.toLowerCase().startsWith(s) ? 2 : n.includes(s) ? 3 : -1;
        return { sym, name, score };
      })
      .filter((m) => m.score >= 0);
    return scored.sort((a, b) => a.score - b.score).slice(0, 4);
  }, [q, companies, taken]);

  function pick(sym: string) {
    setQ("");
    onGuess(sym);
    input.current?.focus({ preventScroll: true });
  }

  return (
    <div>
      <div className="relative">
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && matches[0] && pick(matches[0].sym)}
          disabled={disabled}
          type="search"
          inputMode="search"
          name="tickr-guess"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Type a stock name or ticker"
          className="w-full rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent disabled:opacity-50"
        />
        {matches.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-lg">
            {matches.map((m) => (
              <li key={m.sym}>
                <button onClick={() => pick(m.sym)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left active:bg-line/60">
                  <span className="truncate">{m.name}</span>
                  <span className="font-mono text-xs text-muted">{m.sym}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AnswerBank
        bank={bank}
        taken={taken}
        onPick={(name) => {
          setQ(name);
          input.current?.focus({ preventScroll: true });
        }}
      />
    </div>
  );
}

function Fact({ label, value, valueClass = "", note }: { label: string; value: string; valueClass?: string; note: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-bold tabular ${valueClass}`}>{value}</div>
      <p className="mt-1 text-xs leading-snug text-muted">{note}</p>
    </div>
  );
}

function RevealCard({ r, bars }: { r: Reveal; bars: Bar[] }) {
  return (
    <Card>
      <Kicker>Today&apos;s mystery stock</Kicker>
      <h2 className="mt-1 text-2xl font-bold leading-tight">
        {r.name} <span className="font-mono text-base font-semibold text-muted">{r.symbol}</span>
      </h2>
      <p className="text-sm text-muted">
        {r.industry} · {r.hq} · founded {r.founded}
      </p>
      {r.about && <p className="mt-3 leading-relaxed">{r.about}</p>}

      <Kicker className="mt-5">The stock today</Kicker>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Fact
          label="Share price"
          value={usd(r.price)}
          note={r.dayChange == null ? "The price of one share." : `${pct(r.dayChange)} today. The price of one share right now.`}
          valueClass={r.dayChange == null ? "" : tone(r.dayChange)}
        />
        <Fact
          label="Market cap"
          value={capLabel(r.marketCap)}
          note={`What the whole company is worth: share price × all its shares. Size: ${r.bracket.label} (${r.bracket.range}).`}
        />
        <Fact
          label="Past year"
          value={r.yearChange == null ? "--" : pct(r.yearChange, 1)}
          valueClass={r.yearChange == null ? "" : tone(r.yearChange)}
          note={
            r.yearChange == null
              ? "How the stock did over the last 12 months."
              : `$1,000 invested a year ago would be about $${Math.round(1000 * (1 + r.yearChange)).toLocaleString("en-US")} now.`
          }
        />
        <Fact label="52-week range" value={`${usd0(r.low52)}–${usd0(r.high52)}`} note="Its lowest and highest closing price over the past year." />
      </div>
      <Kicker className="mt-5">Vs. the market</Kicker>
      <div className="mt-2">
        {r.market.length ? <VsMarket symbol={r.symbol} stock={bars} market={r.market} /> : <Chart bars={bars} />}
      </div>

      {r.news.length > 0 && (
        <>
          <Kicker className="mt-5">In the news</Kicker>
          <ul className="mt-2 space-y-2">
            {r.news.map((n) => (
              <li key={n.url}>
                <a href={n.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-line p-3 active:bg-line/50">
                  <span className="text-sm font-medium leading-snug">{n.headline}</span>
                  <span className="mt-1 block font-mono text-[11px] text-muted">
                    {n.source} · {shortDate(n.date)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Your record: totals, your guess distribution across every game (today highlighted), and recent puzzles. */
function StatsCard({ s, mine, max }: { s: Stats; mine: number; max: number }) {
  const top = Math.max(1, ...s.dist);
  return (
    <Card>
      <Kicker>Your stats</Kicker>
      <div className="mt-2 grid grid-cols-4 divide-x divide-line rounded-xl border border-line">
        {[
          { label: "Played", value: String(s.played) },
          { label: "Solved", value: `${s.winPct}%` },
          { label: "Streak", value: String(s.streak) },
          { label: "Best", value: String(s.best) },
        ].map((it) => (
          <div key={it.label} className="py-2 text-center">
            <div className="font-mono text-xl font-bold tabular">{it.value}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{it.label}</div>
          </div>
        ))}
      </div>
      <Kicker className="mt-4">Your guesses</Kicker>
      <ul className="mt-2 space-y-1">
        {s.dist.map((n, i) => {
          const today = mine === i;
          return (
            <li key={i} className="flex items-center gap-2 font-mono text-xs">
              <span className="w-4 text-right text-muted">{i < max ? i + 1 : "X"}</span>
              <span className="relative h-5 flex-1">
                <span
                  className={`absolute inset-y-0 left-0 flex items-center justify-end rounded px-1.5 text-[10px] font-bold ${today ? "bg-accent text-accent-fg" : "bg-muted/30"}`}
                  style={{ width: `${Math.max(8, (n / top) * 100)}%` }}
                >
                  {n}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {s.recent.length > 1 && (
        <>
          <Kicker className="mt-4">Recent puzzles</Kicker>
          <ul className="mt-2 divide-y divide-line">
            {s.recent.map((p) => (
              <li key={p.date} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-mono text-xs text-muted">#{p.number}</span> {p.name}{" "}
                  <span className="font-mono text-xs text-muted">{p.symbol}</span>
                </span>
                <span className={`shrink-0 font-mono text-xs font-semibold ${p.solved ? "text-up" : "text-down"}`}>
                  {p.solved ? `${p.guesses}/${max}` : `X/${max}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function Mystery({ companies, bank }: { companies: [string, string][]; bank: [string, string][] }) {
  const [me, setMe] = useState<Identity | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The sector hint is optional: hidden unless you turn it on. The choice sticks on this device.
  const [showSector, setShowSector] = useState(false);

  useEffect(() => {
    const id = loadIdentity();
    setMe(id);
    try {
      setShowSector(localStorage.getItem(SHOW_SECTOR) === "1");
    } catch {
      // Storage blocked: default to hidden.
    }
    (async () => {
      try {
        const day = new URLSearchParams(location.search).get("day"); // local testing only; ignored in production
        const p = await api<Puzzle>(`/api/mystery${day ? `?day=${encodeURIComponent(day)}` : ""}`, { me: id });
        setPuzzle(p);
        const g = p.finishedGuesses ?? loadGuesses(p.date);
        if (g.length && id) {
          setGuesses(g);
          const r = await api<Result>("/api/mystery/guess", { method: "POST", body: { date: p.date, guesses: g }, me: id });
          setResult(r);
          if (!r.done) setPlaying(true); // mid-game: skip the home screen
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  async function ensureIdentity(): Promise<Identity> {
    if (me) return me;
    const created = await api<Identity>("/api/player", { method: "POST", body: {} });
    saveIdentity(created);
    setMe(created);
    return created;
  }

  async function guess(symbol: string) {
    if (!puzzle || busy) return;
    const next = [...guesses, symbol];
    setBusy(true);
    setError(null);
    try {
      const id = await ensureIdentity();
      const r = await api<Result>("/api/mystery/guess", { method: "POST", body: { date: puzzle.date, guesses: next }, me: id });
      setGuesses(next);
      storeGuesses(puzzle.date, next);
      setResult(r);
      if (r.done) window.scrollTo({ top: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!puzzle || !result) return;
    const score = result.solved ? `${result.guesses.length}/${puzzle.maxGuesses}` : `X/${puzzle.maxGuesses}`;
    const r = await shareText(`Tickr Guesser #${puzzle.number} · ${score}\n${grid(result.guesses)}`, location.origin);
    if (r === "copied") flash("Copied. Paste it in the group chat.");
  }

  function toggleSector() {
    const next = !showSector;
    setShowSector(next);
    try {
      localStorage.setItem(SHOW_SECTOR, next ? "1" : "0");
    } catch {
      // Storage blocked: the toggle still works for this visit.
    }
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  if (!puzzle) {
    return (
      <Shell>
        <p className="mt-24 text-center text-sm text-muted">{error ? `Couldn't load today's puzzle: ${error}` : "Loading..."}</p>
      </Shell>
    );
  }

  const tried = result?.guesses ?? [];
  const done = !!result?.done;
  const left = puzzle.maxGuesses - tried.length;
  const nextIn = clock(msToNextPuzzle(now));
  const toast_ = toast && (
    <div className="fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-20 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-fg px-4 py-2 text-center text-sm text-bg shadow-lg">
      {toast}
    </div>
  );

  // Home: one screen, one button.
  if (!done && !playing) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="flex gap-1.5" aria-hidden="true">
            {["bg-down", "bg-down", "bg-up"].map((c, i) => (
              <span key={i} className={`h-4 w-4 rounded ${c}`} />
            ))}
          </div>
          <h1 className="mt-5 text-4xl font-bold tracking-tight">Tickr Guesser</h1>
          <p className="mt-2 font-mono text-sm text-muted">
            #{puzzle.number} · {shortDate(puzzle.date)}
          </p>
          <p className="mt-6 max-w-xs text-lg leading-snug">Guess the mystery stock from its chart.</p>
          <ul className="mt-4 space-y-1 font-mono text-sm text-muted">
            <li>{puzzle.maxGuesses} guesses</li>
            <li>{bank.length} household names</li>
            <li>a new stock every day</li>
          </ul>
          <button
            onClick={() => {
              setPlaying(true);
              window.scrollTo({ top: 0 });
            }}
            className="mt-8 w-full max-w-xs rounded-full bg-accent py-4 text-lg font-semibold text-accent-fg active:scale-[0.99]"
          >
            {tried.length ? "Keep playing" : "Play"}
          </button>
          {puzzle.streak > 0 && <p className="mt-4 font-mono text-sm text-muted">🔥 {puzzle.streak} day streak</p>}
        </div>
      </Shell>
    );
  }

  // Results: score and share first, then the lesson, then your stats.
  if (done && result?.reveal) {
    return (
      <Shell header={`#${puzzle.number} · ${shortDate(puzzle.date)}`}>
        <Card className="text-center">
          <Kicker>{result.solved ? "You got it" : "Not today"}</Kicker>
          <div className="mt-1 text-5xl font-bold tabular">
            {result.solved ? `${tried.length}/${puzzle.maxGuesses}` : `X/${puzzle.maxGuesses}`}
          </div>
          <div className="mt-2 whitespace-pre font-mono text-lg leading-tight tracking-wider">{grid(tried)}</div>
          <button onClick={share} className="mt-5 w-full rounded-full bg-accent py-3.5 font-semibold text-accent-fg active:scale-[0.99]">
            Share result
          </button>
          <p className="mt-3 font-mono text-xs text-muted">
            Next stock in <span className="text-fg tabular">{nextIn}</span>
          </p>
        </Card>
        <RevealCard r={result.reveal} bars={puzzle.chart} />
        {result.stats && <StatsCard s={result.stats} mine={result.solved ? tried.length - 1 : puzzle.maxGuesses} max={puzzle.maxGuesses} />}
        {toast_}
      </Shell>
    );
  }

  // Playing: chart, the guess box, the optional sector hint, then your guesses (newest first).
  return (
    <Shell header={`#${puzzle.number} · ${shortDate(puzzle.date)}`}>
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Name the mystery stock</h2>
          <div className="flex gap-1" aria-label={`${left} of ${puzzle.maxGuesses} guesses left`}>
            {Array.from({ length: puzzle.maxGuesses }, (_, i) => (
              <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < tried.length ? "bg-down" : "bg-line"}`} />
            ))}
          </div>
        </div>
        {/* The guess box sits right under the chart so it's already above the phone keyboard:
            Safari then has no reason to scroll the chart away while you type. */}
        <div className="mt-3">
          <Chart bars={puzzle.chart} compact />
        </div>
        <div className="mt-3">
          <Guesser companies={companies} bank={bank} taken={new Set(guesses)} disabled={busy} onGuess={guess} />
          {error && <p className="mt-2 text-sm text-down">{error}</p>}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0">
            <span className="text-muted">Sector:</span>{" "}
            {showSector ? <span className="font-semibold">{puzzle.sector}</span> : <span className="text-muted">hidden</span>}
          </span>
          <button
            onClick={toggleSector}
            aria-pressed={showSector}
            className="shrink-0 rounded-full border border-line px-3 py-1 font-mono text-xs active:bg-line/60"
          >
            {showSector ? "Hide" : "Show hint"}
          </button>
        </div>
        {showSector && SECTOR_MEANING[puzzle.sector] && (
          <p className="mt-1 text-xs leading-snug text-muted">{SECTOR_MEANING[puzzle.sector]}.</p>
        )}
        {tried.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-4 gap-1.5 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {CARD_ORDER.map((k) => (
                <span key={k}>{CARD_LABEL[k]}</span>
              ))}
            </div>
            <ul className="mt-2 space-y-3">
              {[...tried].reverse().map((g) => (
                <GuessRow key={g.symbol} g={g} />
              ))}
            </ul>
            <div className="mt-3 space-y-1 text-[11px] leading-snug text-muted">
              <p>🟩 match · 🟨 close · ⬜ off · arrows point to the answer</p>
              <p>
                🟨 means same sector, one size or one decade off, or same US region.{" "}
                <span className="font-mono">{BRACKETS.map((b) => `${b.label} ${b.range.replace("under ", "<")}`).join(" · ")}</span>
              </p>
            </div>
          </>
        )}
      </Card>
      {toast_}
    </Shell>
  );
}

function Shell({ children, header }: { children: React.ReactNode; header?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-3 pb-[max(4rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))]">
      {header && (
        <header className="flex items-center justify-between px-1 py-1">
          <span className="font-mono text-base font-bold tracking-tight">TICKR GUESSER</span>
          <span className="font-mono text-xs text-muted">{header}</span>
        </header>
      )}
      {children}
    </main>
  );
}
