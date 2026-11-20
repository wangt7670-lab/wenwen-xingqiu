begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wenwen-documents-v4', 'wenwen-documents-v4', false, 3145728,
  array['text/plain','text/markdown','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'wenwen-documents-v4'
             and (public or file_size_limit is distinct from 3145728)) then
    raise exception 'Document bucket must be private and limited to 3 MiB';
  end if;
end $$;

drop policy if exists wenwen_documents_server_only on storage.objects;
create policy wenwen_documents_server_only on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'wenwen-documents-v4')
  with check (bucket_id <> 'wenwen-documents-v4');

create table if not exists public.quiz_documents (
  id uuid primary key,
  room_code text not null references public.quiz_rooms(code) on delete restrict,
  owner_id uuid not null,
  title text not null check (length(title) between 1 and 120),
  kind text not null check (kind in ('txt','md','pdf','docx')),
  bytes integer not null check (bytes between 1 and 3145728),
  state text not null default 'pending' check (state in ('pending','ready','deleting')),
  sections jsonb not null default '[]' check (jsonb_typeof(sections) = 'array'),
  created_at timestamptz not null default now(),
  unique (id, room_code, owner_id)
);
create index if not exists quiz_documents_owner on public.quiz_documents(room_code, owner_id, created_at);

create table if not exists public.quiz_library_questions (
  id uuid primary key,
  room_code text not null references public.quiz_rooms(code) on delete cascade,
  owner_id uuid not null,
  document_id uuid,
  fingerprint text not null,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  created_at timestamptz not null default now(),
  unique (room_code, fingerprint),
  foreign key (document_id, room_code, owner_id) references public.quiz_documents(id, room_code, owner_id) on delete cascade
);
create index if not exists quiz_library_question_source on public.quiz_library_questions(document_id);

create table if not exists public.quiz_challenges (
  room_code text primary key references public.quiz_rooms(code) on delete cascade,
  version bigint not null default 1,
  state jsonb not null check (jsonb_typeof(state) = 'object')
);

alter table public.quiz_documents enable row level security;
alter table public.quiz_library_questions enable row level security;
alter table public.quiz_challenges enable row level security;
revoke all on public.quiz_documents, public.quiz_library_questions, public.quiz_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.quiz_documents, public.quiz_library_questions, public.quiz_challenges to service_role;

create or replace function public.reserve_quiz_document(document jsonb)
returns boolean language plpgsql security invoker set search_path = ''
as $$
declare
  entry public.quiz_documents;
begin
  entry := jsonb_populate_record(null::public.quiz_documents, document);
  perform pg_advisory_xact_lock(973281, 1);
  if (select count(*) from public.quiz_documents where room_code = entry.room_code) >= 6
     or (select coalesce(sum(bytes), 0) from public.quiz_documents) + entry.bytes > 262144000 then
    return false;
  end if;
  insert into public.quiz_documents(id, room_code, owner_id, title, kind, bytes)
    values (entry.id, entry.room_code, entry.owner_id, entry.title, entry.kind, entry.bytes);
  return true;
end $$;

create or replace function public.save_quiz_library_question(question jsonb)
returns text language plpgsql security invoker set search_path = ''
as $$
declare
  entry public.quiz_library_questions;
begin
  entry := jsonb_populate_record(null::public.quiz_library_questions, question);
  perform pg_advisory_xact_lock(973281, 2);
  if (select count(*) from public.quiz_library_questions where room_code = entry.room_code) >= 100
     or (select count(*) from public.quiz_library_questions) >= 20000 then return 'limit'; end if;
  if entry.document_id is not null then
    perform 1 from public.quiz_documents where id = entry.document_id
      and room_code = entry.room_code and owner_id = entry.owner_id and state = 'ready' for share;
    if not found then return 'missing'; end if;
  end if;
  insert into public.quiz_library_questions(id, room_code, owner_id, document_id, fingerprint, content)
    values (entry.id, entry.room_code, entry.owner_id, entry.document_id, entry.fingerprint, entry.content)
    on conflict (room_code, fingerprint) do nothing;
  if not found then return 'duplicate'; end if;
  return 'ok';
end $$;

create or replace function public.quiz_documents_for_cleanup()
returns table (id uuid, room_code text) language sql security invoker set search_path = ''
as $$
  select d.id, d.room_code from public.quiz_documents d
  join public.quiz_rooms r on r.code = d.room_code
  where r.expires_at < now() - interval '1 day'
    or (d.state = 'pending' and d.created_at < now() - interval '1 hour')
  order by d.created_at limit 40;
$$;

revoke all on function public.reserve_quiz_document(jsonb), public.save_quiz_library_question(jsonb),
  public.quiz_documents_for_cleanup() from public, anon, authenticated;
grant execute on function public.reserve_quiz_document(jsonb), public.save_quiz_library_question(jsonb),
  public.quiz_documents_for_cleanup() to service_role;
grant select on public.quiz_rooms to service_role;

commit;
