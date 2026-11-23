begin;

create table if not exists public.quiz_word_games (
  room_code text primary key references public.quiz_rooms(code) on delete cascade,
  version bigint not null default 1 check (version > 0),
  state jsonb check (jsonb_typeof(state) = 'object')
);

alter table public.quiz_word_games enable row level security;
revoke all on public.quiz_word_games from public, anon, authenticated;
grant select, insert, update on public.quiz_word_games to service_role;

commit;
