-- Players split their $100,000 across the three stocks however they like.
-- entries.allocs is parallel to entries.symbols (whole dollars); legs.alloc is the same
-- amount per leg, used for scoring. Return = dollar-weighted average of leg returns.

alter table entries add column allocs int[];
update entries set allocs = array[33334, 33333, 33333] where allocs is null;
alter table entries alter column allocs set not null;
alter table entries add constraint entries_allocs_check
  check (cardinality(allocs) = 3 and allocs[1] + allocs[2] + allocs[3] = 100000
         and allocs[1] > 0 and allocs[2] > 0 and allocs[3] > 0);

alter table legs add column alloc numeric;
update legs l set alloc = e.allocs[array_position(e.symbols, l.symbol)]
from entries e where e.trade_date = l.trade_date and e.player_id = l.player_id and l.alloc is null;
alter table legs alter column alloc set not null;
alter table legs add constraint legs_alloc_check check (alloc > 0);

create or replace function refresh_standings(p_date date)
returns int
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  insert into standings (trade_date, player_id, return_pct, rank, field_size, updated_at)
  select p_date, s.player_id, s.ret,
         rank() over (order by s.ret desc),
         count(*) over (),
         now()
  from (
    select l.player_id,
           sum(l.alloc * coalesce(q.last_price / nullif(l.base_price, 0) - 1, 0)) / sum(l.alloc) as ret
    from legs l
    left join quotes q on q.trade_date = l.trade_date and q.symbol = l.symbol
    where l.trade_date = p_date
    group by l.player_id
  ) s
  on conflict (trade_date, player_id) do update
    set return_pct = excluded.return_pct,
        rank       = excluded.rank,
        field_size = excluded.field_size,
        updated_at = excluded.updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function settle_game(p_date date)
returns int
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  perform 1 from games where trade_date = p_date and status <> 'settled' for update;
  if not found then
    return 0;
  end if;

  update legs l
  set final_price = coalesce(q.close_price, q.last_price, l.base_price),
      base_price  = coalesce(l.base_price, q.open_price, q.close_price, q.last_price)
  from quotes q
  where l.trade_date = p_date and q.trade_date = p_date and q.symbol = l.symbol;

  insert into results (trade_date, player_id, return_pct, rank, field_size)
  select p_date, s.player_id, s.ret,
         rank() over (order by s.ret desc),
         count(*) over ()
  from (
    select l.player_id,
           sum(l.alloc * coalesce(l.final_price / nullif(l.base_price, 0) - 1, 0)) / sum(l.alloc) as ret
    from legs l
    where l.trade_date = p_date
    group by l.player_id
  ) s
  on conflict do nothing;
  get diagnostics n = row_count;

  update games set status = 'settled', settled_at = now() where trade_date = p_date;
  return n;
end;
$$;

-- day_board gains an allocs column, so it has to be dropped and recreated.
drop function day_board(date, uuid, uuid, int);
create function day_board(
  p_date date,
  p_group uuid default null,
  p_player uuid default null,
  p_limit int default 50
)
returns table (
  rank          bigint,
  player_id     uuid,
  nickname      text,
  return_pct    numeric,
  symbols       text[],
  allocs        int[],
  late          boolean,
  field_size    bigint,
  global_rank   int,
  global_field  int
)
language sql stable
set search_path = public
as $$
  with g as (
    select status = 'settled' as settled, close_at from games where trade_date = p_date
  ),
  src as (
    select r.player_id, r.return_pct, r.rank, r.field_size
    from results r where r.trade_date = p_date and (select settled from g)
    union all
    select s.player_id, s.return_pct, s.rank, s.field_size
    from standings s where s.trade_date = p_date and not (select settled from g)
  ),
  scoped as (
    select * from src
    where p_group is null or src.player_id in (
      select gm.player_id from group_members gm
      where gm.group_id = p_group
        and (not (select settled from g) or gm.joined_at <= (select close_at from g)))
  ),
  ranked as (
    select
      case when p_group is null then s.rank::bigint
           else rank() over (order by s.return_pct desc) end as scope_rank,
      count(*) over () as scope_field,
      s.*
    from scoped s
  )
  select r.scope_rank, r.player_id, p.nickname, r.return_pct, e.symbols, e.allocs,
         e.entered_at is not null, r.scope_field, r.rank, r.field_size
  from ranked r
  join players p on p.id = r.player_id
  join entries e on e.trade_date = p_date and e.player_id = r.player_id
  where r.scope_rank <= p_limit or r.player_id = p_player
  order by r.scope_rank, p.nickname;
$$;

revoke execute on function refresh_standings, day_board, settle_game from public, anon, authenticated;
