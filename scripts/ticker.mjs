// Local stand-in for the production scheduler: hits the tick endpoint every 30s.
// Usage: npm run ticker   (with `npm run dev` running in another terminal)
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const url = process.env.TICK_URL ?? "http://localhost:3000/api/cron/tick";
const every = Number(process.env.TICK_SECONDS ?? 30) * 1000;

async function run() {
  try {
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
    console.log(new Date().toLocaleTimeString(), res.status, JSON.stringify(await res.json()));
  } catch (e) {
    console.error(new Date().toLocaleTimeString(), "tick failed:", e.message);
  }
}

run();
setInterval(run, every);
