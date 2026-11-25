import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const admin='e4aae765-9b8d-4639-ac27-5976ef180001';
const partner='e4aae765-9b8d-4639-ac27-5976ef180002';
const outsider='e4aae765-9b8d-4639-ac27-5976ef180003';
const fixtures=[
  {row:2,content:{prompt:'先 出發',answer:'參考答案甲',series:'野餐',sequence:1}},
  {row:3,content:{prompt:'先出發',answer:'後匯入',series:'野餐',sequence:1}},
  {row:4,content:{prompt:'到達終點',answer:'參考答案乙',series:'野餐',sequence:2}},
  {row:5,content:{prompt:'缺乏參考答案'}},
  {row:6,content:{prompt:'重複順序',answer:'已佔用',series:'野餐',sequence:2}}
];

test('database enforces membership, administrator operations, idempotent imports, ordered play, and private audio',async()=>{
  const db=new PGlite();
  const audioKey=partner+'/7ebeccbc-0727-4a58-89f1-7c2797736747';
  try {
    await db.exec(`create role anon; create role authenticated;
     create schema auth; create table auth.users(id uuid primary key);
     create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
     create schema storage; create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
     create table storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;
     insert into auth.users values ('${admin}'),('${partner}'),('${outsider}');
     create table public.quiz_rooms (code text primary key,payload jsonb); insert into public.quiz_rooms values ('LEGACY22','{"history":["old"]}');`);
    const migration=await readFile(new URL('../supabase/migrations/20261125020000_v5.sql',import.meta.url),'utf8');
    await db.exec(migration);
    await db.query('insert into public.v5_members values ($1,1,\'甲\',true),($2,2,\'乙\',false)',[admin,partner]);
    const as=(user,statement,values=[])=>db.transaction(async tx=>{
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
      return (await tx.query(statement,values)).rows;
    });
    const rpc=async(user,sql,values=[]) => (await as(user,`select ${sql} as result`,values))[0].result;
    const importRows=(user,kind,rows,publish)=>rpc(user,'public.v5_import($1,$2::jsonb,$3)',[kind,JSON.stringify(rows),publish]);
    const view=user=>rpc(user,'public.v5_board()');
    const interact=(user,action,args)=>rpc(user,'public.v5_interact($1,$2::jsonb)',[action,JSON.stringify(args)]);
    await assert.rejects(view(outsider),{code:'PT403'});
    await assert.rejects(as(partner,'select * from public.v5_catalog'),{code:'42501'});
    await assert.rejects(rpc(partner,"public.v5_admin_catalog('quiz')"),{code:'PT403'});
    await assert.rejects(importRows(partner,'quiz',fixtures,true),{code:'PT403'});
    assert.deepEqual(await as(outsider,'select * from public.v5_clock'),[]);
    const preview=await importRows(admin,'quiz',fixtures,false);
    assert.deepEqual(preview.rows.map(row=>row.status),['new','duplicate','new','error','error']);
    assert.equal((await view(partner)).catalog.length,0);
    const published=await importRows(admin,'quiz',fixtures,true);
    assert.equal(published.added,2);
    const again=await importRows(admin,'quiz',fixtures,true);
    assert.equal(again.added,0);
    assert.deepEqual(again.rows.filter(row=>row.status==='duplicate').map(row=>row.row),[2,3,4]);
    const catalog=await rpc(admin,"public.v5_admin_catalog('quiz')");
    const {id:first}=catalog[0];
    const {id:second}=catalog[1];
    assert.deepEqual((await view(partner)).catalog.map(row=>row.id),[first]);
    assert.equal((await view(partner)).catalog[0].content.answer,undefined);
    await assert.rejects(interact(admin,'send',{kind:'quiz',catalog_id:second}),{code:'PT409'});
    const work=await interact(admin,'send',{kind:'quiz',catalog_id:first});
    assert.equal((await view(partner)).threads[0].snapshot.answer,undefined);
    await assert.rejects(rpc(partner,"public.v5_edit($1,1,'deleted')",[first]),{code:'PT403'});
    await rpc(admin,"public.v5_edit($1,1,'edit',$2::jsonb)",[first,JSON.stringify({...fixtures[0].content,answer:'新參考答案'})]);
    await assert.rejects(interact(admin,'submit',{thread_id:work,mode:'answer',text:'不是我答'}),{code:'PT409'});
    await interact(partner,'submit',{thread_id:work,mode:'answer',text:'測試回答'});
    const resolved=(await view(partner)).threads[0];
    assert.equal(resolved.snapshot.answer,'參考答案甲');
    assert.deepEqual((await view(partner)).catalog.map(row=>row.id),[second]);
    await interact(admin,'favorite',{thread_id:work,submission_id:resolved.submissions[0].id,saved:true});
    await interact(admin,'message',{thread_id:work,mode:'followup',text:'後來怎樣？'});
    assert.equal((await view(admin)).threads[0].submissions[0].favorite,true);
    assert.equal((await view(partner)).threads[0].messages[0].body,'後來怎樣？');

    const training=await importRows(admin,'performance',[
      {row:2,content:{prompt:'加上一段故事',ability:'講故事',seconds:120}},
      {row:3,content:{prompt:'不支援的類型',ability:'其他'}}
    ],true);
    assert.equal(training.added,1);
    assert.equal(training.errors,1);
    const task=await interact(admin,'send',{kind:'performance',ability:'講故事'});
    await assert.rejects(interact(admin,'submit',{thread_id:task,mode:'relay',text:'太早'}),{code:'PT409'});
    await interact(partner,'submit',{thread_id:task,mode:'relay',text:'從前有一天'});
    await interact(admin,'submit',{thread_id:task,mode:'relay',text:'繼續發生的事'});
    assert.equal(await rpc(partner,"public.v5_audio_owner($1,'version')",[task]),partner);
    await db.query("insert into storage.objects values ('v5-performance-audio',$1)",[audioKey]);
    await interact(partner,'submit',{thread_id:task,mode:'version',audio:audioKey});
    await interact(partner,'submit',{thread_id:task,mode:'version',text:'第二版表演'});
    const versions=(await view(admin)).threads.find(row=>row.id===task).submissions;
    assert.deepEqual(versions.map(row=>row.mode),['relay','relay','version','version']);
    assert.equal(versions[2].audio_key,undefined);
    assert.equal(versions[2].has_audio,true);
    assert.equal(await rpc(admin,'public.v5_audio_path($1)',[versions[2].id]),audioKey);
    await assert.rejects(rpc(outsider,'public.v5_audio_path($1)',[versions[2].id]),{code:'PT403'});
    await interact(admin,'message',{thread_id:task,submission_id:versions[2].id,mode:'feedback',text:'節奏不錯'});
    assert.equal((await view(partner)).threads.find(row=>row.id===task).messages[0].body,'節奏不錯');
    assert.deepEqual((await db.query("select payload from public.quiz_rooms where code='LEGACY22'")).rows[0].payload,{history:['old']});
  } finally {await db.close();}
});
