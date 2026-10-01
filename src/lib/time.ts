export const MARKET_TZ = "America/New_York";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: MARKET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** YYYY-MM-DD for the given instant, in New York time. */
export function etDate(d: Date = new Date()): string {
  return dateFmt.format(d);
}

/** Offset in ms between New York wall-clock time and UTC at the given instant. */
function etOffsetMs(d: Date): number {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Convert a New York wall-clock date ("2026-10-01") and time ("09:30") to a UTC instant. */
export function etToUtc(date: string, hhmm: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes handle the DST boundary correctly.
  let t = guess - etOffsetMs(new Date(guess));
  t = guess - etOffsetMs(new Date(t));
  return new Date(t);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Start of the minute containing d. */
export function minuteBucket(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}
