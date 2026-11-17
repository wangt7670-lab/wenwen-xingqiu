-- Run once in Supabase Dashboard -> SQL Editor.
-- Public-facing browsers never access this table directly;
-- only the Netlify Function with a Supabase Secret Key does.
create table if not exists public.quiz_rooms (
  code text primary key check (code ~ '^[A-Z2-9]{8}$'),
  payload jsonb not null,
  version bigint not null default 1,
  expires_at timestamptz not null default (now() + interval '14 days'),
  updated_at timestamptz not null default now()
);

create index if not exists quiz_rooms_expiry_idx on public.quiz_rooms(expires_at);
alter table public.quiz_rooms enable row level security;
revoke all on table public.quiz_rooms from anon, authenticated;
-- No RLS policies for anon/authenticated: browsers cannot read the rooms.
-- `sb_secret_...` is server-side ONLY and bypasses RLS.

-- Optional cleanup (manual or schedule via Supabase if desired):
-- delete from public.quiz_rooms where expires_at < now();
