-- Track tapping Play on the home screen, so the funnel shows whether people leave before Play or on the board.

alter table mystery_events drop constraint mystery_events_kind_check;
alter table mystery_events add constraint mystery_events_kind_check check (kind in ('open', 'play', 'start', 'finish'));

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
  count(distinct e.device) filter (where e.kind = 'open' and f.first_day < e.puzzle_date)  as returning,
  count(distinct e.device) filter (where e.kind = 'play')                                  as tapped_play
from ev e join first_seen f using (device)
group by e.puzzle_date
order by e.puzzle_date desc;
