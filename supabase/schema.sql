-- Run once in the Supabase SQL editor (Project -> SQL Editor -> New query).
-- Players can only INSERT their own finished game. Only the admin login can read anything.

create table if not exists public.results (
  id             bigint generated always as identity primary key,
  player_id      text        not null check (char_length(player_id) between 8 and 64),
  puzzle_number  int         not null check (puzzle_number >= 1),
  difficulty     text        not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  status         text        not null check (status in ('won', 'gaveup')),
  guesses        int         not null check (guesses between 0 and 200),
  par            int         not null check (par between 1 and 50),
  start          text        not null check (char_length(start) <= 8),
  target         text        not null check (char_length(target) <= 8),
  route          jsonb       not null default '[]',
  created_at     timestamptz not null default now(),
  unique (player_id, puzzle_number, difficulty)
);

-- Upgrading a table created before the three daily difficulties existed (safe to run again):
alter table public.results add column if not exists difficulty text not null default 'medium'
  check (difficulty in ('easy', 'medium', 'hard'));
alter table public.results drop constraint if exists results_player_id_puzzle_number_key;
do $$ begin
  alter table public.results add constraint results_player_puzzle_difficulty_key unique (player_id, puzzle_number, difficulty);
exception when duplicate_table or duplicate_object then null; end $$;

alter table public.results enable row level security;

drop policy if exists "players can submit a result" on public.results;
create policy "players can submit a result" on public.results
  for insert to anon, authenticated with check (true);

-- Replace YOUR_ADMIN_EMAIL with the email of the user you create under Authentication -> Users.
drop policy if exists "admin can read results" on public.results;
create policy "admin can read results" on public.results
  for select to authenticated using ((auth.jwt() ->> 'email') = 'YOUR_ADMIN_EMAIL');

grant insert on public.results to anon, authenticated;
grant select on public.results to authenticated;
