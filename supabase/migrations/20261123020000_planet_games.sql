begin;

create table if not exists public.quiz_planet_questions (
  id text primary key,
  answer_type text not null check (answer_type in ('open', 'yes_no', 'quiz')),
  content jsonb not null check (jsonb_typeof(content) = 'object' and content ? 'id'
    and content ? 'answer_type' and content->>'id' is not distinct from id
    and content->>'answer_type' is not distinct from answer_type)
);

create index if not exists quiz_planet_questions_mode on public.quiz_planet_questions(answer_type, id);

create table if not exists public.quiz_planet_games (
  room_code text primary key references public.quiz_rooms(code) on delete cascade,
  version bigint not null default 1,
  state jsonb not null check (jsonb_typeof(state) = 'object')
);

alter table public.quiz_planet_questions enable row level security;
alter table public.quiz_planet_games enable row level security;
revoke all on public.quiz_planet_questions, public.quiz_planet_games from public, anon, authenticated;
grant select on public.quiz_planet_questions to service_role;
grant select, insert, update on public.quiz_planet_games to service_role;

commit;
