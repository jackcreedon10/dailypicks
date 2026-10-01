# Daily Picks

A daily stock-picking game. Pick 3 US stocks before the opening bell, watch a $100,000 pretend portfolio move all day, and compare with friends on live leaderboards. No accounts.

## Game rules

- Each day every player gets $100,000 to split across 3 stocks however they like (whole $1,000s, at least $1,000 per stock).
- Submitting locks the picks and split for that day; they can't be edited. Picks made before 9:30 AM ET use each stock's opening price as the cost basis.
- Anyone can join while the market is open; they're scored from the price at the moment they locked in.
- Score = dollar-weighted return of the three stocks, shown as points (1% = 100 pts).
- Sharing sends a link (/g/<group>?p=<player>) that shows the sharer's picks and lets the friend make their own; opening it joins the sharer's friend group.
- Stocks must be listed on a US exchange (no OTC) and trade above $1.
- At the close the game settles once: final prices and ranks are written to `results` and never recomputed.
- Holidays and early closes come from the market calendar.

## How it works

```
pg_cron (every 30s) -> POST /api/cron/tick
   - load the trading calendar into `games`
   - refresh the eligible stock list daily (`assets`)
   - while the market is open: snapshot every picked symbol (200 per request)
       -> `quotes` (latest price) + `ticks` (1 row per symbol per minute, for charts)
       -> fill pre-open picks' cost basis with the day's open
   - a minute after the close: last 1-minute bar close -> settle_game() -> `results`

Browser (polls every 30s) -> /api/state, /api/leaderboard
   - live boards: live_board() averages leg returns from `quotes` in SQL
   - settled boards: settled_board() reads `results` only
```

Identity is an anonymous `{id, token}` in localStorage, sent as `Authorization: Player <id>.<token>`. Only a hash of the token is stored. Friend groups are created by sharing: the share link `/g/<code>` joins whoever opens it.

All database access goes through the Next.js server with the Supabase secret key. Row-level security is on with no policies, so the public key can't read or write anything.

## Local setup

1. Copy `.env.example` to `.env.local` and fill in the Supabase URL and secret key, plus a random `CRON_SECRET` (`openssl rand -hex 24`).
2. Apply the files in `supabase/migrations/` to the database, in order.
3. Optional: add Alpaca keys. Without them the game uses simulated prices and a small stock list; set `MOCK_SESSION=00:00-23:59` to play a "live" market at any hour.
4. Run the app and the ticker in two terminals:

```bash
npm run dev
```

```bash
npm run ticker
```

## Production

1. Deploy to Vercel with the same env vars.
2. Run `supabase/schedule.sql` in the Supabase SQL editor (fill in the site URL and `CRON_SECRET`).

## Known limits / next steps

- Alpaca's free feed is IEX-only: prices are real-time but the open/close come from IEX trades, which can differ by a few cents from the official consolidated prints. Upgrading to the SIP feed (`ALPACA_FEED=sip`, paid) fixes that with no code change.
- Player creation isn't rate-limited yet; add an IP rate limit before launch.
- Dynamic share images (OG cards with your score) would help the links spread.
