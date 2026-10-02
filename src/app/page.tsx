import { Mystery } from "@/components/Mystery";
import { ANSWER_POOL, COMPANIES } from "@/lib/mystery";

// Fresh puzzle each day: render per request rather than at build time.
export const dynamic = "force-dynamic";

export default function Home() {
  // Only names and tickers go to the browser, for the guess search. Everything else stays on the server.
  const companies = COMPANIES.map((c) => [c.symbol, c.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  // The answer bank: every company that can be an answer, A to Z. It says nothing about today's.
  const pool = new Set(ANSWER_POOL);
  const plain = (name: string) => name.replace(/^The /, "");
  const bank = companies.filter(([sym]) => pool.has(sym)).sort((a, b) => plain(a[1]).localeCompare(plain(b[1])));
  return <Mystery companies={companies} bank={bank} />;
}
