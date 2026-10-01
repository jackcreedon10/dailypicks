"use client";

import { money, ordinal, pct, percentile, price, pts, tone } from "@/lib/client";
import { Chart } from "./Chart";
import { SplitBar, STOCK_COLORS } from "./Picker";
import type { Entry, GameInfo } from "./types";

export function Portfolio({ entry, game }: { entry: Entry; game: GameInfo }) {
  const settled = entry.status === "settled";
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">{settled ? "Final value" : "Portfolio value"}</div>
          <div className="text-2xl font-bold tabular sm:text-3xl">{money(entry.value)}</div>
        </div>
        <div className="ml-auto text-right">
          <div className={`whitespace-nowrap text-2xl font-bold tabular ${tone(entry.ret)}`}>{pts(entry.ret)}</div>
        </div>
      </div>


      <Standing entry={entry} />

      <div className="mt-4">
        <Chart series={entry.series} start={entry.enteredAt ?? game.openAt} end={game.closeAt} baseline={100_000} />
      </div>

      <SplitBar symbols={entry.symbols} allocs={entry.allocs} className="mt-4 h-2" />
      <ul className="mt-2 divide-y divide-line">
        {entry.legs.map((l, i) => (
          <li key={l.symbol} className="flex items-center justify-between py-2.5">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: STOCK_COLORS[i] }} />
                {l.symbol}
              </div>
              <div className="text-xs text-muted tabular">
                {money(l.alloc).replace(".00", "")} in{l.base ? `, ${price(l.base)} -> ${price(l.price)}` : ", waiting for the open"}
              </div>
            </div>
            <div className="text-right tabular">
              <div className={`font-semibold ${tone(l.ret)}`}>{pct(l.ret)}</div>
              <div className="text-xs text-muted">{money(l.alloc * (1 + l.ret))}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where you stand against everyone who locked in picks today. Refreshes every 30s while live. */
function Standing({ entry }: { entry: Entry }) {
  const settled = entry.status === "settled";
  const p = percentile(entry.beaten, entry.fieldSize);
  const others = (entry.fieldSize ?? 1) - 1;
  if (p == null) {
    return (
      <div className="mt-4 rounded-xl bg-bg px-4 py-3 text-sm text-muted">
        {entry.fieldSize === 1
          ? "You're the only player so far today. Share your picks to get some competition."
          : "Your percentile shows up once prices start moving."}
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl bg-bg px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-muted">{settled ? "Final percentile" : "Your percentile"}</span>
        {!settled && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" /> live
          </span>
        )}
      </div>
      <div className="mt-0.5 text-2xl font-bold tabular">{ordinal(p)}</div>
      <div className="relative mt-2 h-2 rounded-full bg-line" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${p}%` }} />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-accent shadow"
          style={{ left: `${p}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-muted tabular">
        Better than {p}% of the {others.toLocaleString()} other {others === 1 ? "player" : "players"} {settled ? "that day" : "today"}
      </p>
    </div>
  );
}
