begin;

create table if not exists public.quiz_ai_daily_usage (
  usage_day date not null,
  scope_key text not null,
  reserved_questions integer not null default 0 check (reserved_questions >= 0),
  last_reserved_at timestamptz,
  primary key (usage_day, scope_key)
);

alter table public.quiz_ai_daily_usage enable row level security;
revoke all on table public.quiz_ai_daily_usage from public, anon, authenticated;
grant select, insert, update on public.quiz_ai_daily_usage to service_role;

create or replace function public.reserve_quiz_ai(room_code text, question_count integer)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  gate_time timestamptz := clock_timestamp();
  today date := (gate_time at time zone 'UTC')::date;
  global_questions integer;
  room_questions integer;
  room_last_call timestamptz;
begin
  if room_code is null or room_code !~ '^[A-Z2-9]{8}$' or
     question_count is null or question_count not in (1, 5, 10) then
    return 'invalid';
  end if;

  -- Acquire the shared lock first so concurrent functions cannot overspend.
  insert into public.quiz_ai_daily_usage(usage_day, scope_key) values (today, '*')
    on conflict do nothing;
  select reserved_questions into global_questions from public.quiz_ai_daily_usage
    where usage_day = today and scope_key = '*' for update;
  if global_questions + question_count > 300 then return 'global_limit'; end if;

  select reserved_questions into room_questions
    from public.quiz_ai_daily_usage where usage_day = today and scope_key = room_code;
  if coalesce(room_questions, 0) + question_count > 30 then return 'room_limit'; end if;
  select max(last_reserved_at) into room_last_call from public.quiz_ai_daily_usage
    where usage_day in (today, today - 1) and scope_key = room_code;
  if room_last_call > gate_time - interval '40 seconds' then return 'cooldown'; end if;

  insert into public.quiz_ai_daily_usage(usage_day, scope_key, reserved_questions, last_reserved_at)
    values (today, room_code, question_count, gate_time)
    on conflict (usage_day, scope_key) do update
      set reserved_questions = quiz_ai_daily_usage.reserved_questions + excluded.reserved_questions,
          last_reserved_at = excluded.last_reserved_at;
  update public.quiz_ai_daily_usage set reserved_questions = reserved_questions + question_count
    where usage_day = today and scope_key = '*';
  return 'ok';
end;
$$;

revoke all on function public.reserve_quiz_ai(text, integer) from public, anon, authenticated;
grant execute on function public.reserve_quiz_ai(text, integer) to service_role;

commit;
