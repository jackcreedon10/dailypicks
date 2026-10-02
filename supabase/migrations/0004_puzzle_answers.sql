-- Daily Tickr answers: picked at random the first time a day is played, then fixed forever.
-- Keeps future answers unpredictable (the code is public) and past answers stable.

create table puzzle_answers (
  puzzle_date date primary key,
  symbol      text not null,
  created_at  timestamptz not null default now()
);

alter table puzzle_answers enable row level security;

-- Puzzle #1 was already live with Verizon.
insert into puzzle_answers (puzzle_date, symbol) values ('2026-10-02', 'VZ');
