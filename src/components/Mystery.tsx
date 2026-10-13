"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, clock, loadIdentity, pct, saveIdentity, shareText, tone, type Identity } from "@/lib/client";
import { SECTOR_MEANING } from "@/lib/brackets";
import type { Bar, BoardItem, GuessResult, Mark, Reveal } from "@/lib/mystery";

type Puzzle = {
  date: string;
  number: number;
  maxGuesses: number;
  chart: Bar[];
  sector: string;
  /** The starting board: up to 25 companies, one of them the answer. Tiles keep their spot all game. */
  board: BoardItem[];
  hasHints: boolean;
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
type Result = {
  guesses: GuessResult[];
  hints: string[];
  /** The companies still in play (null once the game is over). */
  board: BoardItem[] | null;
  done: boolean;
  solved: boolean;
  reveal: Reveal | null;
  stats: Stats | null;
};

// Bump the version to make every device forget its saved guesses (e.g. after clearing plays from the database).
const saved = (date: string) => `tickr.v3.${date}`;
const DEVICE = "tickr.device";

/** A random id for this browser, so the funnel can count opens and starts before a player exists. */
function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE);
    if (!d) {
      d = crypto.randomUUID();
      localStorage.setItem(DEVICE, d);
    }
    return d;
  } catch {
    return crypto.randomUUID();
  }
}

/** Fire-and-forget funnel event (open / start / finish). The server ignores practice days and repeats. */
function track(kind: "open" | "play" | "start" | "finish", date: string, me: Identity | null) {
  api("/api/mystery/event", { method: "POST", body: { date, device: deviceId(), kind }, me }).catch(() => {});
}

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

/** The cards in plain words, so a miss tells you which way to go: "Right sector, different industry · bigger company · ..." */
function readCards(g: GuessResult): string {
  const c = g.cards;
  const industry = c.industry.mark === "match" ? "Same industry" : c.industry.mark === "close" ? "Right sector, different industry" : "Different sector";
  const size = c.size.mark === "match" ? "same size" : c.size.dir === "up" ? "bigger company" : "smaller company";
  const founded = c.founded.mark === "match" ? "same decade" : c.founded.dir === "up" ? "founded later" : "founded earlier";
  const hq = c.hq.mark === "match" ? "same state" : c.hq.mark === "close" ? "same region" : "different region";
  return `${industry} · ${size} · ${founded} · ${hq}`;
}

/** One guess: name, the four cards (flipping in one at a time when it's the guess you just made), and what they mean. */
function GuessRow({ g, fresh }: { g: GuessResult; fresh: boolean }) {
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
        {CARD_ORDER.map((k, i) => (
          <div
            key={k}
            className={`flex min-h-12 items-center justify-center rounded-lg px-1 py-1.5 text-center ${TILE[g.cards[k].mark]} ${fresh ? "tile-flip" : ""}`}
            style={fresh ? { animationDelay: `${i * 150}ms` } : undefined}
          >
            <span className="line-clamp-2 text-[11px] font-semibold leading-tight [overflow-wrap:anywhere]">
              {g.cards[k].value}
              {arrow(g.cards[k].dir)}
            </span>
          </div>
        ))}
      </div>
      {!g.correct && (
        <p className={`mt-1.5 text-xs leading-snug text-muted ${fresh ? "fade-in" : ""}`} style={fresh ? { animationDelay: "600ms" } : undefined}>
          {readCards(g)}
        </p>
      )}
    </li>
  );
}

/** A burst of confetti for a solve: a normal amount, or a gold storm for a first-try solve. Skipped for people who turn off motion. */
function Confetti({ big = false }: { big?: boolean }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: big ? 150 : 48 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * (big ? 1.2 : 0.4),
        dur: (big ? 2.2 : 1.6) + Math.random() * 1.4,
        drift: (Math.random() - 0.5) * (big ? 260 : 160),
        spin: (Math.random() - 0.5) * 900,
        size: big && i % 3 === 0 ? "h-3.5 w-2" : "h-2.5 w-1.5",
        color: (big ? ["#fbbf24", "#f59e0b", "#fde68a", "var(--up)", "#fbbf24"] : ["var(--up)", "var(--accent)", "#fbbf24", "var(--s3)"])[
          i % (big ? 5 : 4)
        ],
      })),
    [big],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden motion-reduce:hidden" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`confetti absolute top-0 rounded-sm ${p.size}`}
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * What a first-try solve is called. One per puzzle day (picked from the date), so a refresh shows the same line and
 * everyone who gets it first try that day is talking about the same thing. Which one you'll get is part of the fun.
 */
const ACE_LINES = [
  { emoji: "🕵️", title: "Insider trading?", sub: "First try. We're not asking questions." },
  { emoji: "📈", title: "Bought the bottom", sub: "Perfect timing, first try." },
  { emoji: "🎯", title: "Called it", sub: "First try. No hints needed." },
  { emoji: "🧓", title: "Warren would be proud", sub: "First try. Pure fundamentals." },
];
const aceLine = (date: string) => ACE_LINES[[...date].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7) % ACE_LINES.length];

/** The big moment for getting it on the first try: a gold flash, then the day's line pops in big over a soft backdrop and fades. */
function FirstTry({ line }: { line: (typeof ACE_LINES)[number] }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center px-6" aria-live="polite">
      <div className="ace-flash absolute inset-0" />
      <div className="ace-pop relative rounded-3xl bg-bg/85 px-6 py-6 text-center shadow-2xl backdrop-blur-sm">
        <div className="text-6xl">{line.emoji}</div>
        <div className="mt-2 text-4xl font-black uppercase leading-[1.05] tracking-tight text-amber-500 sm:text-5xl">{line.title}</div>
        <div className="mt-2 text-base font-semibold text-fg">{line.sub}</div>
      </div>
    </div>
  );
}

/** The year in one line: what $1,000 in this stock became, next to the same $1,000 in the S&P 500. */
function Punchline({ r }: { r: Reveal }) {
  if (r.yearChange == null) return null;
  const mkt = r.market.length > 1 ? r.market.at(-1)!.c / r.market[0].c - 1 : null;
  const dollars = (x: number) => `$${Math.round(1000 * (1 + x)).toLocaleString("en-US")}`;
  // "The Coca-Cola Company" reads better as "Coca-Cola" mid-sentence.
  const short = r.name.replace(/^The /, "").replace(/,? (Inc\.|Company|Corporation|Corp\.)$/, "");
  return (
    <p className="mt-4 rounded-xl bg-line/40 px-3 py-2.5 text-sm leading-snug">
      $1,000 in {short} a year ago is worth{" "}
      <span className={`font-mono font-bold tabular ${tone(r.yearChange)}`}>{dollars(r.yearChange)}</span> today.
      {mkt != null && (
        <>
          {" "}
          In the S&amp;P 500 it&apos;d be <span className={`font-mono font-bold tabular ${tone(mkt)}`}>{dollars(mkt)}</span>.
        </>
      )}
    </p>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-4 sm:p-5 ${className}`}>{children}</section>;
}

function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  // Muted unless a color is passed in (two text colors on one element would fight, and the default would win).
  const colored = /\btext-(?!\[)/.test(className);
  return <p className={`font-mono text-[11px] uppercase tracking-[0.18em] ${colored ? "" : "text-muted"} ${className}`}>{children}</p>;
}

/** 1-year price chart. Unlabeled during play; the reveal passes the company name. */
function Chart({ bars }: { bars: Bar[] }) {
  if (bars.length < 2) return <div className="h-44 rounded-xl bg-line/40" />;
  const W = 320, H = 150, P = 4;
  const closes = bars.map((b) => b.c);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const x = (i: number) => P + (i / (bars.length - 1)) * (W - 2 * P);
  const y = (c: number) => P + (1 - (c - lo) / (hi - lo || 1)) * (H - 2 * P);
  const line = bars.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(b.c).toFixed(1)}`).join("");
  const up = closes.at(-1)! >= closes[0];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px] text-muted tabular sm:text-sm">
        <span>
          {month(bars[0].t)} · {usd(closes[0])}
        </span>
        <span className={up ? "text-up" : "text-down"}>{pct(closes.at(-1)! / closes[0] - 1, 1)} in a year</span>
        <span>
          {month(bars.at(-1)!.t)} · {usd(closes.at(-1)!)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-44 w-full sm:h-52" preserveAspectRatio="none" role="img" aria-label="One-year stock chart">
        <path d={line} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
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

/** "Automatic Data Processing" fits on a tile; "The Coca-Cola Company" becomes "Coca-Cola". */
function shortName(name: string): string {
  let n = name.replace(/^The /, "");
  for (let i = 0; i < 2; i++)
    n = n.replace(/,? (Inc\.?|Incorporated|Corporation|Corp\.|Company|Companies|Holdings|Group|plc|Ltd\.|& Co\.|Co\.)$/, "");
  return n;
}

const BOARD_SLOTS = 25;

/**
 * The board: a 5x5 grid, one of the tiles the answer. Every company keeps its spot all game. Tap a tile to pick it.
 * After a miss, the knocked-out tiles flip face down (like Guess Who) and the count pops, which is the payoff for every
 * guess. Your wrong guesses stay red. Sectors with fewer than 25 companies start with a few tiles already down.
 */
function Board({ start, live, guessed, justOut, knocked, first, selected, onSelect, disabled, answer }: { start: BoardItem[]; live: Set<string>; guessed: Set<string>; justOut: Set<string>; knocked: number; first: boolean; selected: string | null; onSelect: (sym: string | null) => void; disabled: boolean; /** Results screen: the answer's tile, shown green. */ answer?: string }) {
  const slots: (BoardItem | null)[] = [...start, ...Array<null>(Math.max(0, BOARD_SLOTS - start.length)).fill(null)];
  // Down to the last two: they pulse, and it's a coin flip you earned.
  const finalTwo = !answer && !first && live.size === 2;
  // Knocked-out tiles flip one after another, in reading order.
  const flipOrder = new Map(start.filter((c) => justOut.has(c.symbol)).map((c, i) => [c.symbol, i]));
  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between">
        <Kicker className={finalTwo ? "font-bold text-accent" : ""}>
          {answer ? "Your board" : first ? `It's one of these ${live.size}` : finalTwo ? "Final two" : `Still in play · ${live.size}`}
        </Kicker>
        {knocked > 0 && (
          <span key={live.size} className="knock-pop font-mono text-sm font-bold text-down">
            −{knocked}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {slots.map((c, i) => {
          if (!c) return <div key={`empty-${i}`} className="aspect-square rounded-xl bg-line/40" aria-hidden="true" />;
          const isLive = live.has(c.symbol), wrong = guessed.has(c.symbol), on = selected === c.symbol;
          const isAnswer = answer === c.symbol;
          const look = isAnswer
            ? "border-up bg-up text-white shadow-md"
            : wrong
            ? "border-down/40 bg-down/15 text-down"
            : !isLive
              ? "border-transparent bg-line/50 text-muted opacity-40"
              : on
                ? "border-accent bg-accent text-accent-fg shadow-md"
                : "border-line bg-card active:bg-line/60";
          return (
            <button
              key={c.symbol}
              onClick={() => onSelect(on ? null : c.symbol)}
              disabled={disabled || !isLive || !!answer}
              aria-pressed={on}
              aria-label={`${c.name}${isLive ? "" : ", ruled out"}`}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border px-0.5 text-center transition-colors disabled:cursor-default ${look} ${flipOrder.has(c.symbol) ? "tile-down" : ""} ${finalTwo && isLive && !on ? "final-pulse" : ""}`}
              style={flipOrder.has(c.symbol) ? { animationDelay: `${flipOrder.get(c.symbol)! * 45}ms` } : undefined}
            >
              <span className={`font-mono text-[13px] font-bold leading-none sm:text-sm ${!isLive && !wrong && !isAnswer ? "line-through" : ""}`}>
                {c.symbol}
              </span>
              {/* Skip the name when it's just the ticker again ("APA", "EQT"). */}
              {norm(shortName(c.name)) !== c.symbol.toLowerCase() && (
                <span className={`mt-1 line-clamp-2 text-[9px] leading-[1.15] sm:text-[10px] ${on || isAnswer ? "opacity-90" : "opacity-70"}`}>
                  {shortName(c.name)}
                </span>
              )}
              {wrong && <span className="absolute right-1 top-0.5 text-[10px] font-bold">✗</span>}
              {isAnswer && <span className="absolute right-1 top-0.5 text-[10px] font-bold">✓</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Lowercase, accents and punctuation stripped: "The Estée Lauder Companies" -> "the estee lauder companies". */
const norm = (x: string) =>
  x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** What people actually call some companies, when it isn't in the official name. */
const ALIASES: Record<string, string> = {
  google: "GOOGL",
  youtube: "GOOGL",
  facebook: "META",
  instagram: "META",
  whatsapp: "META",
  coke: "KO",
  chase: "JPM",
  "jp morgan": "JPM",
  amex: "AXP",
  "bank of america": "BAC",
  bofa: "BAC",
  "olive garden": "DRI",
  ticketmaster: "LYV",
};

function Guesser({ companies, taken, disabled, onGuess, q, setQ, input, ruledOut }: { companies: [string, string][]; taken: Set<string>; disabled: boolean; onGuess: (s: string) => void; q: string; setQ: (q: string) => void; input: React.RefObject<HTMLInputElement | null>; ruledOut: (sym: string) => boolean }) {
  // A company that isn't on the board gets one "are you sure?" first, since the answer is always on the board.
  const [warned, setWarned] = useState<string | null>(null);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const qn = norm(s), qWords = qn.split(" "), qFlat = qn.replace(/ /g, "");
    const alias = ALIASES[qn];
    const scored = companies
      .filter(([sym]) => !taken.has(sym))
      .map(([sym, name]) => {
        const n = name.toLowerCase(), nn = norm(name).replace(/^the /, ""), words = nn.split(" ");
        // Forgiving about punctuation and word order, so "eli lilly" finds "Lilly (Eli)" and "coca cola" finds "Coca-Cola".
        const loose = nn.replace(/ /g, "").includes(qFlat) || qWords.every((w) => words.some((x) => x.startsWith(w)));
        const score =
          sym.toLowerCase() === s || n === s || nn === qn || alias === sym ? 0
          : nn.startsWith(qn) ? 1
          : sym.toLowerCase().startsWith(s) ? 2
          : loose ? 3
          : -1;
        return { sym, name, score };
      })
      .filter((m) => m.score >= 0);
    return scored.sort((a, b) => a.score - b.score).slice(0, 8);
  }, [q, companies, taken]);

  // Picking a suggestion only fills the box. Nothing is guessed until you press Guess, which takes an exact match,
  // or else the top suggestion for what you've typed (so "nike" + Guess just works).
  const exact = matches.find((m) => m.score === 0);
  const chosen = exact ?? (q.trim().length >= 2 ? matches[0] : undefined);
  const filled = !!exact && q.trim().toLowerCase() === exact.name.toLowerCase();
  const warning = chosen && warned === chosen.sym ? chosen : null;

  function fill(name: string) {
    setQ(name);
    input.current?.focus({ preventScroll: true });
  }

  function submit(confirmed = false) {
    if (!chosen) return;
    if (!confirmed && warned !== chosen.sym && ruledOut(chosen.sym)) {
      setWarned(chosen.sym);
      setQ(chosen.name); // spell out which company, and close the suggestions so they don't cover the warning
      return;
    }
    setWarned(null);
    setQ("");
    onGuess(chosen.sym);
    input.current?.focus({ preventScroll: true });
  }

  return (
    <div>
      <div className="relative flex gap-2">
        <div className="min-w-0 flex-1">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && matches[0] && !filled && fill(matches[0].name)}
            disabled={disabled}
            type="search"
            inputMode="search"
            name="tickr-guess"
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Stock name or ticker"
            className="w-full rounded-xl border border-line bg-bg px-4 py-3 text-base outline-none focus:border-accent disabled:opacity-50"
          />
          {matches.length > 0 && !filled && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-card shadow-lg">
              {matches.map((m) => (
                <li key={m.sym}>
                  <button onClick={() => fill(m.name)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left active:bg-line/60">
                    <span className="truncate">{m.name}</span>
                    <span className="font-mono text-xs text-muted">{m.sym}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={() => submit()}
          disabled={disabled || !chosen}
          className="shrink-0 rounded-xl border border-accent bg-accent px-5 font-semibold text-accent-fg active:scale-[0.98] disabled:border-line disabled:bg-bg disabled:text-muted"
        >
          Guess
        </button>
      </div>
      {warning && (
        <div className="fade-in mt-2 flex items-center justify-between gap-3 rounded-xl bg-amber-400/15 px-3 py-2 text-sm">
          <span className="leading-snug">{warning.name.replace(/\.$/, "")} isn&apos;t on the board, and the answer always is.</span>
          <button onClick={() => submit(true)} className="shrink-0 font-semibold text-accent active:opacity-70">
            Guess anyway
          </button>
        </div>
      )}
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

export function Mystery({ companies }: { companies: [string, string][] }) {
  const [me, setMe] = useState<Identity | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [q, setQ] = useState("");
  // The tile picked on the board, the tiles your last miss flipped down (they animate), and how many.
  const [selected, setSelected] = useState<string | null>(null);
  const [justOut, setJustOut] = useState<Set<string>>(new Set());
  const [knocked, setKnocked] = useState(0);
  // Typing a company is a fallback, tucked behind a link: the board is how you play.
  const [typing, setTyping] = useState(false);
  // The guess you just made (its cards flip in), and whether to throw confetti for a solve.
  const [fresh, setFresh] = useState<string | null>(null);
  // "win" for a solve, "ace" for a first-try solve, which gets the big celebration.
  const [celebrate, setCelebrate] = useState<null | "win" | "ace">(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = loadIdentity();
    setMe(id);
    (async () => {
      try {
        const day = new URLSearchParams(location.search).get("day"); // local testing only; ignored in production
        const p = await api<Puzzle>(`/api/mystery${day ? `?day=${encodeURIComponent(day)}` : ""}`, { me: id });
        setPuzzle(p);
        track("open", p.date, id);
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
      // Tiles this miss knocks out flip face down; the count of them pops next to the board.
      const before = result?.board ?? puzzle.board;
      const kept = new Set((r.board ?? []).map((b) => b.symbol));
      const gone = r.done ? [] : before.filter((b) => !kept.has(b.symbol)).map((b) => b.symbol);
      setJustOut(new Set(gone));
      setKnocked(gone.length);
      setSelected(null);
      setGuesses(next);
      storeGuesses(puzzle.date, next);
      setResult(r);
      setFresh(symbol);
      if (next.length === 1) track("start", puzzle.date, id);
      if (r.done) {
        track("finish", puzzle.date, id);
        window.scrollTo({ top: 0 });
      }
      if (r.solved) {
        const ace = next.length === 1;
        setCelebrate(ace ? "ace" : "win");
        setTimeout(() => setCelebrate(null), ace ? 4500 : 3500);
        // A little buzz on phones that allow it (Android; iPhones ignore this).
        navigator.vibrate?.(ace ? [40, 60, 40, 60, 220] : 60);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!puzzle || !result) return;
    const score = result.solved ? `${result.guesses.length}/${puzzle.maxGuesses}` : `X/${puzzle.maxGuesses}`;
    const first = aceLine(puzzle.date);
    const ace = result.solved && result.guesses.length === 1 ? ` ${first.emoji} ${first.title}` : "";
    const r = await shareText(`Tickr Guesser #${puzzle.number} · ${score}${ace}\n${grid(result.guesses)}`, location.origin);
    if (r === "copied") flash("Copied. Paste it in the group chat.");
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
  const board = result?.board ?? puzzle.board;
  const onBoard = new Set(board.map((b) => b.symbol));
  const pick = board.find((b) => b.symbol === selected) ?? null;
  const nextIn = clock(msToNextPuzzle(now));
  const toast_ = toast && (
    <div className="fixed inset-x-0 bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))] z-20 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-fg px-4 py-2 text-center text-sm text-bg shadow-lg">
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
          {puzzle.streak > 0 && (
            <div className="mt-6 rounded-2xl border border-line bg-card px-5 py-3">
              <div className="text-2xl font-bold">🔥 {puzzle.streak}-day streak</div>
              <p className="mt-0.5 text-sm text-muted">Solve today&apos;s to make it {puzzle.streak + 1}</p>
            </div>
          )}
          <p className="mt-6 max-w-xs text-lg leading-snug">Guess the mystery stock from its chart.</p>
          <ul className="mt-4 space-y-1 font-mono text-sm text-muted">
            <li>{puzzle.maxGuesses} guesses</li>
            <li>any company in the S&amp;P 500</li>
            <li>a new stock every day</li>
          </ul>
          <button
            onClick={() => {
              setPlaying(true);
              track("play", puzzle.date, me);
              window.scrollTo({ top: 0 });
            }}
            className="mt-8 w-full max-w-xs rounded-full bg-accent py-4 text-lg font-semibold text-accent-fg active:scale-[0.99]"
          >
            {tried.length ? "Keep playing" : "Play"}
          </button>
        </div>
      </Shell>
    );
  }

  // Results: score and share first, then the lesson, then your stats.
  if (done && result?.reveal) {
    return (
      <Shell header={`#${puzzle.number} · ${shortDate(puzzle.date)}`}>
        <Card className="text-center">
          <Kicker className={result.solved && tried.length === 1 ? "font-bold text-amber-500" : ""}>
            {result.solved ? (tried.length === 1 ? `${aceLine(puzzle.date).emoji} ${aceLine(puzzle.date).title}` : "You got it") : "Not today"}
          </Kicker>
          <div className="mt-1 text-5xl font-bold tabular">
            {result.solved ? `${tried.length}/${puzzle.maxGuesses}` : `X/${puzzle.maxGuesses}`}
          </div>
          <div className="mt-2 whitespace-pre font-mono text-lg leading-tight tracking-wider">{grid(tried)}</div>
          <Punchline r={result.reveal} />
          <button onClick={share} className="mt-5 w-full rounded-full bg-accent py-3.5 font-semibold text-accent-fg active:scale-[0.99]">
            Share result
          </button>
          {result.stats && (
            <p className="mt-4 font-semibold">
              {result.solved && result.stats.streak > 0
                ? `🔥 ${result.stats.streak}-day streak. Come back tomorrow to make it ${result.stats.streak + 1}.`
                : "Come back tomorrow and start a streak."}
            </p>
          )}
          <p className="mt-1 font-mono text-xs text-muted">
            Next stock in <span className="text-fg tabular">{nextIn}</span>
          </p>
        </Card>
        {celebrate && <Confetti big={celebrate === "ace"} />}
        {celebrate === "ace" && <FirstTry line={aceLine(puzzle.date)} />}
        {/* Your board in its final state: the answer in green, your misses in red. A picture of how you got there. */}
        <Card>
          <Board
            start={puzzle.board}
            live={new Set()}
            guessed={new Set(tried.filter((g) => !g.correct).map((g) => g.symbol))}
            justOut={new Set()}
            knocked={0}
            first={false}
            selected={null}
            onSelect={() => {}}
            disabled
            answer={result.reveal.symbol}
          />
        </Card>
        <RevealCard r={result.reveal} bars={puzzle.chart} />
        {result.stats && <StatsCard s={result.stats} mine={result.solved ? tried.length - 1 : puzzle.maxGuesses} max={puzzle.maxGuesses} />}
        {toast_}
      </Shell>
    );
  }

  // Playing: chart and sector, the latest hint, the board (tap a company, then the Guess button at the bottom),
  // then your guesses with their cards, newest first.
  const latest = result?.hints.length ? result.hints.length - 1 : -1;
  return (
    <Shell header={`#${puzzle.number} · ${shortDate(puzzle.date)}`}>
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold sm:text-xl">Name the mystery stock</h2>
          <div className="flex gap-1.5" aria-label={`${left} of ${puzzle.maxGuesses} guesses left`}>
            {Array.from({ length: puzzle.maxGuesses }, (_, i) => (
              <span key={i} className={`h-3 w-3 rounded-full ${i < tried.length ? "bg-down" : "bg-line"}`} />
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm leading-snug">
          <span className="font-semibold text-accent">{puzzle.sector}</span>
          {SECTOR_MEANING[puzzle.sector] && <span className="text-muted">: {SECTOR_MEANING[puzzle.sector]}</span>}
        </p>
        <div className="mt-3">
          <Chart bars={puzzle.chart} />
        </div>

        {/* Hints for everyone: the newest one big, the earlier ones small underneath. One more after every miss. */}
        {latest >= 0 && result && (
          <div key={latest} className="fade-in mt-4 rounded-2xl bg-accent/10 px-4 py-3">
            <Kicker>Hint {latest + 1}</Kicker>
            <p className="mt-1 text-base font-medium leading-snug">{result.hints[latest]}</p>
            {latest > 0 && (
              <ul className="mt-2 space-y-1 border-t border-accent/20 pt-2 text-sm leading-snug text-muted">
                {result.hints
                  .slice(0, latest)
                  .map((h, i) => ({ h, i }))
                  .reverse()
                  .map(({ h, i }) => (
                    <li key={i}>
                      <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wider">Hint {i + 1}</span>
                      {h}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        <Board
          start={puzzle.board}
          live={onBoard}
          guessed={new Set(tried.filter((g) => !g.correct).map((g) => g.symbol))}
          justOut={justOut}
          knocked={knocked}
          first={tried.length === 0}
          selected={selected}
          onSelect={setSelected}
          disabled={busy}
        />
        {error && <p className="mt-2 text-sm text-down">{error}</p>}

        <button onClick={() => setTyping(!typing)} className="mt-3 text-xs text-muted underline-offset-2 active:text-fg">
          {typing ? "Hide" : "Have a different company in mind? Type it"}
        </button>
        {typing && (
          <div className="mt-2">
            <Guesser
              companies={companies}
              taken={new Set(guesses)}
              disabled={busy}
              onGuess={guess}
              q={q}
              setQ={setQ}
              input={input}
              ruledOut={(sym) => !onBoard.has(sym)}
            />
          </div>
        )}

        {tried.length > 0 && (
          <section className="mt-5">
            <Kicker>Your guesses</Kicker>
            <div className="mt-2 grid grid-cols-4 gap-1.5 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {CARD_ORDER.map((k) => (
                <span key={k}>{CARD_LABEL[k]}</span>
              ))}
            </div>
            <ul className="mt-2 space-y-3">
              {[...tried].reverse().map((g) => (
                <GuessRow key={g.symbol} g={g} fresh={g.symbol === fresh} />
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-snug text-muted">🟩 match · 🟨 close · ⬜ off · arrows point to the answer</p>
          </section>
        )}
      </Card>

      {/* Room for the Guess button, which stays pinned to the bottom of the screen. */}
      <div className="h-20" />
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/90 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto max-w-lg px-4">
          <button
            onClick={() => pick && guess(pick.symbol)}
            disabled={!pick || busy}
            className="w-full truncate rounded-full bg-accent py-3.5 text-lg font-semibold text-accent-fg active:scale-[0.99] disabled:bg-line disabled:text-muted"
          >
            {busy ? "Checking..." : pick ? `Guess ${pick.name}` : "Tap a company to guess"}
          </button>
        </div>
      </div>
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
