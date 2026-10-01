"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, clock, dayLabel, dot, etClock, loadIdentity, ordinal, pct, percentile, pts, saveIdentity, shareText, tone, type Identity } from "@/lib/client";
import { Distribution, Kicker, ScoreBox, StatsRow, StockBars, StockChips, percentileLabel, verdict } from "./Cards";
import { Picker, SplitBar, STOCK_COLORS } from "./Picker";
import { Portfolio, Standing } from "./Portfolio";
import type { Entry, GameInfo, SharedPicks, State } from "./types";

const POLL_MS = 30_000;

/** Display-only starting point for the "players have locked in" count; the real count is added on top. */
const LOCKED_IN_BASELINE = 26_987;

export type Invite = { code: string; name: string; createdBy: string | null; sharer: (SharedPicks & { id: string }) | null };

function Card({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`scroll-mt-4 rounded-2xl border border-line bg-card p-4 sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Colored tiles for locked-in picks: symbol and dollars. */
function PickTiles({ symbols, allocs }: { symbols: string[]; allocs: number[] }) {
  return (
    <div>
      <SplitBar symbols={symbols} allocs={allocs} className="h-3" />
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {symbols.map((s, i) => (
          <li key={s} className="rounded-xl border border-line px-2 py-2.5 text-center">
            <div className="flex items-center justify-center gap-1.5 font-semibold">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STOCK_COLORS[i] }} />
              {s}
            </div>
            <div className="font-mono text-sm text-muted tabular">${Math.round(allocs[i] / 1000)}k</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrimaryButton({ children, onClick, href }: { children: React.ReactNode; onClick?: () => void; href?: string }) {
  const cls = "mt-4 block w-full rounded-full bg-accent py-3.5 text-center font-semibold text-accent-fg active:scale-[0.99]";
  return href ? (
    <a href={href} onClick={onClick} className={cls}>
      {children}
    </a>
  ) : (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

export function Game({ invite }: { invite?: Invite }) {
  const [me, setMe] = useState<Identity | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const meRef = useRef<Identity | null>(null);
  meRef.current = me;

  const refresh = useCallback(async () => {
    try {
      const s = await api<State>("/api/state", { me: meRef.current });
      if (meRef.current && !s.me) {
        // Stored identity no longer valid (e.g. DB reset). Start fresh.
        localStorage.removeItem("dsg.identity");
        setMe(null);
      }
      setState(s);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const id = loadIdentity();
    meRef.current = id;
    setMe(id);
    refresh();
    const poll = setInterval(() => document.visibilityState === "visible" && refresh(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  // Refresh right after the bell rings or the market closes, instead of waiting for the next poll.
  useEffect(() => {
    if (!state) return;
    const edges = [state.live?.closeAt, state.upcoming?.openAt].filter(Boolean).map((t) => Date.parse(t!));
    if (edges.some((t) => now >= t && now - t < 1500)) refresh();
  }, [now, state, refresh]);

  // Auto-join the invite group once we have an identity.
  useEffect(() => {
    if (!invite || !me || !state || state.groups.some((g) => g.code === invite.code)) return;
    api(`/api/groups/${invite.code}/join`, { method: "POST", me }).then(refresh).catch(() => {});
  }, [invite, me, state, refresh]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function ensureIdentity(): Promise<Identity> {
    if (me) return me;
    const created = await api<Identity>("/api/player", { method: "POST", body: {} });
    saveIdentity(created);
    meRef.current = created;
    setMe(created);
    return created;
  }

  async function submitPicks(symbols: string[], allocs: number[]) {
    const id = await ensureIdentity();
    const r = await api<{ late: boolean }>("/api/picks", { method: "POST", body: { symbols, allocs }, me: id });
    if (invite) await api(`/api/groups/${invite.code}/join`, { method: "POST", me: id }).catch(() => {});
    // Create the share link now: iOS only opens the share sheet if it's called straight from the tap,
    // with no network wait in between.
    else if (!state?.groups.length) await api("/api/groups", { method: "POST", body: {}, me: id }).catch(() => {});
    setPlaying(false);
    await refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
    flash(r.late ? "Locked in. Scoring from right now." : "Locked in. Good luck!");
  }

  async function share(text: string) {
    if (!me || !state) return;
    try {
      let code = invite && state.groups.some((g) => g.code === invite.code) ? invite.code : state.groups[0]?.code;
      if (!code) {
        code = (await api<{ code: string }>("/api/groups", { method: "POST", body: {}, me })).code;
        refresh();
      }
      const r = await shareText(text, `${location.origin}/g/${code}?p=${me.id}`);
      if (r === "copied") flash("Copied. Paste it in the group chat.");
    } catch (e) {
      flash((e as Error).message);
    }
  }

  function startPlaying() {
    setPlaying(true);
    setTimeout(() => document.getElementById("play")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  if (!state) {
    return (
      <Shell>
        <Card>
          <p className="text-sm text-muted">{loadError ? `Couldn't load the game: ${loadError}` : "Loading..."}</p>
        </Card>
      </Shell>
    );
  }

  const { live, upcoming, last, liveEntry, lastEntry, upcomingPicks, stats, dist } = state;
  const focus = live ?? upcoming;
  const todayEt = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const sharer = invite?.sharer && invite.sharer.id !== me?.id && invite.sharer.symbols.length ? invite.sharer : null;

  // Which round can be played right now: today's if the market is open and you haven't joined,
  // otherwise the next one if you haven't locked in for it yet.
  const joinLive = !!live && !liveEntry;
  const playable: GameInfo | null = joinLive ? live : upcoming && !upcomingPicks ? upcoming : null;
  const playableDay = playable ? (playable.date === todayEt ? "today's" : `${dayLabel(playable.date).split(",")[0]}'s`) : "";

  const header = focus ? `#${focus.number} · ${dayLabel(focus.date)}` : "";

  // Share texts: short, Wordle style. The link is appended by the share sheet.
  const tag = (g: { number: number; date: string }) => `Pick 3 #${g.number} · ${shortDate(g.date)}`;
  const scoreShare = (e: Entry, g: GameInfo, final: boolean) => {
    const p = percentile(e.beaten, e.fieldSize);
    const streak = stats && stats.streak > 1 ? ` · 🔥${stats.streak}` : "";
    return `${tag(g)}${final ? "" : " (live)"}\n${pts(e.ret)}${p != null ? ` · ${ordinal(p)} percentile` : ""}${streak}\n${e.legs.map((l) => dot(l.ret)).join("")}`;
  };
  const picksShare = (g: GameInfo, symbols: string[], allocs: number[]) =>
    `${tag(g)}\n🔒 ${symbols.map((s, i) => `${s} ${Math.round(allocs[i] / 1000)}%`).join(" · ")}\nThink you can beat me?`;

  return (
    <Shell mock={state.mock} header={header}>
      {/* A friend's shared picks */}
      {sharer && (
        <Card className="border-accent">
          <Kicker>You&apos;ve been challenged</Kicker>
          <p className="mt-1 text-lg font-semibold">
            Beat your friend&apos;s picks{sharer.date ? ` for ${dayLabel(sharer.date)}` : ""}
          </p>
          {sharer.ret != null && (
            <p className="text-sm text-muted">
              {sharer.status === "settled" ? "They finished at " : "They're at "}
              <span className={`font-mono font-semibold ${tone(sharer.ret)}`}>{pts(sharer.ret)}</span>
            </p>
          )}
          <div className="mt-3">
            <PickTiles symbols={sharer.symbols} allocs={sharer.allocs} />
          </div>
          {sharer.legs && (
            <p className="mt-2 font-mono text-xs text-muted tabular">
              {sharer.legs.map((l) => `${dot(l.ret)} ${l.symbol} ${pct(l.ret)}`).join("   ")}
            </p>
          )}
          {playable && !playing && <PrimaryButton onClick={startPlaying}>Make your picks →</PrimaryButton>}
        </Card>
      )}

      {/* Results card: the payoff after the close */}
      {!live && last && lastEntry && (
        <Card>
          <Kicker className="text-center">
            {shortDate(lastEntry.date)}
            {stats && stats.streak > 0 ? ` · ${stats.streak} day streak` : ""}
            {lastEntry.status !== "settled" ? " · settling" : ""}
          </Kicker>
          <div className="mt-2 text-center">
            <div className={`font-mono text-5xl font-bold tabular ${tone(lastEntry.ret)}`}>{pts(lastEntry.ret).replace(" pts", "")}</div>
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted">points</div>
            <div className="mt-2 text-2xl tracking-widest">{lastEntry.legs.map((l) => dot(l.ret)).join("")}</div>
            <p className="mt-1 font-mono text-sm text-muted">{verdict(percentile(lastEntry.beaten, lastEntry.fieldSize), lastEntry.ret)}</p>
          </div>
          <div className="mt-4">
            <StockBars legs={lastEntry.legs} />
          </div>
          <div className="mt-4">
            <StatsRow
              items={[
                { label: "Played", value: String(stats?.played ?? 1) },
                { label: "Percentile", value: percentileLabel(percentile(lastEntry.beaten, lastEntry.fieldSize)) },
                { label: "Streak", value: String(stats?.streak ?? 1) },
              ]}
            />
          </div>
          <PrimaryButton onClick={() => share(scoreShare(lastEntry, last, lastEntry.status === "settled"))}>Share score</PrimaryButton>
          {upcoming && (
            <p className="mt-3 text-center font-mono text-xs text-muted">
              Next round opens in <span className="text-fg tabular">{clock(Date.parse(upcoming.openAt) - now)}</span>
            </p>
          )}
        </Card>
      )}

      {/* Live card: during market hours */}
      {live && liveEntry && (
        <Card>
          <div className="flex items-stretch gap-3">
            <ScoreBox ret={liveEntry.ret} />
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              <Kicker className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" /> Live · closes in{" "}
                <span className="text-fg tabular">{clock(Date.parse(live.closeAt) - now)}</span>
              </Kicker>
              <p className="mt-1 font-semibold leading-snug">
                {verdict(percentile(liveEntry.beaten, liveEntry.fieldSize), liveEntry.ret)}
              </p>
              <p className="mt-0.5 font-mono text-xs text-muted">Highest score at the {etClock(live.closeAt)} ET close wins the day.</p>
            </div>
          </div>
          <div className="mt-4">
            <StockChips legs={liveEntry.legs} />
          </div>
          <Standing entry={liveEntry} />
          <PrimaryButton onClick={() => share(scoreShare(liveEntry, live, false))}>Share score</PrimaryButton>
        </Card>
      )}

      {/* Locked-in card: waiting for the bell */}
      {upcoming && upcomingPicks && (!live || liveEntry) && (
        <Card>
          <div className="flex items-baseline justify-between">
            <Kicker>🔒 Locked in · {upcoming.date === todayEt ? "today" : dayLabel(upcoming.date)}</Kicker>
          </div>
          <div className="mt-3">
            <PickTiles symbols={upcomingPicks.symbols} allocs={upcomingPicks.allocs} />
          </div>
          <div className="mt-4 text-center">
            <Kicker>Market opens in</Kicker>
            <div className="font-mono text-3xl font-bold tabular">{clock(Date.parse(upcoming.openAt) - now)}</div>
            <p className="mt-1 font-mono text-xs text-muted tabular">
              {(LOCKED_IN_BASELINE + state.upcomingCount - 1).toLocaleString()} other players locked in
            </p>
          </div>
          <PrimaryButton onClick={() => share(picksShare(upcoming, upcomingPicks.symbols, upcomingPicks.allocs))}>Share picks</PrimaryButton>
        </Card>
      )}

      {/* Play: the round you can enter now */}
      {playable && (
        <Card id="play">
          {!playing ? (
            <div className="py-4 text-center">
              <h2 className="text-3xl font-bold tracking-tight">Pick 3</h2>
              <div className="mt-3 space-y-0.5 font-mono text-sm text-muted">
                <p>pick 3 stocks</p>
                <p>split $100,000 between them</p>
                <p>{joinLive ? `scored from now until the ${etClock(playable.closeAt)} close` : `scored from the ${etClock(playable.openAt)} bell to the close`}</p>
              </div>
              <p className="mt-3 text-sm">Finish the day higher than your friends.</p>
              <PrimaryButton onClick={startPlaying}>{joinLive ? "Join today's round →" : `Play ${playableDay} round →`}</PrimaryButton>
              {!joinLive && (
                <p className="mt-3 font-mono text-xs text-muted">
                  Picks lock at the bell · <span className="tabular">{clock(Date.parse(playable.openAt) - now)}</span>
                </p>
              )}
            </div>
          ) : (
            <Picker
              submitLabel="Lock in my picks"
              lockNote={
                joinLive
                  ? "Once you lock in, your picks can't be changed today. Scoring starts right away."
                  : `Once you lock in, your picks can't be changed for ${dayLabel(playable.date)}.`
              }
              onSubmit={submitPicks}
              onCancel={() => setPlaying(false)}
            />
          )}
        </Card>
      )}

      {/* Where you landed + details, below the main cards */}
      {(live ? liveEntry : !live && lastEntry) && dist && (
        <Card>
          <Kicker>Where you landed</Kicker>
          <div className="mt-3">
            <Distribution
              dist={dist}
              ret={(live ? liveEntry : lastEntry)!.ret}
              total={(live ? liveEntry : lastEntry)!.fieldSize}
            />
          </div>
        </Card>
      )}
      {live && liveEntry && (
        <Card>
          <Portfolio entry={liveEntry} game={live} details />
        </Card>
      )}
      {!live && last && lastEntry && (
        <Card>
          <Portfolio entry={lastEntry} game={last} details />
        </Card>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-20 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-fg px-4 py-2 text-center text-sm text-bg shadow-lg">
          {toast}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, mock, header }: { children: React.ReactNode; mock?: boolean; header?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-3 pb-[max(4rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between rounded-xl border border-line bg-card px-3 py-2">
        <h1 className="font-mono text-base font-bold tracking-tight">PICK 3</h1>
        <span className="flex items-center gap-2 font-mono text-xs text-muted">
          {mock && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">demo</span>}
          {header}
        </span>
      </header>
      {children}
      <footer className="mt-4 text-center text-xs text-muted">A game, not investment advice. Prices may be delayed.</footer>
    </main>
  );
}
