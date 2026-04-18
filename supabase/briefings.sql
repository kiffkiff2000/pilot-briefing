-- Run this in the Supabase SQL editor (or via migration) to create the briefings table.

create table if not exists public.briefings (
  id uuid primary key default gen_random_uuid(),
  departure text not null,
  destination text not null,
  alternates text,
  briefing_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists briefings_created_at_idx on public.briefings (created_at desc);

-- Optional: allow public read for dashboard demos (tighten in production).
-- alter table public.briefings enable row level security;
-- create policy "Allow service role full access" on public.briefings for all using (true) with check (true);
