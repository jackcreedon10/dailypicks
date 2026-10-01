"use client";

// Browser-side helpers: anonymous identity, API calls, formatting.

export type Identity = { id: string; token: string; nickname: string };

const KEY = "dsg.identity";

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity) {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    // Private mode etc. The session still works until reload.
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; me?: Identity | null } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.me) headers.authorization = `Player ${opts.me.id}.${opts.me.token}`;
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const pct = (x: number, digits = 2) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;

/** Score in points: 1% portfolio return = 100 pts. */
export const points = (ret: number) => Math.round(ret * 10_000);

export const pts = (ret: number) => {
  const p = points(ret);
  return `${p > 0 ? "+" : ""}${p.toLocaleString("en-US")} pts`;
};

/** "Top 12%" style global percentile; null when there's nobody to compare against. */
export function topPct(rank: number | null, field: number | null): string | null {
  if (!rank || !field || field < 2) return null;
  return `Top ${Math.max(1, Math.ceil((rank / field) * 100))}%`;
}

export const money = (x: number) =>
  x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const price = (x: number | null) => (x == null ? "--" : `$${x.toFixed(2)}`);

export const tone = (x: number) => (x > 0.00005 ? "text-up" : x < -0.00005 ? "text-down" : "text-muted");

export function timeLeft(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function etClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
}

export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Native share sheet on phones, clipboard elsewhere. Returns what happened. */
export async function shareText(text: string, url: string): Promise<"shared" | "copied" | "failed"> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ text, url });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return "copied";
  } catch {
    return "failed";
  }
}
