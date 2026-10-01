// Shapes returned by the API (kept separate so client bundles don't import server code).

export type GameInfo = { date: string; openAt: string; closeAt: string; status: "scheduled" | "live" | "settled"; number: number };

export type Leg = { symbol: string; alloc: number; base: number | null; price: number | null; ret: number };

export type Entry = {
  date: string;
  number: number;
  status: GameInfo["status"];
  symbols: string[];
  allocs: number[];
  late: boolean;
  enteredAt: string | null;
  legs: Leg[];
  ret: number;
  value: number;
  series: { t: string; v: number }[];
  rank: number | null;
  fieldSize: number | null;
};

export type State = {
  now: string;
  mock: boolean;
  me: { id: string; nickname: string } | null;
  live: GameInfo | null;
  upcoming: GameInfo | null;
  last: GameInfo | null;
  liveEntry: Entry | null;
  lastEntry: Entry | null;
  upcomingPicks: { symbols: string[]; allocs: number[] } | null;
  groups: { code: string; name: string }[];
};

export type BoardRow = {
  rank: number;
  playerId: string;
  nickname: string;
  ret: number;
  symbols: string[];
  allocs: number[];
  fieldSize: number;
  globalRank: number;
  globalField: number;
};

export type SharedPicks = {
  nickname: string;
  date: string | null;
  status: GameInfo["status"] | null;
  number: number | null;
  symbols: string[];
  allocs: number[];
  ret: number | null;
  legs: { symbol: string; ret: number }[] | null;
};
