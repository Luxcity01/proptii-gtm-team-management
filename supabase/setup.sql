-- Proptii 30-day tracker: run once in Supabase → SQL Editor → New query → Run.
-- Safe to run again; it only creates what is missing.

create table if not exists public.state (
  key        text primary key,
  value      jsonb not null,
  client     text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);

-- Record when and by whom each value was last changed.
create or replace function public.state_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists state_touch on public.state;
create trigger state_touch before insert or update on public.state
  for each row execute function public.state_touch();

-- Only signed-in team members can read or change anything. Anonymous visitors get nothing.
alter table public.state enable row level security;

drop policy if exists "team can read"   on public.state;
drop policy if exists "team can insert" on public.state;
drop policy if exists "team can update" on public.state;
drop policy if exists "team can delete" on public.state;
create policy "team can read"   on public.state for select to authenticated using (true);
create policy "team can insert" on public.state for insert to authenticated with check (true);
create policy "team can update" on public.state for update to authenticated using (true) with check (true);
create policy "team can delete" on public.state for delete to authenticated using (true);

revoke all on public.state from anon;
grant select, insert, update, delete on public.state to authenticated;

-- Push every change to everyone who has the page open.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'state'
  ) then
    alter publication supabase_realtime add table public.state;
  end if;
end $$;
