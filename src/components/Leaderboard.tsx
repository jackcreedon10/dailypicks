"use client";

import { useEffect, useState } from "react";
import { api, points, pts, tone, topPct, type Identity } from "@/lib/client";
import type { BoardRow } from "./types";

type Tab = { key: string; label: string; group?: string };

export function Crown({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z" />
    </svg>
  );
}

function winnerText(winners: BoardRow[], groupName: string, myId: string | undefined): string {
  if (winners.some((w) => w.playerId === myId)) return winners.length > 1 ? `You tied for the win in ${groupName}` : `You won ${groupName}`;
  const names = winners.map((w) => w.nickname);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)} tied for the win` : `${names[0]} won ${groupName}`;
}

function rivalry(rows: BoardRow[], myId: string | undefined): string | null {
  const i = rows.findIndex((r) => r.playerId === myId);
  if (i < 0 || rows.length < 2) return null;
  const me = rows[i];
  const above = i > 0 ? rows[i - 1] : null;
  const below = rows[i + 1] ?? null;
  const gap = (a: number, b: number) => `${(points(a) - points(b)).toLocaleString("en-US")} pts`;
  if (above) return `${above.nickname} is beating you by ${gap(above.ret, me.ret)}`;
  if (below) return `You're beating ${below.nickname} by ${gap(me.ret, below.ret)}`;
  return null;
}

export function Leaderboard({
  me,
  groups,
  refreshKey,
  live,
}: {
  me: Identity | null;
  groups: { code: string; name: string }[];
  refreshKey: number;
  live: boolean;
}) {
  const tabs: Tab[] = [...groups.map((g) => ({ key: g.code, label: g.name, group: g.code })), { key: "global", label: "Global" }];
  const [active, setActive] = useState(tabs[0].key);
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tab = tabs.find((t) => t.key === active) ?? tabs[0];

  useEffect(() => {
    let cancelled = false;
    api<{ rows: BoardRow[]; status: string }>(`/api/leaderboard${tab.group ? `?group=${tab.group}` : ""}`, { me })
      .then((r) => !cancelled && (setRows(r.rows), setSettled(r.status === "settled"), setError(null)))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [tab.group, me, refreshKey]);

  // A friend group with 2+ players gets a winner once the day settles.
  const winners = settled && tab.group && rows && rows.length > 1 ? rows.filter((r) => r.rank === 1) : [];
  const callout = !winners.length && rows && rivalry(rows, me?.id);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{live ? "Live leaderboard" : "Leaderboard"}</h2>
        {live && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-up" /> updating
          </span>
        )}
      </div>

      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              t.key === tab.key ? "bg-fg text-bg" : "border border-line text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {winners.length > 0 && (
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-amber-400/15 px-3 py-3">
          <Crown className="h-7 w-7 shrink-0 text-amber-500" />
          <div>
            <p className="font-semibold">{winnerText(winners, tab.label, me?.id)}</p>
            <p className="text-sm text-muted">
              {pts(winners[0].ret)} at the close. Next game starts at the opening bell.
            </p>
          </div>
        </div>
      )}

      {callout && <p className="mt-3 rounded-lg bg-bg px-3 py-2 text-sm font-medium">{callout}</p>}

      {error && <p className="mt-3 text-sm text-down">{error}</p>}
      {rows && rows.length === 0 && <p className="mt-4 text-sm text-muted">Nobody on this board yet today.</p>}

      {rows && rows.length > 0 && (
        <ol className="mt-3 divide-y divide-line">
          {rows.map((r, i) => {
            const gapBefore = i > 0 && r.rank > rows[i - 1].rank + 1;
            const mine = r.playerId === me?.id;
            return (
              <li key={r.playerId} className={gapBefore ? "border-t-4 border-double" : ""}>
                <div className={`flex items-center gap-3 py-2.5 ${mine ? "-mx-2 rounded-lg bg-accent/10 px-2" : ""}`}>
                  <span className="w-8 text-right text-sm text-muted tabular">{r.rank}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {r.nickname}
                      {winners.some((w) => w.playerId === r.playerId) && (
                        <Crown className="ml-1 inline h-4 w-4 -translate-y-px text-amber-500" />
                      )}
                      {mine && <span className="text-muted"> (you)</span>}
                    </div>
                    <div className="text-xs text-muted tabular">
                      {r.symbols.map((s, k) => `${s} ${Math.round((r.allocs[k] / 100_000) * 100)}%`).join(" / ")}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold tabular ${tone(r.ret)}`}>{pts(r.ret)}</div>
                    {topPct(r.globalRank, r.globalField) && (
                      <div className="text-[11px] text-muted tabular">{topPct(r.globalRank, r.globalField)}</div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {rows && rows[0] && tab.key === "global" && (
        <p className="mt-2 text-xs text-muted">{rows[0].fieldSize.toLocaleString()} players {settled ? "in this game" : "today"}</p>
      )}
    </div>
  );
}
