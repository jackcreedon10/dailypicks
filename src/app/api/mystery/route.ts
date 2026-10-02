import { authPlayer } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { MAX_GUESSES, answerFor, hints, puzzleNumber, today, yearChart } from "@/lib/mystery";

/** Today's puzzle: the unlabeled 1-year chart and the starting clue. Plus your guesses, if you already finished. */
export const GET = handle(async (req: Request) => {
  const date = today();
  const answer = answerFor(date);
  const me = await authPlayer(req);
  const [chart, mine] = await Promise.all([
    yearChart(answer.symbol, date),
    me
      ? db().from("mystery_plays").select("guesses").eq("puzzle_date", date).eq("player_id", me.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return json({
    date,
    number: puzzleNumber(date),
    maxGuesses: MAX_GUESSES,
    chart,
    hints: hints(answer, 0),
    finishedGuesses: (mine.data as { guesses: string[] } | null)?.guesses ?? null,
  });
});
