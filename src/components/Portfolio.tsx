"use client";

import { money, pct, price, pts, tone, topPct } from "@/lib/client";
import { Chart } from "./Chart";
import { SplitBar, STOCK_COLORS } from "./Picker";
import type { Entry, GameInfo } from "./types";

export function Portfolio({ entry, game }: { entry: Entry; game: GameInfo }) {
  const settled = entry.status === "settled";
  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">{settled ? "Final value" : "Portfolio value"}</div>
          <div className="text-3xl font-bold tabular">{money(entry.value)}</div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold tabular ${tone(entry.ret)}`}>{pts(entry.ret)}</div>
          {topPct(entry.rank, entry.fieldSize) && (
            <div className="text-xs text-muted tabular">
              <span className="font-semibold text-fg">{topPct(entry.rank, entry.fieldSize)}</span> globally, #
              {entry.rank!.toLocaleString()} of {entry.fieldSize!.toLocaleString()}
            </div>
          )}
        </div>
      </div>


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
                <span className="text-xs font-normal text-muted tabular">{money(l.alloc).replace(".00", "")} invested</span>
              </div>
              <div className="text-xs text-muted tabular">
                {l.base ? `${price(l.base)} -> ${price(l.price)}` : "Waiting for the open"}
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
