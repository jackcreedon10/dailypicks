-- Daily Stock Game schema.
-- All access goes through the Next.js server using the service-role key, so RLS is
-- enabled with no policies: the anon/public key can read or write nothing.

create table players (
  id          uuid primary key default gen_random_uuid(),
  nickname    text not null check (char_length(nickname) between 1 and 20),
  token_hash  text not null,
  created_at  timestamptz not null default now()
);

-- Tradable US equities, refreshed daily from the data provider.
create table assets (
  symbol      text primary key,
  name        text not null,
  exchange    text not null,
  updated_at  timestamptz not null default now()
);
create index assets_name_idx on assets using gin (to_tsvector('simple', name));

-- One row per trading day.
create table games (
  trade_date  date primary key,
  open_at     timestamptz not null,
  close_at    timestamptz not null,
  status      text not null default 'scheduled' check (status in ('scheduled', 'live', 'settled')),
  settled_at  timestamptz
);

-- A player's entry for a day. entered_at is null for pre-open picks (baseline = open
-- price); set for late joins (baseline = price at the moment they joined).
create table entries (
  trade_date  date not null references games (trade_date),
  player_id   uuid not null references players (id) on delete cascade,
  symbols     text[] not null check (cardinality(symbols) = 3),
  entered_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (trade_date, player_id)
);
create index entries_player_idx on entries (player_id, trade_date desc);

-- One row per stock in an entry. base_price is the cost basis; final_price is written
-- once at settlement and never recomputed.
create table legs (
  trade_date   date not null,
  player_id    uuid not null,
  symbol       text not null,
  base_price   numeric,
  final_price  numeric,
  primary key (trade_date, player_id, symbol),
  foreign key (trade_date, player_id) references entries (trade_date, player_id) on delete cascade
);
create index legs_symbol_idx on legs (trade_date, symbol);

-- Latest known price per symbol per day (updated every tick).
create table quotes (
  trade_date   date not null,
  symbol       text not null,
  open_price   numeric,
  last_price   numeric,
  close_price  numeric,
  updated_at   timestamptz not null default now(),
  primary key (trade_date, symbol)
);

-- Intraday price history (one row per symbol per minute) for charts.
create table ticks (
  trade_date  date not null,
  symbol      text not null,
  ts          timestamptz not null,
  price       numeric not null,
  primary key (trade_date, symbol, ts)
);

-- Permanent settled results.
create table results (
  trade_date  date not null references games (trade_date),
  player_id   uuid not null references players (id) on delete cascade,
  return_pct  numeric not null,
  rank        int not null,
  field_size  int not null,
  primary key (trade_date, player_id)
);
create index results_rank_idx on results (trade_date, rank);

create table groups (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null check (char_length(name) between 1 and 40),
  created_by  uuid not null references players (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table group_members (
  group_id   uuid not null references groups (id) on delete cascade,
  player_id  uuid not null references players (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (group_id, player_id)
);
create index group_members_player_idx on group_members (player_id);

alter table players       enable row level security;
alter table assets        enable row level security;
alter table games         enable row level security;
alter table entries       enable row level security;
alter table legs          enable row level security;
alter table quotes        enable row level security;
alter table ticks         enable row level security;
alter table results       enable row level security;
alter table groups        enable row level security;
alter table group_members enable row level security;

-- Live global standings, recomputed by the tick job (not per page view) so every player's
-- rank and percentile are cheap to read. Superseded by results once a game settles.
create table standings (
  trade_date  date not null,
  player_id   uuid not null,
  return_pct  numeric not null,
  rank        int not null,
  field_size  int not null,
  updated_at  timestamptz not null default now(),
  primary key (trade_date, player_id),
  foreign key (trade_date, player_id) references entries (trade_date, player_id) on delete cascade
);
create index standings_rank_idx on standings (trade_date, rank);
alter table standings enable row level security;

-- Equal-weighted average of each leg's return vs its base. Legs without a base price yet
-- (pre-open pick, first tick not in) count as 0%.
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
           avg(coalesce(q.last_price / nullif(l.base_price, 0) - 1, 0)) as ret
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

-- Leaderboard for a day, global or one friend group. Reads results once the game is
-- settled, live standings before that. Every row carries the player's global rank and
-- field size (for percentiles) as well as their rank within the requested scope.
-- For settled days a group only counts members who joined before the close, so a
-- crowned winner never changes after the fact.
-- Returns the top p_limit rows (by scope rank) plus the requesting player's row.
create or replace function day_board(
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
  select r.scope_rank, r.player_id, p.nickname, r.return_pct, e.symbols,
         e.entered_at is not null, r.scope_field, r.rank, r.field_size
  from ranked r
  join players p on p.id = r.player_id
  join entries e on e.trade_date = p_date and e.player_id = r.player_id
  where r.scope_rank <= p_limit or r.player_id = p_player
  order by r.scope_rank, p.nickname;
$$;

-- Settle a day exactly once: freeze final prices on legs, write results, mark settled.
-- Expects quotes.close_price to already be populated for the day's symbols.
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
           avg(coalesce(l.final_price / nullif(l.base_price, 0) - 1, 0)) as ret
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

revoke execute on function refresh_standings, day_board, settle_game from public, anon, authenticated;

-- Distinct symbols held by anyone on a day (avoids PostgREST row caps).
create or replace function day_symbols(p_date date)
returns setof text
language sql stable
set search_path = public
as $$
  select distinct symbol from legs where trade_date = p_date;
$$;

-- Pre-open picks get the day's open as their cost basis once it is known.
create or replace function fill_open_bases(p_date date)
returns int
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  update legs l
  set base_price = q.open_price
  from quotes q, entries e
  where l.trade_date = p_date
    and l.base_price is null
    and q.trade_date = p_date and q.symbol = l.symbol and q.open_price is not null
    and e.trade_date = l.trade_date and e.player_id = l.player_id and e.entered_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function day_symbols, fill_open_bases from public, anon, authenticated;
