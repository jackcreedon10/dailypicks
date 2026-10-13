import { BRACKETS } from "./brackets";

// Tickr Guesser guess cards: industry, size, founded, HQ. Green only when it truly matches.
// Shared by the server (scoring guesses) and the browser (counting which companies still fit your clues).

/** The public facts the cards compare. Nothing here is secret, so the browser gets them for every company. */
export type Facts = {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  /** Stored market cap, so a company's size bracket doesn't change from day to day. */
  cap: number;
  /** Original founding year. */
  founded: number;
  state: string;
};

/** match = green, close = yellow, miss = grey. dir: which way the answer is (size and founded only). */
export type Mark = "match" | "close" | "miss";
export type Card = { value: string; mark: Mark; dir?: "up" | "down" | null };
export type GuessCards = { industry: Card; size: Card; founded: Card; hq: Card };

export const CARD_KEYS = ["industry", "size", "founded", "hq"] as const;

export const bracketOf = (cap: number) => BRACKETS.findIndex((b) => cap >= b.min);

const REGIONS: Record<string, string> = Object.fromEntries(
  Object.entries({
    Northeast: "Connecticut Maine Massachusetts New_Hampshire New_Jersey New_York Pennsylvania Rhode_Island Vermont",
    Midwest: "Illinois Indiana Iowa Kansas Michigan Minnesota Missouri Nebraska North_Dakota Ohio South_Dakota Wisconsin",
    South:
      "Alabama Arkansas D.C. Delaware Florida Georgia Kentucky Louisiana Maryland Mississippi North_Carolina Oklahoma South_Carolina Tennessee Texas Virginia West_Virginia",
    West: "Alaska Arizona California Colorado Hawaii Idaho Montana Nevada New_Mexico Oregon Utah Washington Wyoming",
  }).flatMap(([region, states]) => states.split(" ").map((st) => [st.replace(/_/g, " "), region])),
);
/** US region for a state; anywhere outside the US counts as one "International" region. */
const regionOf = (state: string) => REGIONS[state] ?? "International";

/** Same/one-off/further on an ordered scale, with an arrow toward the answer. */
function scale(guess: number, answer: number, value: string): Card {
  const gap = Math.abs(guess - answer);
  return { value, mark: gap === 0 ? "match" : gap === 1 ? "close" : "miss", dir: gap === 0 ? null : answer > guess ? "up" : "down" };
}

export function cards(g: Facts, a: Facts): GuessCards {
  const gb = bracketOf(g.cap), ab = bracketOf(a.cap);
  const gd = Math.floor(g.founded / 10), ad = Math.floor(a.founded / 10);
  return {
    industry: { value: g.industry, mark: g.industry === a.industry ? "match" : g.sector === a.sector ? "close" : "miss" },
    // Brackets are listed biggest first, so a lower index means bigger: flip for the arrow.
    size: scale(-gb, -ab, BRACKETS[gb].label),
    founded: scale(gd, ad, `${gd * 10}s`),
    hq: { value: g.state, mark: g.state === a.state ? "match" : regionOf(g.state) === regionOf(a.state) ? "close" : "miss" },
  };
}

const sameCard = (x: Card, y: Card) => x.mark === y.mark && (x.dir ?? null) === (y.dir ?? null);

/** Could `c` be the answer? True when every guess so far would have shown exactly the cards it did. */
export const fitsClues = (c: Facts, seen: { guess: Facts; cards: GuessCards }[]) =>
  seen.every(({ guess, cards: got }) => {
    const would = cards(guess, c);
    return CARD_KEYS.every((k) => sameCard(would[k], got[k]));
  });
