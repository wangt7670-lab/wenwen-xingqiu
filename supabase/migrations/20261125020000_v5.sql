begin;

create table public.v5_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slot smallint not null unique check (slot in (1, 2)),
  display_name text not null check (length(display_name) between 1 and 40),
  is_admin boolean not null default false
);
create table public.v5_catalog (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('quiz','performance')),
  content jsonb not null,
  dedupe_key text not null,
  series_key text,
  sequence_no integer,
  status text not null default 'active' check (status in ('active','disabled','deleted')),
  version integer not null default 1,
  unique(kind,dedupe_key)
);
create unique index v5_catalog_series_order on public.v5_catalog(series_key, sequence_no) where status <> 'deleted' and series_key is not null;

create table public.v5_threads (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.v5_catalog(id),
  sender uuid not null,
  recipient uuid not null,
  kind text not null check (kind in ('quiz','performance')),
  snapshot jsonb not null,
  series_key text,
  sequence_no integer,
  created_at timestamptz not null default now()
);
create unique index v5_series_dispatch_once on public.v5_threads(catalog_id) where series_key is not null;
create table public.v5_submissions (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.v5_threads(id),
  author uuid not null,
  position integer not null,
  mode text not null check (mode in ('answer','version','relay')),
  body text,
  audio_key text unique,
  created_at timestamptz not null default now(),
  unique(thread_id,position),
  check (body is not null or audio_key is not null)
);
create table public.v5_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.v5_threads(id),
  submission_id uuid references public.v5_submissions(id),
  author uuid not null,
  mode text not null check (mode in ('comment','followup','feedback','suggestion')),
  body text not null,
  created_at timestamptz not null default now()
);
create table public.v5_favorites (
  user_id uuid not null,
  submission_id uuid not null references public.v5_submissions(id),
  primary key(user_id,submission_id)
);
create table public.v5_clock (id integer primary key check (id=1), revision bigint not null default 0);
insert into public.v5_clock(id) values (1);

alter table public.v5_members enable row level security;
alter table public.v5_catalog enable row level security;
alter table public.v5_threads enable row level security;
alter table public.v5_submissions enable row level security;
alter table public.v5_messages enable row level security;
alter table public.v5_favorites enable row level security;
alter table public.v5_clock enable row level security;
revoke all on public.v5_members,public.v5_catalog,public.v5_threads,public.v5_submissions,public.v5_messages,public.v5_favorites,public.v5_clock from public, anon, authenticated;
grant select on public.v5_clock to authenticated;

create function public.v5_allowed() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.v5_members where user_id=auth.uid());
$$;
create policy v5_clock_members on public.v5_clock for select to authenticated using ((select public.v5_allowed()));
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.v5_clock;
  end if;
end $$;

create function public.v5_role(require_admin boolean default false) returns text
language plpgsql stable security definer set search_path='' as $$
declare administrator boolean;
begin
  select is_admin into administrator from public.v5_members where user_id=auth.uid();
  if not found or (require_admin and not administrator) then
    raise sqlstate 'PT403' using message='此操作需要私人空間或管理員權限。';
  end if;
  return case when administrator then 'admin' else 'member' end;
end $$;

create function public.v5_key(value text) returns text language sql immutable set search_path='' as $$
  select regexp_replace(lower(normalize(coalesce(value,''),NFKC)), '[[:space:]]+', '', 'g');
$$;

create function public.v5_clean(kind text, row_data jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare
  prompt text := btrim(coalesce(row_data->>'prompt',''));
  answer text := btrim(coalesce(row_data->>'answer',''));
  explanation text := btrim(coalesce(row_data->>'explanation',''));
  series text := btrim(coalesce(row_data->>'series',''));
  ordering text := nullif(btrim(row_data->>'sequence'),'');
  ability text := btrim(coalesce(row_data->>'ability',''));
  seconds text := nullif(btrim(row_data->>'seconds'),'');
  tips text := btrim(coalesce(row_data->>'tips',''));
begin
  if kind is null or kind not in ('quiz','performance') or jsonb_typeof(row_data) is distinct from 'object'
     or length(prompt)>500 or public.v5_key(prompt)='' then
    raise sqlstate 'PT400' using message='題目必填，最多 500 字。';
  end if;
  if kind='quiz' then
    if public.v5_key(answer)='' or length(answer)>3000 or length(explanation)>3000 or length(series)>100 then
      raise sqlstate 'PT400' using message='請填寫參考答案，並檢查文字長度。';
    end if;
    if (public.v5_key(series)<>'') <> (ordering is not null) or (ordering is not null and ordering !~ '^[1-9][0-9]{0,5}$') then
      raise sqlstate 'PT400' using message='連續題組與順序須一起填寫，順序須為正整數。';
    end if;
    return jsonb_build_object('prompt',prompt,'answer',answer,'explanation',explanation,'series',series,'sequence',ordering::integer);
  end if;
  if ability not in ('講故事','幽默感','演講能力') or length(tips)>3000 or (seconds is not null and seconds !~ '^[1-9][0-9]{0,3}$') then
    raise sqlstate 'PT400' using message='請填寫有效的訓練能力與建議時間。';
  end if;
  if seconds::integer>3600 then raise sqlstate 'PT400' using message='建議時間不得超過 3600 秒。'; end if;
  return jsonb_build_object('prompt',prompt,'ability',ability,'seconds',seconds::integer,'tips',tips);
end $$;

create function public.v5_import(p_kind text,p_rows jsonb,p_publish boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  item jsonb;
  content jsonb;
  answer jsonb := '[]';
  seen jsonb := '{}';
  positions jsonb := '{}';
  key text;
  series text;
  seq integer;
  position_key text;
  label text;
  note text;
  total_new integer := 0;
  total_duplicate integer := 0;
  total_error integer := 0;
begin
  perform public.v5_role(true);
  if p_kind is null or p_kind not in ('quiz','performance') or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>500 then
    raise sqlstate 'PT400' using message='每次可導入最多 500 筆。';
  end if;
  if p_publish then perform pg_advisory_xact_lock(31071, 5); end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    label := 'new'; note := ''; content := null;
    begin
      if item ? 'error' then raise sqlstate 'PT400' using message=left(item->>'error',200); end if;
      content := public.v5_clean(p_kind,item->'content');
      key := concat_ws('|',content->>'ability',public.v5_key(content->>'prompt'));
      series := nullif(public.v5_key(content->>'series'),'');
      seq := (content->>'sequence')::integer;
      position_key := series||':'||seq;
      if seen ? key or exists(select 1 from public.v5_catalog c where c.kind=p_kind and c.dedupe_key=key) then
        label := 'duplicate'; note := '題目已存在。';
      elsif series is not null and (positions ? position_key
        or exists(select 1 from public.v5_catalog c where c.series_key=series and c.sequence_no=seq and c.status<>'deleted')
        or exists(select 1 from public.v5_threads t where t.series_key=series and t.sequence_no>=seq)) then
        raise sqlstate 'PT400' using message='題組順序重複，或早於已送出的題目。';
      else
        if p_publish then
          insert into public.v5_catalog(kind,content,dedupe_key,series_key,sequence_no) values(p_kind,content,key,series,seq);
        end if;
        seen := seen||jsonb_build_object(key,true);
        if series is not null then positions := positions||jsonb_build_object(position_key,true); end if;
      end if;
    exception when sqlstate 'PT400' then label := 'error'; note := SQLERRM;
    end;
    total_new := total_new + (label='new')::integer;
    total_duplicate := total_duplicate + (label='duplicate')::integer;
    total_error := total_error + (label='error')::integer;
    answer := answer||jsonb_build_array(jsonb_build_object('row',item->'row','status',label,'note',note,'content',coalesce(content,item->'content')));
  end loop;
  if p_publish and total_new>0 then update public.v5_clock set revision=revision+1 where id=1; end if;
  return jsonb_build_object('rows',answer,'added',total_new,'duplicates',total_duplicate,'errors',total_error);
end $$;

create function public.v5_admin_catalog(p_kind text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform public.v5_role(true);
  if p_kind is null or p_kind not in ('quiz','performance') then raise sqlstate 'PT400' using message='不支援此題庫。'; end if;
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.series_key nulls last,c.sequence_no,c.content->>'prompt')
    from public.v5_catalog c where c.kind=p_kind and c.status<>'deleted'),'[]');
end $$;

create function public.v5_edit(p_id uuid,p_version integer,p_action text,p_content jsonb default null) returns void
language plpgsql security definer set search_path='' as $$
declare row_data public.v5_catalog; clean jsonb; series text; seq integer;
begin
  perform public.v5_role(true);
  perform pg_advisory_xact_lock(31071, 5);
  select * into row_data from public.v5_catalog where id=p_id and status<>'deleted';
  if not found or row_data.version is distinct from p_version then raise sqlstate 'PT409' using message='題目已更新，請重新載入。'; end if;
  if p_action='edit' then
    clean := public.v5_clean(row_data.kind,p_content);
    series := nullif(public.v5_key(clean->>'series'),'');
    seq := (clean->>'sequence')::integer;
    if (series,seq) is distinct from (row_data.series_key,row_data.sequence_no) and (
      exists(select 1 from public.v5_threads where catalog_id=p_id)
      or exists(select 1 from public.v5_threads where series_key=series and sequence_no>=seq)) then
      raise sqlstate 'PT409' using message='已進行的題組須保留原順序。';
    end if;
    update public.v5_catalog set content=clean,dedupe_key=concat_ws('|',clean->>'ability',public.v5_key(clean->>'prompt')),
      series_key=series,sequence_no=seq,version=version+1 where id=p_id;
  elsif p_action in ('active','disabled','deleted') then
    if p_action='active' and row_data.status='disabled' and row_data.series_key is not null and
       not exists(select 1 from public.v5_threads where catalog_id=p_id) and
       exists(select 1 from public.v5_threads where series_key=row_data.series_key and sequence_no>row_data.sequence_no) then
      raise sqlstate 'PT409' using message='這個題組已經進行至後續題目。';
    end if;
    update public.v5_catalog set status=p_action,version=version+1 where id=p_id;
  else raise sqlstate 'PT400' using message='不支援此操作。'; end if;
  update public.v5_clock set revision=revision+1 where id=1;
exception when unique_violation then raise sqlstate 'PT409' using message='題目或題組順序已存在。';
end $$;

create function public.v5_catalog_available() returns setof public.v5_catalog
language sql stable set search_path='' as $$
  select c.* from public.v5_catalog c where c.status='active' and (
    c.series_key is null or (
      not exists(select 1 from public.v5_threads t where t.catalog_id=c.id) and not exists (
        select 1 from public.v5_catalog prior where prior.series_key=c.series_key and prior.sequence_no<c.sequence_no
          and (prior.status='active' or exists(select 1 from public.v5_threads t where t.catalog_id=prior.id))
          and not exists(select 1 from public.v5_threads t join public.v5_submissions s on s.thread_id=t.id where t.catalog_id=prior.id)
      )));
$$;

create function public.v5_board(p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare role text := public.v5_role(); actor uuid := auth.uid();
begin
  return jsonb_build_object('me',actor,'role',role,
    'members',(select jsonb_object_agg(user_id,display_name) from public.v5_members),
    'ready',(select count(*)=2 from public.v5_members),
    'catalog',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'content',content-'answer'-'explanation') order by content->>'prompt') from public.v5_catalog_available()),'[]'),
    'total',(select count(*) from public.v5_threads where actor in (sender,recipient)),
    'threads',coalesce((select jsonb_agg(entry order by pending desc, created_at desc, id) from (
      select t.id,t.created_at, not exists(select 1 from public.v5_submissions where thread_id=t.id) and t.recipient=actor as pending,
        to_jsonb(t) || jsonb_build_object(
        'snapshot',case when t.kind='quiz' and not exists(select 1 from public.v5_submissions where thread_id=t.id)
          then t.snapshot-'answer'-'explanation' else t.snapshot end,
        'submissions',coalesce((select jsonb_agg((to_jsonb(s)-'audio_key')||jsonb_build_object('has_audio',s.audio_key is not null,
           'favorite',exists(select 1 from public.v5_favorites f where f.user_id=actor and f.submission_id=s.id)) order by s.position)
           from public.v5_submissions s where s.thread_id=t.id),'[]'),
        'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from public.v5_messages m where m.thread_id=t.id),'[]')) as entry
      from public.v5_threads t where actor in (t.sender,t.recipient)
      order by pending desc,t.created_at desc,t.id limit 30 offset greatest(coalesce(p_offset,0),0)
    ) board),'[]'));
end $$;

create function public.v5_performer(t public.v5_threads,actor uuid,entry_mode text) returns boolean
language sql stable set search_path='' as $$
  select coalesce(t.kind='performance' and (
    (entry_mode='version' and t.recipient=actor) or
    (entry_mode='relay' and t.snapshot->>'ability'='講故事' and actor in (t.recipient,t.sender) and
      case when not exists(select 1 from public.v5_submissions where thread_id=t.id and mode='relay')
        then t.recipient=actor else actor<>(select author from public.v5_submissions where thread_id=t.id and mode='relay' order by position desc limit 1) end)),false);
$$;

create function public.v5_interact(p_action text,p_args jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid(); other_player uuid; selected public.v5_catalog; thread public.v5_threads;
  submission uuid; result uuid; entry_body text := nullif(btrim(p_args->>'text'),'');
  audio text := nullif(p_args->>'audio',''); way text := p_args->>'mode';
begin
  perform public.v5_role();
  perform pg_advisory_xact_lock(31071,5);
  if p_action='send' then
    select user_id into other_player from public.v5_members where user_id<>actor;
    if other_player is null then raise sqlstate 'PT409' using message='請先設定另一位固定帳戶。'; end if;
    select * into selected from public.v5_catalog_available() c where c.kind=p_args->>'kind'
      and (nullif(p_args->>'catalog_id','') is null or c.id=(p_args->>'catalog_id')::uuid)
      and (nullif(p_args->>'ability','') is null or c.content->>'ability'=p_args->>'ability') order by random() limit 1;
    if not found then raise sqlstate 'PT409' using message='目前沒有符合條件可發送的題目，請先完成前面的連續題。'; end if;
    insert into public.v5_threads(catalog_id,sender,recipient,kind,snapshot,series_key,sequence_no)
      values(selected.id,actor,other_player,selected.kind,selected.content,selected.series_key,selected.sequence_no) returning id into result;
  else
    select * into thread from public.v5_threads where id=(p_args->>'thread_id')::uuid and actor in (sender,recipient);
    if not found then raise sqlstate 'PT404' using message='找不到這則互動。'; end if;
    result := thread.id;
    if p_action='submit' then
      if thread.kind='quiz' then
        if thread.recipient<>actor or exists(select 1 from public.v5_submissions where thread_id=thread.id) or audio is not null then
          raise sqlstate 'PT409' using message='這道題已作答，或正在等候另一位玩家。';
        end if;
        way := 'answer';
      elsif not public.v5_performer(thread,actor,way) then
        raise sqlstate 'PT409' using message='請由輪到的玩家繼續表演。';
      end if;
      if (entry_body is null and audio is null) or length(entry_body)>6000 then raise sqlstate 'PT400' using message='請填寫內容，正文最多 6000 字。'; end if;
      if audio is not null and (audio !~ ('^'||actor::text||'/[0-9a-f-]{36}$') or not exists(
        select 1 from storage.objects where bucket_id='v5-performance-audio' and name=audio)) then
        raise sqlstate 'PT400' using message='找不到這段錄音。';
      end if;
      insert into public.v5_submissions(thread_id,author,position,mode,body,audio_key)
        select thread.id,actor,coalesce(max(position),0)+1,way,entry_body,audio from public.v5_submissions where thread_id=thread.id;
    elsif p_action in ('message','favorite') then
      submission := (p_args->>'submission_id')::uuid;
      if submission is not null and not exists(select 1 from public.v5_submissions where id=submission and thread_id=thread.id) then
        raise sqlstate 'PT404' using message='找不到這筆作答。';
      end if;
      if p_action='message' then
        if entry_body is null or length(entry_body)>3000 or way is null or way not in ('comment','followup','feedback','suggestion')
          or (way in ('feedback','suggestion') and (thread.kind<>'performance' or submission is null
            or exists(select 1 from public.v5_submissions where id=submission and author=actor))) then
          raise sqlstate 'PT400' using message='請填寫留言，並為對方的哪個版本提供回饋。';
        end if;
        insert into public.v5_messages(thread_id,submission_id,author,mode,body) values(thread.id,submission,actor,way,entry_body);
      elsif thread.kind<>'quiz' or submission is null or exists(select 1 from public.v5_submissions where id=submission and author=actor) then
        raise sqlstate 'PT400' using message='請選擇對方的一筆回答。';
      elsif p_args->'saved'='true'::jsonb then
        insert into public.v5_favorites(user_id,submission_id) values(actor,submission) on conflict do nothing;
      else delete from public.v5_favorites where user_id=actor and submission_id=submission; end if;
    else raise sqlstate 'PT400' using message='不支援此操作。'; end if;
  end if;
  update public.v5_clock set revision=revision+1 where id=1;
  return result;
exception when invalid_text_representation then raise sqlstate 'PT400' using message='請檢查輸入格式。';
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('v5-performance-audio','v5-performance-audio',false,3145728,array['audio/webm','audio/mp4','audio/ogg']);
create policy v5_server_audio_only on storage.objects as restrictive for all to anon,authenticated
  using (bucket_id<>'v5-performance-audio') with check (bucket_id<>'v5-performance-audio');

create function public.v5_audio_owner(p_thread uuid,p_mode text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare item public.v5_threads;
begin
  perform public.v5_role();
  select * into item from public.v5_threads where id=p_thread and auth.uid() in (sender,recipient);
  if not found or not public.v5_performer(item,auth.uid(),p_mode) then raise sqlstate 'PT403' using message='目前無法為此挑戰錄音。'; end if;
  return auth.uid();
end $$;

create function public.v5_audio_path(p_submission uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare path text;
begin
  perform public.v5_role();
  select s.audio_key into path from public.v5_submissions s join public.v5_threads t on t.id=s.thread_id
    where s.id=p_submission and auth.uid() in (t.sender,t.recipient);
  if path is null then raise sqlstate 'PT404' using message='找不到這段錄音。'; end if;
  return path;
end $$;

revoke all on function public.v5_allowed(),public.v5_role(boolean),public.v5_key(text),public.v5_clean(text,jsonb),
 public.v5_import(text,jsonb,boolean),public.v5_admin_catalog(text),public.v5_edit(uuid,integer,text,jsonb),
 public.v5_catalog_available(),public.v5_board(integer),public.v5_performer(public.v5_threads,uuid,text),
 public.v5_interact(text,jsonb),public.v5_audio_owner(uuid,text),public.v5_audio_path(uuid) from public,anon,authenticated;
grant execute on function public.v5_allowed(),public.v5_role(boolean),public.v5_import(text,jsonb,boolean),
 public.v5_admin_catalog(text),public.v5_edit(uuid,integer,text,jsonb),public.v5_board(integer),
 public.v5_interact(text,jsonb),public.v5_audio_owner(uuid,text),public.v5_audio_path(uuid) to authenticated;

commit;
