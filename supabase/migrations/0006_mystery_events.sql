-- Tickr Guesser funnel: one row per device, per puzzle day, per step (opened the page, made a first guess, finished).
-- mystery_plays only records finished games and players only exist after a first guess, so without this we can't
-- see people who open the page and leave, or who start a puzzle and quit.

create table mystery_events (
  puzzle_date date not null,
  device      text not null,                 -- random id kept in the browser's localStorage
  kind        text not null check (kind in ('open', 'start', 'finish')),
  player_id   uuid references players (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (puzzle_date, device, kind)
);

alter table mystery_events enable row level security;

-- One row per puzzle day: how many devices opened, started and finished, and how many had opened on an earlier day.
-- Devices that ever played as one of your own players are left out.
create or replace view daily_funnel with (security_invoker = true) as
with owner_devices as (
  select distinct e.device
  from mystery_events e join players p on p.id = e.player_id
  where p.is_owner
),
ev as (
  select * from mystery_events where device not in (select device from owner_devices)
),
first_seen as (
  select device, min(puzzle_date) as first_day from ev group by device
)
select
  e.puzzle_date,
  (e.puzzle_date - date '2026-10-02') + 1                                                  as puzzle_number,
  count(distinct e.device) filter (where e.kind = 'open')                                  as opened,
  count(distinct e.device) filter (where e.kind = 'start')                                 as started,
  count(distinct e.device) filter (where e.kind = 'finish')                                as finished,
  count(distinct e.device) filter (where e.kind = 'open' and f.first_day < e.puzzle_date)  as returning
from ev e join first_seen f using (device)
group by e.puzzle_date
order by e.puzzle_date desc;
