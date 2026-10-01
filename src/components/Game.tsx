"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, dayLabel, etClock, loadIdentity, money, pct, pts, saveIdentity, shareText, timeLeft, tone, type Identity } from "@/lib/client";
import { Leaderboard } from "./Leaderboard";
import { Picker, SplitBar, STOCK_COLORS } from "./Picker";
import { Portfolio } from "./Portfolio";
import type { SharedPicks, State } from "./types";

const POLL_MS = 30_000;

export type Invite = { code: string; name: string; createdBy: string | null; sharer: (SharedPicks & { id: string }) | null };

function Card({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-2xl border border-line bg-card p-4 sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

const k = (x: number) => `$${Math.round(x / 1000)}k`;

/** "NVDA $50k, TSLA $25k, AMZN $25k" */
const splitText = (symbols: string[], allocs: number[]) => symbols.map((s, i) => `${s} ${k(allocs[i])}`).join(", ");

function LockedPicks({ symbols, allocs }: { symbols: string[]; allocs: number[] }) {
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
            <div className="text-sm text-muted tabular">{k(allocs[i])}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function Game({ invite }: { invite?: Invite }) {
  const [me, setMe] = useState<Identity | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pickingNext, setPickingNext] = useState(false);
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
      setRefreshKey((n) => n + 1);
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
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
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

  async function ensureIdentity(nickname: string): Promise<Identity> {
    if (me) return me;
    const created = await api<Identity>("/api/player", { method: "POST", body: { nickname } });
    saveIdentity(created);
    meRef.current = created;
    setMe(created);
    return created;
  }

  async function submitPicks(symbols: string[], allocs: number[], nickname: string) {
    const id = await ensureIdentity(nickname);
    const r = await api<{ late: boolean }>("/api/picks", { method: "POST", body: { symbols, allocs }, me: id });
    if (invite) await api(`/api/groups/${invite.code}/join`, { method: "POST", me: id }).catch(() => {});
    setPickingNext(false);
    await refresh();
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
      if (r === "copied") flash("Link copied. Paste it in the group chat.");
    } catch (e) {
      flash((e as Error).message);
    }
  }

  // A plain render helper, not a component: defining a component inside Game would remount
  // the button on every clock tick and swallow taps.
  function shareButton(text: string, primary = false) {
    return (
      <button
        onClick={() => share(text)}
        className={
          primary
            ? "mt-3 w-full rounded-xl bg-accent py-3 font-semibold text-accent-fg"
            : "rounded-full border border-line px-3 py-1.5 text-sm font-medium"
        }
      >
        Share picks
      </button>
    );
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

  const { live, upcoming, last, liveEntry, lastEntry, upcomingPicks } = state;
  const number = live?.number ?? upcoming?.number;
  const todayEt = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const upcomingIsNextDay = !!upcoming && upcoming.date !== todayEt;
  const upcomingDay = upcoming ? (upcomingIsNextDay ? dayLabel(upcoming.date) : "today") : "";
  const sharer = invite?.sharer && invite.sharer.id !== me?.id && invite.sharer.symbols.length ? invite.sharer : null;
  const needsPicks = (live && !liveEntry) || (!live && upcoming && !upcomingPicks);

  return (
    <Shell mock={state.mock}>
      {/* Status bar */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-muted">{number ? `Day #${number}` : ""}</span>
        {live ? (
          <span className="flex items-center gap-1.5 font-medium">
            <span className="h-2 w-2 animate-pulse rounded-full bg-up" />
            Market open, closes in {timeLeft(Date.parse(live.closeAt) - now)}
          </span>
        ) : upcoming ? (
          <span className="font-medium">
            Market opens in <span className="tabular">{timeLeft(Date.parse(upcoming.openAt) - now)}</span>
          </span>
        ) : null}
      </div>

      {/* What a friend sees when they open a shared link */}
      {sharer && (
        <Card className="border-accent">
          <p className="font-semibold">
            {sharer.nickname}&apos;s picks{sharer.date ? ` for ${dayLabel(sharer.date)}` : ""}
          </p>
          {sharer.ret != null && (
            <p className="text-sm text-muted">
              {sharer.status === "settled" ? "Finished at " : "Currently "}
              <span className={`font-semibold ${tone(sharer.ret)}`}>{pts(sharer.ret)}</span>
            </p>
          )}
          <div className="mt-3">
            <LockedPicks symbols={sharer.symbols} allocs={sharer.allocs} />
          </div>
          {sharer.legs && (
            <p className="mt-2 text-xs text-muted tabular">
              {sharer.legs.map((l) => `${l.symbol} ${pct(l.ret)}`).join("   ")}
            </p>
          )}
          {needsPicks && (
            <a href="#picks" className="mt-3 block w-full rounded-xl bg-accent py-3 text-center font-semibold text-accent-fg">
              Make my picks
            </a>
          )}
        </Card>
      )}
      {invite && !sharer && !state.groups.some((g) => g.code === invite.code) && (
        <Card className="border-accent">
          <p className="font-semibold">{invite.createdBy ? `${invite.createdBy} invited you` : "You're invited"} to {invite.name}</p>
          <p className="mt-1 text-sm text-muted">Pick 3 stocks, split $100,000 between them, and see who wins at the close.</p>
        </Card>
      )}

      {/* Live game */}
      {live && liveEntry && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Today</h2>
            {shareButton(`My Daily Picks today: ${splitText(liveEntry.symbols, liveEntry.allocs)}. I'm at ${pts(liveEntry.ret)} as of ${etClock(new Date().toISOString())} ET. Make your picks and try to beat me:`)}
          </div>
          <Portfolio entry={liveEntry} game={live} />
        </Card>
      )}

      {live && !liveEntry && (
        <Card id="picks">
          <h2 className="text-lg font-semibold">The market is open. Jump in.</h2>
          <p className="mb-4 mt-1 text-sm text-muted">
            Pick 3 stocks and split $100,000 between them. You&apos;re scored from right now until the {etClock(live.closeAt)} ET close.
          </p>
          <Picker
            needsNickname={!me}
            submitLabel="Lock in my picks"
            lockNote="Once you lock in, your picks and split can't be changed today."
            onSubmit={submitPicks}
          />
        </Card>
      )}

      {/* Upcoming picks */}
      {upcoming && (!live || liveEntry) && (
        <Card id={!live ? "picks" : undefined}>
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">{upcomingIsNextDay ? `Picks for ${upcomingDay}` : "Today's picks"}</h2>
            {upcomingPicks && (
              <span className="flex items-center gap-1 text-xs font-medium text-muted">
                <LockIcon /> Locked in
              </span>
            )}
          </div>

          {upcomingPicks ? (
            <>
              <div className="mt-3">
                <LockedPicks symbols={upcomingPicks.symbols} allocs={upcomingPicks.allocs} />
              </div>
              <p className="mt-2 text-xs text-muted">
                Scoring starts at the {etClock(upcoming.openAt)} ET opening bell{upcomingIsNextDay ? ` on ${upcomingDay}` : ""}.
              </p>
              {shareButton(`My Daily Picks for ${dayLabel(upcoming.date)}: ${splitText(upcomingPicks.symbols, upcomingPicks.allocs)}. Make your picks and try to beat me:`, true)}
            </>
          ) : live && !pickingNext ? (
            <button onClick={() => setPickingNext(true)} className="mt-3 w-full rounded-xl border border-dashed border-line py-3 text-sm text-muted">
              Make your picks for {upcomingDay}
            </button>
          ) : (
            <div className="mt-3">
              {!live && (
                <p className="mb-3 text-sm text-muted">
                  Pick any 3 US stocks and split $100,000 between them. Scoring starts at the {etClock(upcoming.openAt)} ET opening bell.
                </p>
              )}
              <Picker
                needsNickname={!me}
                submitLabel="Lock in my picks"
                lockNote={`Once you lock in, your picks and split can't be changed for ${upcomingDay}.`}
                onSubmit={submitPicks}
                onCancel={pickingNext ? () => setPickingNext(false) : undefined}
              />
            </div>
          )}
        </Card>
      )}

      {/* Last result */}
      {!live && last && lastEntry && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              {lastEntry.status === "settled" ? "Final" : "Settling"}: {dayLabel(lastEntry.date)}
            </h2>
            {shareButton(`My Daily Picks for ${dayLabel(lastEntry.date)}: ${splitText(lastEntry.symbols, lastEntry.allocs)}. Finished at ${pts(lastEntry.ret)}. Make your picks and try to beat me:`)}
          </div>
          <Portfolio entry={lastEntry} game={last} />
        </Card>
      )}

      {(live || last) && (
        <Card>
          <Leaderboard me={me} groups={state.groups} refreshKey={refreshKey} live={!!live} />
          {state.groups.length === 0 && me && (liveEntry || upcomingPicks) && (
            <p className="mt-4 text-center text-sm text-muted">Share your picks to start a friends leaderboard.</p>
          )}
        </Card>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-20 mx-auto w-fit rounded-full bg-fg px-4 py-2 text-sm text-bg shadow-lg">{toast}</div>
      )}
    </Shell>
  );
}

function Shell({ children, mock }: { children: React.ReactNode; mock?: boolean }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-3 px-4 pb-16 pt-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Daily Picks</h1>
        {mock && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">Demo prices</span>}
      </header>
      {children}
      <footer className="mt-4 text-center text-xs text-muted">
        A game, not investment advice. Prices may be delayed. Starting money: {money(100_000).replace(".00", "")}.
      </footer>
    </main>
  );
}
