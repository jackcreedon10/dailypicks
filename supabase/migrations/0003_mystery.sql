-- Mystery Stock: one finished puzzle per player per day.

create table mystery_plays (
  puzzle_date date not null,
  player_id   uuid not null references players (id) on delete cascade,
  guesses     text[] not null,
  solved      boolean not null,
  created_at  timestamptz not null default now(),
  primary key (puzzle_date, player_id)
);

create index mystery_plays_player on mystery_plays (player_id, puzzle_date desc);

alter table mystery_plays enable row level security;
