-- À coller dans Supabase → SQL Editor → Run

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  name text not null,
  icon text not null default 'circle',
  accent text not null,
  accent_bg text not null,
  status_labels text[] not null default array['À faire','Fait'],
  field_template text not null default 'none',
  sort_order integer not null default 0,
  unique (user_id, key)
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_key text not null,
  title text not null,
  description text default '',
  url text default '',
  extra text default '',
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.collections enable row level security;
alter table public.items enable row level security;

create policy "own collections" on public.collections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own items" on public.items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime (pour la synchro live entre appareils)
alter publication supabase_realtime add table public.collections;
alter publication supabase_realtime add table public.items;
