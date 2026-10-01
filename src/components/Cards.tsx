"use client";

import { dot, ordinal, pct, pts, tone } from "@/lib/client";
import { STOCK_COLORS } from "./Picker";
import type { Leg, State } from "./types";

/** Arcade-style score box (MapTap / GeoSports): small mono label over a big mono number. */
export function ScoreBox({ ret, label = "Score" }: { ret: number | null; label?: string }) {
  return (
    <div className="flex min-w-[6.5rem] flex-col items-center justify-center rounded-xl border-2 border-score px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{label}</span>
      <span className={`font-mono text-3xl font-bold tabular ${ret == null ? "text-muted" : tone(ret)}`}>
        {ret == null ? "000" : pts(ret).replace(" pts", "")}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">pts</span>
    </div>
  );
}

/** Small uppercase mono label, used as section kickers. */
export function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`font-mono text-[11px] uppercase tracking-[0.18em] text-muted ${className}`}>{children}</p>;
}

/** 🟢 NVDA +1.20% chips, one per stock. */
export function StockChips({ legs }: { legs: Leg[] }) {
  return (
    <ul className="grid grid-cols-3 gap-2">
      {legs.map((l, i) => (
        <li key={l.symbol} className="rounded-xl border border-line px-2 py-2 text-center">
          <div className="flex items-center justify-center gap-1.5 font-semibold">
            <span className="h-2 w-2 rounded-full" style={{ background: STOCK_COLORS[i] }} />
            {l.symbol}
          </div>
          <div className={`font-mono text-sm tabular ${tone(l.ret)}`}>
            {dot(l.ret)} {pct(l.ret)}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** GeoSports-style per-item bars: one row per stock, width by size of its move, colored by sign. */
export function StockBars({ legs }: { legs: Leg[] }) {
  const biggest = Math.max(0.005, ...legs.map((l) => Math.abs(l.ret)));
  return (
    <ul className="space-y-1.5">
      {legs.map((l) => (
        <li key={l.symbol} className="relative h-8 overflow-hidden rounded-lg bg-line/60">
          <div
            className={`absolute inset-y-0 left-0 rounded-lg ${l.ret >= 0 ? "bg-up/80" : "bg-down/80"}`}
            style={{ width: `${Math.max(6, (Math.abs(l.ret) / biggest) * 100)}%` }}
          />
          <div className="relative flex h-full items-center justify-between px-3 font-mono text-sm font-semibold">
            <span>
              {dot(l.ret)} {l.symbol} <span className="font-normal opacity-80">${Math.round(l.alloc / 1000)}k</span>
            </span>
            <span className="tabular">{pct(l.ret)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Daily Tens-style stats row. */
export function StatsRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line">
      {items.map((it) => (
        <div key={it.label} className="py-2 text-center">
          <div className="font-mono text-xl font-bold tabular">{it.value}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

/** GeoSports "Where you landed": share of players per score bucket, with YOU marked. */
export function Distribution({ dist, ret, total }: { dist: NonNullable<State["dist"]>; ret: number; total: number | null }) {
  const sum = dist.reduce((a, b) => a + b.count, 0) || 1;
  const mine = dist.findIndex((b) => (b.min == null || ret >= b.min) && (b.max == null || ret < b.max));
  return (
    <div>
      <ul className="space-y-1.5">
        {dist.map((b, i) => {
          const share = Math.round((b.count / sum) * 100);
          const you = i === mine;
          return (
            <li key={b.label} className="flex items-center gap-2 font-mono text-xs">
              <span className="w-24 shrink-0 text-right text-muted tabular">{b.label}</span>
              <span className="relative h-5 flex-1 overflow-hidden rounded bg-line/60">
                <span
                  className={`absolute inset-y-0 left-0 rounded ${you ? "bg-accent" : "bg-muted/40"}`}
                  style={{ width: `${Math.max(you ? 14 : 0, share)}%` }}
                />
                {you && <span className="relative px-2 text-[10px] font-bold leading-5 text-accent-fg">YOU</span>}
              </span>
              <span className="w-9 shrink-0 text-right text-muted tabular">{share}%</span>
            </li>
          );
        })}
      </ul>
      {total != null && total > 1 && (
        <p className="mt-2 text-xs text-muted">{total.toLocaleString()} players today</p>
      )}
    </div>
  );
}

/** One-liner reaction to a finished (or live) day, MapTap / GeoSports style. */
export function verdict(p: number | null, ret: number): string {
  if (p != null) {
    if (p >= 95) return "Wall Street is taking notes.";
    if (p >= 80) return "Certified market wizard.";
    if (p >= 60) return "Beat the crowd. Smells like talent.";
    if (p >= 40) return "Solidly mid. Respectable.";
    if (p >= 20) return "The market humbled you today.";
    return "Have you considered index funds?";
  }
  if (ret > 0.01) return "Big green day.";
  if (ret > 0) return "Green is green.";
  if (ret > -0.01) return "Barely a scratch.";
  return "Rough one. Run it back tomorrow.";
}

export const percentileLabel = (p: number | null) => (p == null ? "--" : ordinal(p));
