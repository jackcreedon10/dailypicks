import { addDays, etDate, etToUtc } from "./time";

export type TradingDay = { date: string; open: string; close: string }; // open/close are "HH:MM" New York time
export type Asset = { symbol: string; name: string; exchange: string };
export type Snapshot = {
  price: number; // last trade
  open: number | null; // today's official-ish open, null until the first regular-session trade
};

export interface MarketData {
  calendar(start: string, end: string): Promise<TradingDay[]>;
  assets(): Promise<Asset[]>;
  snapshots(symbols: string[]): Promise<Record<string, Snapshot>>;
  /** Last regular-session 1-minute bar close at or before closeAt. */
  closingPrices(symbols: string[], closeAt: Date): Promise<Record<string, number>>;
}

const LISTED_EXCHANGES = new Set(["NYSE", "NASDAQ", "AMEX", "ARCA", "BATS", "NYSEARCA"]);

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------
// Alpaca (free IEX feed)
// ---------------------------------------------------------------------------

class AlpacaMarketData implements MarketData {
  private headers: Record<string, string>;
  private tradingBase = process.env.ALPACA_TRADING_URL ?? "https://paper-api.alpaca.markets";
  private dataBase = "https://data.alpaca.markets";
  private feed = process.env.ALPACA_FEED ?? "iex";

  constructor(keyId: string, secret: string) {
    this.headers = { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret };
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: this.headers, cache: "no-store" });
    if (!res.ok) throw new Error(`Alpaca ${res.status} ${url.split("?")[0]}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async calendar(start: string, end: string): Promise<TradingDay[]> {
    const rows = await this.get<{ date: string; open: string; close: string }[]>(
      `${this.tradingBase}/v2/calendar?start=${start}&end=${end}`,
    );
    return rows.map((r) => ({ date: r.date, open: r.open, close: r.close }));
  }

  async assets(): Promise<Asset[]> {
    const rows = await this.get<
      { symbol: string; name: string; exchange: string; tradable: boolean; status: string }[]
    >(`${this.tradingBase}/v2/assets?status=active&asset_class=us_equity`);
    return rows
      .filter((a) => a.tradable && LISTED_EXCHANGES.has(a.exchange) && /^[A-Z.]{1,6}$/.test(a.symbol))
      .map((a) => ({ symbol: a.symbol, name: a.name || a.symbol, exchange: a.exchange }));
  }

  async snapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
    const today = etDate();
    const out: Record<string, Snapshot> = {};
    for (const batch of chunk(symbols, 200)) {
      type Snap = {
        latestTrade?: { p: number; t: string };
        dailyBar?: { o: number; c: number; t: string };
      };
      const raw = await this.get<Record<string, Snap> & { snapshots?: Record<string, Snap> }>(
        `${this.dataBase}/v2/stocks/snapshots?symbols=${encodeURIComponent(batch.join(","))}&feed=${this.feed}`,
      );
      const snaps = (raw.snapshots ?? raw) as Record<string, Snap>;
      for (const [sym, s] of Object.entries(snaps)) {
        const price = s?.latestTrade?.p;
        if (!price) continue;
        const barIsToday = s.dailyBar && etDate(new Date(s.dailyBar.t)) === today;
        out[sym] = { price, open: barIsToday ? s.dailyBar!.o : null };
      }
    }
    return out;
  }

  async closingPrices(symbols: string[], closeAt: Date): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const start = new Date(closeAt.getTime() - 30 * 60_000).toISOString();
    const end = new Date(closeAt.getTime() - 1000).toISOString();
    for (const batch of chunk(symbols, 100)) {
      let pageToken: string | undefined;
      do {
        const url =
          `${this.dataBase}/v2/stocks/bars?symbols=${encodeURIComponent(batch.join(","))}` +
          `&timeframe=1Min&start=${start}&end=${end}&feed=${this.feed}&limit=10000&sort=asc` +
          (pageToken ? `&page_token=${pageToken}` : "");
        const res = await this.get<{
          bars: Record<string, { t: string; c: number }[]>;
          next_page_token?: string | null;
        }>(url);
        for (const [sym, bars] of Object.entries(res.bars ?? {})) {
          if (bars.length) out[sym] = bars[bars.length - 1].c; // sorted asc, later pages overwrite
        }
        pageToken = res.next_page_token ?? undefined;
      } while (pageToken);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Mock provider: deterministic random walks, weekday sessions. For local dev only.
// MOCK_SESSION="HH:MM-HH:MM" overrides the session hours (New York time) so you can
// test the live game outside real market hours.
// ---------------------------------------------------------------------------

const MOCK_ASSETS: Asset[] = [
  ["AAPL", "Apple Inc."], ["MSFT", "Microsoft Corporation"], ["NVDA", "NVIDIA Corporation"],
  ["AMZN", "Amazon.com, Inc."], ["GOOGL", "Alphabet Inc. Class A"], ["META", "Meta Platforms, Inc."],
  ["TSLA", "Tesla, Inc."], ["AMD", "Advanced Micro Devices, Inc."], ["NFLX", "Netflix, Inc."],
  ["PLTR", "Palantir Technologies Inc."], ["COIN", "Coinbase Global, Inc."], ["JPM", "JPMorgan Chase & Co."],
  ["DIS", "The Walt Disney Company"], ["NKE", "NIKE, Inc."], ["SBUX", "Starbucks Corporation"],
  ["UBER", "Uber Technologies, Inc."], ["SHOP", "Shopify Inc."], ["SNAP", "Snap Inc."],
  ["GME", "GameStop Corp."], ["AMC", "AMC Entertainment Holdings"], ["SOFI", "SoFi Technologies, Inc."],
  ["RIVN", "Rivian Automotive, Inc."], ["INTC", "Intel Corporation"], ["BA", "The Boeing Company"],
  ["WMT", "Walmart Inc."], ["COST", "Costco Wholesale Corporation"], ["KO", "The Coca-Cola Company"],
  ["SPY", "SPDR S&P 500 ETF Trust"], ["QQQ", "Invesco QQQ Trust"], ["SNDL", "SNDL Inc."],
  // Broader demo list so search behaves like the real (~7,000 stock) list.
  ["ABBV", "AbbVie Inc."], ["ABNB", "Airbnb, Inc."], ["ABT", "Abbott Laboratories"], ["ADBE", "Adobe Inc."],
  ["ADP", "Automatic Data Processing"], ["AFRM", "Affirm Holdings"], ["AIG", "American International Group"],
  ["ALB", "Albemarle Corporation"], ["AMAT", "Applied Materials"], ["AMGN", "Amgen Inc."], ["ANET", "Arista Networks"],
  ["ARM", "Arm Holdings plc"], ["AVGO", "Broadcom Inc."], ["AXP", "American Express Company"], ["AZO", "AutoZone, Inc."],
  ["BABA", "Alibaba Group"], ["BAC", "Bank of America Corporation"], ["BBY", "Best Buy Co."], ["BIIB", "Biogen Inc."],
  ["BKNG", "Booking Holdings"], ["BLK", "BlackRock, Inc."], ["BMY", "Bristol-Myers Squibb"], ["BX", "Blackstone Inc."],
  ["C", "Citigroup Inc."], ["CAT", "Caterpillar Inc."], ["CCL", "Carnival Corporation"], ["CHWY", "Chewy, Inc."],
  ["CMCSA", "Comcast Corporation"], ["CMG", "Chipotle Mexican Grill"], ["CRM", "Salesforce, Inc."], ["CRWD", "CrowdStrike Holdings"],
  ["CSCO", "Cisco Systems"], ["CVNA", "Carvana Co."], ["CVS", "CVS Health"], ["CVX", "Chevron Corporation"],
  ["DAL", "Delta Air Lines"], ["DASH", "DoorDash, Inc."], ["DD", "DuPont de Nemours"], ["DDOG", "Datadog, Inc."],
  ["DE", "Deere & Company"], ["DECK", "Deckers Outdoor"], ["DELL", "Dell Technologies"], ["DG", "Dollar General"],
  ["DHR", "Danaher Corporation"], ["DKNG", "DraftKings Inc."], ["DLR", "Digital Realty Trust"], ["DLTR", "Dollar Tree"],
  ["DOCU", "DocuSign, Inc."], ["DOW", "Dow Inc."], ["DPZ", "Domino's Pizza"], ["DRI", "Darden Restaurants"],
  ["DUK", "Duke Energy"], ["DVN", "Devon Energy"], ["DXCM", "DexCom, Inc."], ["EA", "Electronic Arts"],
  ["EBAY", "eBay Inc."], ["ENPH", "Enphase Energy"], ["ETSY", "Etsy, Inc."], ["F", "Ford Motor Company"],
  ["FDX", "FedEx Corporation"], ["GE", "GE Aerospace"], ["GILD", "Gilead Sciences"], ["GM", "General Motors"],
  ["GS", "Goldman Sachs Group"], ["HD", "The Home Depot"], ["HOOD", "Robinhood Markets"], ["IBM", "IBM"],
  ["JNJ", "Johnson & Johnson"], ["LLY", "Eli Lilly and Company"], ["LULU", "Lululemon Athletica"], ["LYFT", "Lyft, Inc."],
  ["MA", "Mastercard Incorporated"], ["MARA", "MARA Holdings"], ["MCD", "McDonald's Corporation"], ["MRNA", "Moderna, Inc."],
  ["MS", "Morgan Stanley"], ["MSTR", "MicroStrategy"], ["MU", "Micron Technology"], ["NET", "Cloudflare, Inc."],
  ["NIO", "NIO Inc."], ["ORCL", "Oracle Corporation"], ["PEP", "PepsiCo, Inc."], ["PFE", "Pfizer Inc."],
  ["PG", "Procter & Gamble"], ["PYPL", "PayPal Holdings"], ["QCOM", "Qualcomm"], ["RBLX", "Roblox Corporation"],
  ["RIOT", "Riot Platforms"], ["ROKU", "Roku, Inc."], ["SMCI", "Super Micro Computer"], ["SNOW", "Snowflake Inc."],
  ["SPOT", "Spotify Technology"], ["SQ", "Block, Inc."], ["T", "AT&T Inc."], ["TGT", "Target Corporation"],
  ["TSM", "Taiwan Semiconductor"], ["TXN", "Texas Instruments"], ["UNH", "UnitedHealth Group"], ["UPST", "Upstart Holdings"],
  ["V", "Visa Inc."], ["VZ", "Verizon Communications"], ["WBD", "Warner Bros. Discovery"], ["XOM", "Exxon Mobil"],
  ["ZM", "Zoom Communications"],
].map(([symbol, name]) => ({ symbol, name, exchange: "NASDAQ" }));

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MockMarketData implements MarketData {
  private session = (process.env.MOCK_SESSION ?? "09:30-16:00").split("-");

  async calendar(start: string, end: string): Promise<TradingDay[]> {
    const out: TradingDay[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) out.push({ date: d, open: this.session[0], close: this.session[1] });
    }
    return out;
  }

  async assets(): Promise<Asset[]> {
    return MOCK_ASSETS;
  }

  /** Price of a symbol `minutes` into the session on `date`. */
  private priceAt(symbol: string, date: string, minutes: number): number {
    const base = symbol === "SNDL" ? 0.8 : 20 + (hash(symbol) % 480);
    const rnd = mulberry32(hash(symbol + date));
    const drift = (rnd() - 0.5) * 0.0004;
    let logP = Math.log(base) + (rnd() - 0.5) * 0.02;
    for (let i = 0; i < minutes; i++) logP += drift + (rnd() - 0.5) * 0.004;
    return Math.round(Math.exp(logP) * 100) / 100;
  }

  private minutesIntoSession(at: Date): { date: string; minutes: number } {
    const date = etDate(at);
    const open = etToUtc(date, this.session[0]).getTime();
    const close = etToUtc(date, this.session[1]).getTime();
    const t = Math.min(Math.max(at.getTime(), open), close);
    return { date, minutes: Math.floor((t - open) / 60_000) };
  }

  async snapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
    const now = new Date();
    const { date, minutes } = this.minutesIntoSession(now);
    const opened = now >= etToUtc(date, this.session[0]);
    const out: Record<string, Snapshot> = {};
    for (const s of symbols) {
      if (!MOCK_ASSETS.some((a) => a.symbol === s)) continue;
      out[s] = { price: this.priceAt(s, date, minutes), open: opened ? this.priceAt(s, date, 0) : null };
    }
    return out;
  }

  async closingPrices(symbols: string[], closeAt: Date): Promise<Record<string, number>> {
    const { date, minutes } = this.minutesIntoSession(closeAt);
    return Object.fromEntries(symbols.map((s) => [s, this.priceAt(s, date, minutes)]));
  }
}

let instance: MarketData | null = null;

export function market(): MarketData {
  if (!instance) {
    const key = process.env.ALPACA_KEY_ID;
    const secret = process.env.ALPACA_SECRET_KEY;
    instance = key && secret ? new AlpacaMarketData(key, secret) : new MockMarketData();
  }
  return instance;
}

export const isMockMarket = () => !(process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY);
