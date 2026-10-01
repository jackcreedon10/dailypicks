import { db, must } from "@/lib/db";
import { handle, json } from "@/lib/http";

type Row = { symbol: string; name: string };

/**
 * Typeahead over eligible stocks. Returns every symbol starting with the query (so "D" lists
 * all D stocks, alphabetically, with an exact match first), followed by company-name matches.
 */
export const GET = handle(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 30);
  if (!q) return json({ results: [] });
  const sym = q.toUpperCase().replace(/[^A-Z.]/g, "");
  const name = q.replace(/[%_,().*"\\]/g, "");

  const [bySymbol, byName] = await Promise.all([
    sym
      ? db().from("assets").select("symbol, name").ilike("symbol", `${sym}%`).order("symbol").limit(1000).then(must)
      : Promise.resolve([]),
    name.length >= 2
      ? db()
          .from("assets")
          .select("symbol, name")
          // Word-start matches only ("del" finds Dell and Delta, not "Model").
          .or(`name.ilike.${name}%,name.ilike.% ${name}%`)
          .order("symbol")
          .limit(50)
          .then(must)
      : Promise.resolve([]),
  ]);

  const seen = new Set<string>();
  const results = [...(bySymbol as Row[])]
    .sort((a, b) => (a.symbol === sym ? -1 : b.symbol === sym ? 1 : a.symbol.localeCompare(b.symbol)))
    .concat(byName as Row[])
    .filter((r) => !seen.has(r.symbol) && seen.add(r.symbol));
  return json({ results });
});
