-- Production scheduler: Supabase pg_cron calls the tick endpoint every 30 seconds.
-- Run once in the Supabase SQL editor after deploying the site. Replace the two placeholders.
-- (Not a migration because it contains your deployment URL and secret.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<CRON_SECRET>', 'cron_secret');

select cron.schedule(
  'daily-picks-tick',
  '30 seconds',
  $$
  select net.http_post(
    url := 'https://<YOUR-SITE>/api/cron/tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $$
);

-- Housekeeping: drop intraday ticks older than 30 days (results and legs are kept forever).
select cron.schedule(
  'daily-picks-prune-ticks',
  '0 9 * * *',
  $$ delete from ticks where trade_date < current_date - 30 $$
);

-- To stop: select cron.unschedule('daily-picks-tick');
