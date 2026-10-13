import { Mystery } from "@/components/Mystery";
import { COMPANIES } from "@/lib/mystery";

// Fresh puzzle each day: render per request rather than at build time.
export const dynamic = "force-dynamic";

export default function Home() {
  // Only names and tickers go to the browser, for the guess search. Everything else stays on the server.
  const companies = COMPANIES.map((c) => [c.symbol, c.name] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]));
  return <Mystery companies={companies} />;
}
