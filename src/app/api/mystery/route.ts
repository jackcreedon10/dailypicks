import { authPlayer } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { MAX_GUESSES, answerFor, hasHints, practiceDate, puzzleNumber, stats, today, yearChart } from "@/lib/mystery";

/** Today's puzzle: the unlabeled 1-year chart and the optional sector hint. Plus your record and today's guesses, if any. */
export const GET = handle(async (req: Request) => {
  const date = practiceDate(new URL(req.url).searchParams.get("day")) ?? today();
  const answer = await answerFor(date, date !== today());
  const me = await authPlayer(req);
  const [chart, mine, record] = await Promise.all([
    yearChart(answer.symbol, date),
    me
      ? db().from("mystery_plays").select("guesses").eq("puzzle_date", date).eq("player_id", me.id).maybeSingle()
      : Promise.resolve({ data: null }),
    me ? stats(me.id, date) : Promise.resolve(null),
  ]);
  return json({
    date,
    number: puzzleNumber(date),
    maxGuesses: MAX_GUESSES,
    chart,
    sector: answer.sector,
    hasHints: hasHints(answer.symbol),
    finishedGuesses: (mine.data as { guesses: string[] } | null)?.guesses ?? null,
    streak: record?.streak ?? 0,
    played: record?.played ?? 0,
  });
});
