import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError, fail, readBody, str, UUID } from './http.mjs';
import { builtInDrafts, TOPICS, validOptions } from './rules.mjs';
import { getRoomQuestions, handleLibrary } from './library.mjs';
import { handleChallenge } from './challenges.mjs';
import { handlePlanetGame } from './planet-games.mjs';
import { handleWordGame } from './five-word-games.mjs';
import { handleV5 } from './v5-api.mjs';
import { backendConfig } from './deployment.mjs';
import { LEVELS, safeSourceUrl, STYLES, validDate } from '../public/question-tools.js';

const ROOM_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

const now = () => Date.now();
const json = (data,status=200) => Response.json(data,{status,headers:API_HEADERS});
const ready = () => Boolean(backendConfig().url && backendConfig().key);
const generatorFlags = () => ({aiEnabled:ready(), ruleGeneration:true, localAiEnabled:process.env.ENABLE_LOCAL_AI==='true'});
const BASE = () => String(backendConfig().url || '').replace(/\/$/,'');
const SECRET = () => String(backendConfig().key || '');

function roomCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(8),v => chars[v % chars.length]).join('');
}
function token() { return randomBytes(24).toString('base64url'); }
function constantEqual(a,b) {
  const aa=Buffer.from(a||''),bb=Buffer.from(b||'');
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}

export async function supabase(method, query='', body, headers={}, resource='quiz_rooms') {
  if(!ready()) fail(503,'線上房間尚未設定 Supabase，請先完成部署設定。');
  const controller = new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9500);
  try {
    const res=await fetch(`${BASE()}/rest/v1/${resource}${query}`, {
      method,
      headers:{
        apikey:SECRET(),
        Accept:'application/json',
        ...(body!==undefined?{'Content-Type':'application/json'}:{}),
        ...headers
      },
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),
      signal:controller.signal
    });
    const text=await res.text();
    let data=null;
    try { data=text?JSON.parse(text):null; } catch { fail(502,'資料庫回傳無效格式，請檢查設定。'); }
    if(!res.ok) {
      if(res.status===409) fail(409,'資料已更新，請重試一次。');
      if(res.status===401 || res.status===403) fail(503,'Supabase Secret Key 無效或沒有權限。');
      if(res.status===404) fail(503,resource==='quiz_rooms'?'找不到 Supabase 資料表，請先執行 schema.sql。':'資料或闖關服務尚未完成資料庫設定。');
      fail(503,'線上資料庫暫時無法使用，請稍後再試。');
    }
    return data;
  } catch(e) {
    if(e.name==='AbortError') fail(504,'Supabase 連線逾時。');
    if(e instanceof ApiError) throw e;
    fail(503,'無法連接 Supabase，請檢查網址和連線。');
  } finally {clearTimeout(timeout)}
}

function view(room,who) {
  const current=room.current?{...room.current}:null;
  if(current&&!current.answered&&current.createdBy!==who) {
    delete current.answerIndex;
    delete current.referenceAnswer;
    delete current.explanation;
    delete current.source_url;
    delete current.source_title;
    delete current.source;
    delete current.publishedDate;
    delete current.eventDate;
  }
  return {code:room.code,players:room.players.map(({id,name,score})=>({id,name,score})),round:room.round,current,history:room.history.slice(-40),updatedAt:room.updatedAt};
}
function auth(request,room) {
  const bearer=str(request.headers.get('authorization')||'',150);
  if(!bearer.startsWith('Bearer ')) fail(401,'請先加入房間');
  const x=bearer.slice(7);
  const p=room.players.find(p=>constantEqual(p.token,x));
  if(!p) fail(403,'房間憑證無效，請重新加入');
  return p;
}
function validateQuestion(q) {
  if(!q||typeof q!=='object'||Array.isArray(q)) fail(400,'題目格式不正確');
  const type=q.type==='open'?'open':'choice';
  const topic=TOPICS.has(q.topic)?q.topic:'couple';
  const question=str(q.question,300);
  if(question.length<2) fail(400,'問題至少需要兩個字');
  const options=type==='choice'?(Array.isArray(q.options)?q.options.map(x=>str(x,120)).slice(0,4):[]):[];
  if(type==='choice'&&(options.length!==4 || options.some(x=>!x))) fail(400,'選擇題需要四個有效選項');
  const answerIndex=Number(q.answerIndex);
  if(type==='choice'&&(!Number.isInteger(answerIndex)||answerIndex<0||answerIndex>3)) fail(400,'正確答案編號無效');
  const source=safeSourceUrl(str(q.source_url,450));
  const isReviewedAI=q.origin==='ai' && q.reviewState!==undefined;
  if(isReviewedAI) {
    if(q.reviewState!=='approved') fail(400,'請先核可 AI 題目');
    if(type==='choice'&&!validOptions(q.options,q.answerIndex)) fail(400,'請提供四個不同選項和唯一正解');
    if(type==='open'&&topic!=='couple'&&!str(q.referenceAnswer,300)) fail(400,'請填寫參考答案');
    if(!str(q.explanation,600)||!Number.isSafeInteger(q.generatedAt)||q.generatedAt<=0) fail(400,'AI 題目缺少解析或生成時間');
  }
  return {
    id:randomUUID(),topic,type,question,
    tag:str(q.tag,120),options,
    answerIndex:type==='choice'?answerIndex:0,
    referenceAnswer:type==='open'?str(q.referenceAnswer,300):'',
    explanation:str(q.explanation,600),
    source_url:source,
    source_title:str(q.source_title,150),
    origin:['bank','custom','ai','demo-ai','rules','local-ai'].includes(q.origin)?q.origin:'custom',
    ...(Object.hasOwn(LEVELS,q.level)?{level:q.level}:{}),
    ...(Object.hasOwn(STYLES,q.style)?{style:q.style}:{}),
    ...(validDate(q.publishedDate)?{publishedDate:q.publishedDate}:{}),
    ...(validDate(q.eventDate)?{eventDate:q.eventDate}:{}),
    ...(isReviewedAI?{reviewState:'used',generatedAt:q.generatedAt}:{}),
    createdAt:now(),answered:false,answerBy:null,answerText:null,selectedIndex:null,isCorrect:null
  };
}

async function load(code) {
  if(!/^[A-Z2-9]{8}$/.test(code)) fail(400,'房間碼格式不正確');
  const rows=await supabase('GET',`?code=eq.${code}&select=code,payload,version,expires_at&limit=1`);
  const row=rows?.[0];
  if(!row||Date.parse(row.expires_at)<now()) fail(404,'房間不存在或已過期');
  if(!row.payload?.players) fail(503,'房間資料格式異常');
  return row;
}
async function createRoom(name) {
  for(let attempt=0;attempt<6;attempt++) {
    const code=roomCode(),id=randomUUID(),t=token();
    const room={code,players:[{id,name,token:t,score:0}],current:null,history:[],round:1,updatedAt:now(),createdAt:now(),aiCalls:0};
    const row={code,payload:room,version:1,expires_at:new Date(now()+ROOM_TTL_MS).toISOString(),updated_at:new Date().toISOString()};
    try {
      const data=await supabase('POST','?select=code',row,{'Prefer':'return=representation'});
      if(data?.[0]?.code===code) return {room,playerId:id,token:t};
    } catch(e) {if(e.status===409) continue;throw e}
  }
  fail(503,'無法建立房間，請稍後重試。');
}
async function mutate(code, fn) {
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++) {
    const row=await load(code);
    const room=structuredClone(row.payload);
    const result=await fn(room);
    room.updatedAt=now();
    const filter=`?code=eq.${code}&version=eq.${row.version}&select=code,version`;
    const changed=await supabase('PATCH',filter,{
      payload:room,version:Number(row.version)+1,
      updated_at:new Date().toISOString(),
      expires_at:new Date(now()+ROOM_TTL_MS).toISOString()
    },{'Prefer':'return=representation'});
    if(Array.isArray(changed)&&changed.length===1) return {room,result};
    // Concurrent update detected; re-read the latest version and retry.
  }
  fail(409,'另一半正在操作，請重新整理後再試。');
}

async function generateForRoom(request) {
  const body = await readBody(request);
  const code = str(body.room,12).toUpperCase();
  const { payload:room } = await load(code);
  auth(request,room);
  const topic = TOPICS.has(body.topic) ? body.topic : 'science';
  const type = body.type ?? (topic === 'couple' ? 'open' : 'choice');
  const count = body.count ?? 1;
  if (![1,5,10].includes(count) || !['open','choice'].includes(type)) fail(400,'出題設定無效。');
  const recent = Array.isArray(body.recent) ? body.recent.slice(0,60).filter(x=>typeof x==='string'&&x.length<=300) : [];
  const excluded = [...room.history.map(q=>q.question),room.current?.question,...recent].filter(Boolean);
  const questions = builtInDrafts({
    topic,type,count,keywords:str(body.keywords,150),
    level:Object.hasOwn(LEVELS,body.level)?body.level:'',
    style:Object.hasOwn(STYLES,body.style)?body.style:''
  },excluded);
  if (!questions.length && body.count===undefined) fail(422,'沒有符合條件的新題，請改用其他主題。');
  return json({question:questions[0]??null,questions});
}

export async function handleApi(request) {
  const url=new URL(request.url),p=url.pathname,method=request.method.toUpperCase();
  try {
    if(p.startsWith('/api/v5/')) return await handleV5(request,p);
    if(method==='GET'&&p==='/api/health') {
      const deploymentContext=backendConfig().name;
      if(!ready())return json({ok:true,onlineReady:false,deploymentContext,...generatorFlags(),message:'尚未設定此環境的 Supabase 連線'});
      await supabase('GET','?select=code&limit=1');
      return json({ok:true,onlineReady:true,deploymentContext,...generatorFlags(),message:'雙人服務已就緒'});
    }
    if(method==='POST'&&p==='/api/rooms') {
      const body=await readBody(request);
      const {room,playerId,token:authToken}=await createRoom(str(body.name,16)||'我');
      return json({code:room.code,playerId,token:authToken,room:view(room,playerId),...generatorFlags()},201);
    }
    const materials=p.match(/^\/api\/rooms\/([A-Z2-9]{8})\/(documents|library|challenge|planet-game|word-game)(?:\/([a-zA-Z0-9-]{1,36}))?(?:\/([a-z]{1,12}))?$/);
    if(materials) {
      const [,code,...parts]=materials;
      const {payload:room}=await load(code);
      const who=auth(request,room);
      const context={db:supabase,code,room,who,parts,validateQuestion};
      if(parts[0]==='planet-game') return json(await handlePlanetGame(request,context));
      if(parts[0]==='word-game') return json(await handleWordGame(request,context));
      const result=parts[0]==='challenge' ? await handleChallenge(request,context) : await handleLibrary(request,context);
      return result instanceof Response ? result : json(result);
    }
    const m=p.match(/^\/api\/rooms\/([A-Z2-9]{8})(?:\/(join|question|answer|next))?$/);
    if(m) {
      const code=m[1],op=m[2]||'';
      if(method==='POST'&&op==='join') {
        const body=await readBody(request);
        let identity=null;
        const {room}=await mutate(code,r=>{
          if(r.players.length>=2)fail(409,'房間已滿，只能容納兩位玩家');
          const id=randomUUID(),t=token();
          r.players.push({id,name:str(body.name,16)||'TA',token:t,score:0});
          identity={id,token:t};
        });
        return json({code,playerId:identity.id,token:identity.token,room:view(room,identity.id),...generatorFlags()});
      }
      if(method==='GET'&&!op){const row=await load(code),person=auth(request,row.payload);return json({room:view(row.payload,person.id),...generatorFlags()})}
      if(method!=='POST')fail(405,'不支援此操作');
      if(op==='question') {
        const body=await readBody(request);
        let saved=null;
        if (body.libraryId!==undefined) {
          if (typeof body.libraryId!=='string'||!UUID.test(body.libraryId))fail(400,'題目識別碼無效。');
          const {payload}=await load(code);
          const who=auth(request,payload);
          const [entry]=await getRoomQuestions(supabase,code,[body.libraryId]);
          if(!entry||entry.owner_id!==who.id)fail(404,'找不到可寄出的題目。');
          saved=entry.content;
        }
        const {room,result}=await mutate(code,r=>{
          const who=auth(request,r);
          if(r.players.length<2)fail(409,'等待另一半加入後才能出題');
          if(r.current)fail(409,'這一題尚未結束');
          const q=validateQuestion(saved??body); q.createdBy=who.id;
          if(saved?.source)q.source=saved.source;
          r.current=q;
          return who.id;
        });
        return json({ok:true,room:view(room,result)});
      }
      if(op==='answer') {
        const body=await readBody(request);
        const {room,result}=await mutate(code,r=>{
          const who=auth(request,r),q=r.current;
          if(!q)fail(409,'目前沒有待回答的問題');
          if(q.answered)fail(409,'這題已回答');
          if(q.createdBy===who.id)fail(403,'不能回答自己出的題目');
          if(q.type==='open') {
            const a=str(body.text,1000);
            if(!a)fail(400,'請先輸入答案');
            q.answerText=a;q.isCorrect=null;who.score+=5;
          } else {
            const idx=Number(body.answerIndex);
            if(!Number.isInteger(idx)||idx<0||idx>=q.options.length)fail(400,'選項無效');
            q.selectedIndex=idx; q.isCorrect=idx===q.answerIndex;
            if(q.isCorrect)who.score+=10;
          }
          q.answered=true;q.answerBy=who.id;
          return who.id;
        });
        return json({ok:true,room:view(room,result)});
      }
      if(op==='next') {
        const {room,result}=await mutate(code,r=>{
          const who=auth(request,r);
          if(!r.current?.answered)fail(409,'請先完成當前題目');
          r.history.push(r.current);
          if(r.history.length>60)r.history.shift();
          r.current=null;r.round++;
          return who.id;
        });
        return json({ok:true,room:view(room,result)});
      }
      fail(404,'未知房間操作');
    }
    if(method==='POST'&&(p==='/api/ai'||p==='/api/questions/generate')) return await generateForRoom(request);
    fail(404,'找不到 API 路徑');
  } catch(e) {
    const code=e instanceof ApiError ? e.status : 500;
    if(code===500)console.error('[問問星球 API]',method,e?.name||'Error');
    return json({error:code===500?'伺服器出現問題，請稍後再試':e.message},code);
  }
}

export {validateQuestion};
