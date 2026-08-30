-- Term Board storage.
--
-- Two tables, split by size and by how often they are read:
--
--   term_board_snapshots  one row per scrape. Small. The widget reads the
--                         latest row on every refresh.
--   term_board_readings   extracted instruction and reading text, one row per
--                         assignment. Large. Read only when a conversation is
--                         started.
--
-- Both are private. Row-level security scopes every row to the owning user, so
-- the publishable anon key the widget ships with grants nothing on its own —
-- the widget has to be signed in as Richard, exactly like wazn-review.js.

create table if not exists public.term_board_snapshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  term_id      text not null,
  scraped_at   timestamptz not null default now(),
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);

create index if not exists term_board_snapshots_latest
  on public.term_board_snapshots (user_id, term_id, scraped_at desc);

create table if not exists public.term_board_readings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  term_id        text not null,
  assignment_id  text not null,
  course         text not null,
  title          text not null,
  bodies         jsonb not null,
  chars          integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (user_id, term_id, assignment_id)
);

create index if not exists term_board_readings_lookup
  on public.term_board_readings (user_id, term_id, assignment_id);

alter table public.term_board_snapshots enable row level security;
alter table public.term_board_readings  enable row level security;

-- Owner-only access. Written as four explicit policies rather than one FOR ALL
-- so that a future read-only role can be granted select without also gaining
-- insert.
do $$
begin
  if not exists (select 1 from pg_policies
                 where tablename = 'term_board_snapshots' and policyname = 'snapshots_select_own') then
    create policy snapshots_select_own on public.term_board_snapshots
      for select using (auth.uid() = user_id);
    create policy snapshots_insert_own on public.term_board_snapshots
      for insert with check (auth.uid() = user_id);
    create policy snapshots_update_own on public.term_board_snapshots
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy snapshots_delete_own on public.term_board_snapshots
      for delete using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies
                 where tablename = 'term_board_readings' and policyname = 'readings_select_own') then
    create policy readings_select_own on public.term_board_readings
      for select using (auth.uid() = user_id);
    create policy readings_insert_own on public.term_board_readings
      for insert with check (auth.uid() = user_id);
    create policy readings_update_own on public.term_board_readings
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy readings_delete_own on public.term_board_readings
      for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Keep the table from growing without bound; thirty snapshots is a month of
-- daily history, which is plenty to answer "when did that grade change?".
create or replace function public.prune_term_board_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.term_board_snapshots
  where user_id = new.user_id
    and term_id = new.term_id
    and id not in (
      select id from public.term_board_snapshots
      where user_id = new.user_id and term_id = new.term_id
      order by scraped_at desc
      limit 30
    );
  return null;
end $$;

drop trigger if exists prune_term_board_snapshots on public.term_board_snapshots;
create trigger prune_term_board_snapshots
  after insert on public.term_board_snapshots
  for each row execute function public.prune_term_board_snapshots();
