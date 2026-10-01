"use client";

import { useMemo, useRef, useState } from "react";
import { etClock, money } from "@/lib/client";

type Point = { t: string; v: number };

const W = 600;
const H = 180;
const PAD_Y = 10;

/** Intraday portfolio line. X spans the full session so progress through the day is visible. */
export function Chart({ series, start, end, baseline }: { series: Point[]; start: string; end: string; baseline: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);

  const { path, area, x, y, last } = useMemo(() => {
    const t0 = Date.parse(start);
    const t1 = Math.max(Date.parse(end), t0 + 60_000);
    const vs = series.map((p) => p.v).concat(baseline);
    const span = Math.max(Math.max(...vs) - Math.min(...vs), baseline * 0.002);
    const lo = Math.min(...vs) - span * 0.1;
    const hi = Math.max(...vs) + span * 0.1;
    const x = (t: string) => ((Date.parse(t) - t0) / (t1 - t0)) * W;
    const y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD_Y);
    const path = series.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const area = series.length
      ? `${path}L${x(series[series.length - 1].t).toFixed(1)},${H}L${x(series[0].t).toFixed(1)},${H}Z`
      : "";
    return { path, area, x, y, last: series[series.length - 1] };
  }, [series, start, end, baseline]);

  const up = !last || last.v >= baseline;
  const color = up ? "var(--up)" : "var(--down)";

  function onMove(e: React.PointerEvent) {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !series.length) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = series[0];
    for (const p of series) if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
    setHover(best);
  }

  const shown = hover ?? last;

  return (
    <div className="relative">
      <div className="mb-1 flex h-5 items-baseline justify-between text-xs text-muted tabular">
        <span>{shown ? `${money(shown.v)} at ${etClock(shown.t)} ET` : "Waiting for the opening bell"}</span>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-44 w-full touch-none select-none"
        preserveAspectRatio="none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="Portfolio value through the trading day"
      >
        <defs>
          <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={y(baseline)} y2={y(baseline)} stroke="var(--line)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        {area && <path d={area} fill="url(#fill)" />}
        {path && <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {hover && (
          <line x1={x(hover.t)} x2={x(hover.t)} y1="0" y2={H} stroke="var(--muted)" strokeOpacity="0.5" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted tabular">
        <span>{etClock(start)}</span>
        <span>{etClock(end)} ET</span>
      </div>
    </div>
  );
}
