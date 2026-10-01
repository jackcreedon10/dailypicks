"use client";

import { useEffect, useRef, useState } from "react";
import { api, money } from "@/lib/client";

type Result = { symbol: string; name: string };

export const TOTAL = 100_000;
const MIN = 1_000;
const STEP = 1_000;
const NUDGE = 5_000;
export const STOCK_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)"];

export const even = (): number[] => [34_000, 33_000, 33_000];
const pctOf = (x: number) => `${Math.round((x / TOTAL) * 100)}%`;

/**
 * Set stock i to `value` and rebalance the other two so the total stays $100,000.
 * The other two keep their relative sizes; everything snaps to $1,000 and stays >= $1,000.
 */
export function rebalance(allocs: number[], i: number, value: number): number[] {
  const v = Math.min(Math.max(Math.round(value / STEP) * STEP, MIN), TOTAL - 2 * MIN);
  const [a, b] = [0, 1, 2].filter((k) => k !== i);
  const rest = TOTAL - v;
  const share = allocs[a] + allocs[b] > 0 ? allocs[a] / (allocs[a] + allocs[b]) : 0.5;
  let na = Math.round((rest * share) / STEP) * STEP;
  na = Math.min(Math.max(na, MIN), rest - MIN);
  const out = [...allocs];
  out[i] = v;
  out[a] = na;
  out[b] = rest - na;
  return out;
}

export function SplitBar({ symbols, allocs, className = "h-3" }: { symbols: string[]; allocs: number[]; className?: string }) {
  return (
    <div className={`flex w-full overflow-hidden rounded-full ${className}`} aria-hidden="true">
      {symbols.map((s, i) => (
        <div
          key={s}
          style={{ width: `${(allocs[i] / TOTAL) * 100}%`, background: STOCK_COLORS[i] }}
          className="h-full transition-[width] duration-150 [&:not(:last-child)]:border-r-2 [&:not(:last-child)]:border-card"
        />
      ))}
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ["Pick 3 stocks", "Split $100k", "Lock in"];
  return (
    <ol className="mb-4 flex items-center gap-2 text-xs">
      {labels.map((l, i) => (
        <li key={l} className="flex flex-1 flex-col gap-1.5">
          <span className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} />
          <span className={i === step ? "font-semibold" : "text-muted"}>{l}</span>
        </li>
      ))}
    </ol>
  );
}

export function Picker({
  needsNickname,
  submitLabel,
  lockNote,
  onSubmit,
  onCancel,
}: {
  needsNickname: boolean;
  submitLabel: string;
  lockNote: string;
  onSubmit: (symbols: string[], allocs: number[], nickname: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<string[]>([]);
  const [allocs, setAllocs] = useState<number[]>(even());
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const ctl = setTimeout(() => {
      api<{ results: Result[] }>(`/api/stocks?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.results))
        .catch(() => setResults([]));
    }, 150);
    return () => clearTimeout(ctl);
  }, [q]);

  function add(sym: string) {
    if (picks.includes(sym) || picks.length >= 3) return;
    setPicks([...picks, sym]);
    setQ("");
    setResults([]);
    input.current?.focus();
  }

  function remove(sym: string) {
    setPicks(picks.filter((p) => p !== sym));
    setAllocs(even());
  }

  async function submit() {
    setError(null);
    if (needsNickname && !nickname.trim()) return setError("Add a nickname so friends know it's you");
    setBusy(true);
    try {
      await onSubmit(picks, allocs, nickname.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isEven = allocs.every((a, i) => a === even()[i]);

  return (
    <div>
      <Steps step={step} />

      {step === 0 && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`flex h-16 items-center justify-center rounded-xl border text-lg font-semibold ${
                  picks[i] ? "border-accent bg-accent/10" : "border-dashed border-line text-muted"
                }`}
              >
                {picks[i] ? (
                  <button className="flex items-center gap-1.5" onClick={() => remove(picks[i])} aria-label={`Remove ${picks[i]}`}>
                    {picks[i]}
                    <span className="text-base font-normal text-muted">&times;</span>
                  </button>
                ) : (
                  <span className="text-sm font-normal">Stock {i + 1}</span>
                )}
              </div>
            ))}
          </div>

          {picks.length < 3 && (
            <div className="relative mt-3">
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && results[0] && add(results[0].symbol)}
                placeholder="Search any US stock: NVDA, Tesla..."
                autoCapitalize="characters"
                autoComplete="off"
                className="w-full rounded-xl border border-line bg-bg px-4 py-3 outline-none focus:border-accent"
              />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto overscroll-contain rounded-xl border border-line bg-card shadow-lg">
                  <li className="sticky top-0 border-b border-line bg-card px-4 py-1.5 text-xs text-muted">
                    {results.length.toLocaleString()} {results.length === 1 ? "match" : "matches"}
                    {results.length > 6 ? ", scroll for more" : ""}
                  </li>
                  {results.map((r) => (
                    <li key={r.symbol}>
                      <button
                        onClick={() => add(r.symbol)}
                        disabled={picks.includes(r.symbol)}
                        className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left hover:bg-bg disabled:opacity-40"
                      >
                        <span className="w-16 shrink-0 font-semibold">{r.symbol}</span>
                        <span className="truncate text-sm text-muted">{r.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStep(1)}
              disabled={picks.length !== 3}
              className="flex-1 rounded-xl bg-accent py-3 font-semibold text-accent-fg disabled:opacity-40"
            >
              {picks.length === 3 ? "Next: split your $100k" : `Pick ${3 - picks.length} more`}
            </button>
            {onCancel && (
              <button onClick={onCancel} className="rounded-xl border border-line px-4 py-3 text-sm">
                Cancel
              </button>
            )}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-muted">Drag to put more money behind your favorites.</p>
            <button
              onClick={() => setAllocs(even())}
              disabled={isEven}
              className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-medium disabled:opacity-40"
            >
              Even split
            </button>
          </div>

          <SplitBar symbols={picks} allocs={allocs} className="mt-3 h-4" />

          <ul className="mt-4 space-y-4">
            {picks.map((s, i) => (
              <li key={s}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="h-3 w-3 rounded-full" style={{ background: STOCK_COLORS[i] }} />
                    {s}
                  </span>
                  <span className="tabular">
                    <span className="text-lg font-semibold">{money(allocs[i]).replace(".00", "")}</span>
                    <span className="ml-1.5 text-sm text-muted">{pctOf(allocs[i])}</span>
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => setAllocs(rebalance(allocs, i, allocs[i] - NUDGE))}
                    className="h-9 w-9 shrink-0 rounded-full border border-line text-lg leading-none"
                    aria-label={`Less in ${s}`}
                  >
                    &minus;
                  </button>
                  <input
                    type="range"
                    min={MIN}
                    max={TOTAL - 2 * MIN}
                    step={STEP}
                    value={allocs[i]}
                    onChange={(e) => setAllocs(rebalance(allocs, i, Number(e.target.value)))}
                    className="split h-9 flex-1 cursor-pointer"
                    style={{ "--c": STOCK_COLORS[i], "--p": `${((allocs[i] - MIN) / (TOTAL - 3 * MIN)) * 100}%` } as React.CSSProperties}
                    aria-label={`Dollars in ${s}`}
                  />
                  <button
                    onClick={() => setAllocs(rebalance(allocs, i, allocs[i] + NUDGE))}
                    className="h-9 w-9 shrink-0 rounded-full border border-line text-lg leading-none"
                    aria-label={`More in ${s}`}
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-center text-xs text-muted tabular">Total {money(TOTAL).replace(".00", "")}, always fully invested</p>

          <div className="mt-3 flex gap-2">
            <button onClick={() => setStep(0)} className="rounded-xl border border-line px-4 py-3 text-sm">
              Back
            </button>
            <button onClick={() => setStep(2)} className="flex-1 rounded-xl bg-accent py-3 font-semibold text-accent-fg">
              Next: review
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <SplitBar symbols={picks} allocs={allocs} className="h-4" />
          <ul className="mt-3 divide-y divide-line">
            {picks.map((s, i) => (
              <li key={s} className="flex items-center justify-between py-2.5">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="h-3 w-3 rounded-full" style={{ background: STOCK_COLORS[i] }} />
                  {s}
                </span>
                <span className="tabular">
                  {money(allocs[i]).replace(".00", "")}
                  <span className="ml-1.5 text-sm text-muted">{pctOf(allocs[i])}</span>
                </span>
              </li>
            ))}
          </ul>

          {needsNickname && (
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
              placeholder="Your nickname (friends will see this)"
              className="mt-3 w-full rounded-xl border border-line bg-bg px-4 py-3 outline-none focus:border-accent"
            />
          )}

          <p className="mt-3 rounded-lg bg-bg px-3 py-2 text-sm text-muted">{lockNote}</p>
          {error && <p className="mt-2 text-sm text-down">{error}</p>}

          <div className="mt-3 flex gap-2">
            <button onClick={() => setStep(1)} disabled={busy} className="rounded-xl border border-line px-4 py-3 text-sm">
              Back
            </button>
            <button onClick={submit} disabled={busy} className="flex-1 rounded-xl bg-accent py-3 font-semibold text-accent-fg disabled:opacity-40">
              {busy ? "Locking in..." : submitLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
