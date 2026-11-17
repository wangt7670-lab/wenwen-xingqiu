import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const CATEGORIES = new Set(['couple', 'why', 'science', 'history', 'riddle', 'news']);
const ROOM_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const str = (s, max=150) => String(s ?? '').trim().slice(0,max);
const now = () => Date.now();
const json = (data,status=200) => Response.json(data,{status,headers:API_HEADERS});
const ready = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const apiKey = () => String(process.env.OPENAI_API_KEY || '').trim();
const BASE = () => String(process.env.SUPABASE_URL || '').replace(/\/$/,'');
const SECRET = () => String(process.env.SUPABASE_SECRET_KEY || '');
const roomUrl = (query='') => `${BASE()}/rest/v1/quiz_rooms${query}`;

function roomCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(8),v => chars[v % chars.length]).join('');
}
function token() { return randomBytes(24).toString('base64url'); }
function constantEqual(a,b) {
  const aa=Buffer.from(a||''),bb=Buffer.from(b||'');
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}

async function supabase(method, query='', body, headers={}) {
  if(!ready()) fail(503,'線上房間尚未設定 Supabase，請先完成部署設定。');
  const controller = new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9500);
  try {
    const res=await fetch(roomUrl(query), {
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
      if(res.status===404) fail(503,'找不到 Supabase 資料表，請先執行 schema.sql。');
      fail(503,'線上資料庫暫時無法使用，請稍後再試。');
    }
    return data;
  } catch(e) {
    if(e.name==='AbortError') fail(504,'Supabase 連線逾時。');
    if(e instanceof ApiError) throw e;
    fail(503,'無法連接 Supabase，請檢查網址和連線。');
  } finally {clearTimeout(timeout)}
}

async function readBody(request) {
  if(Number(request.headers.get('content-length')||0)>24000) fail(413,'資料太大');
  let raw='';
  try {raw=await request.text()}catch {fail(400,'無法讀取提交內容')}
  if(raw.length>24000) fail(413,'資料太大');
  try {return raw?JSON.parse(raw):{}}catch {fail(400,'請提交有效 JSON')}
}

function view(room,who) {
  const current=room.current?{...room.current}:null;
  if(current&&!current.answered&&current.createdBy!==who) {
    delete current.answerIndex;
    delete current.referenceAnswer;
    delete current.explanation;
    delete current.source_url;
    delete current.source_title;
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
  const topic=CATEGORIES.has(q.topic)?q.topic:'couple';
  const question=str(q.question,300);
  if(question.length<2) fail(400,'問題至少需要兩個字');
  const options=type==='choice'?(Array.isArray(q.options)?q.options.map(x=>str(x,120)).slice(0,4):[]):[];
  if(type==='choice'&&(options.length!==4 || options.some(x=>!x))) fail(400,'選擇題需要四個有效選項');
  const answerIndex=Number(q.answerIndex);
  if(type==='choice'&&(!Number.isInteger(answerIndex)||answerIndex<0||answerIndex>3)) fail(400,'正確答案編號無效');
  const source=str(q.source_url,450);
  return {
    id:randomUUID(),topic,type,question,
    tag:str(q.tag,120),options,
    answerIndex:type==='choice'?answerIndex:0,
    referenceAnswer:type==='open'?str(q.referenceAnswer,300):'',
    explanation:str(q.explanation,600),
    source_url:/^https:\/\//i.test(source)?source:'',
    source_title:str(q.source_title,150),
    origin:['bank','custom','ai','demo-ai'].includes(q.origin)?q.origin:'custom',
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

async function generateAI(topic,level,keywords) {
  if(!apiKey()) fail(503,'尚未設定 OPENAI_API_KEY，請先使用內建題庫');
  const news=topic==='news';
  const names={couple:'情侶溝通、異地戀與互相了解',why:'十萬個為什麼與日常現象',science:'科學、動物與宇宙',history:'世界與中國歷史',riddle:'腦筋急轉彎',news:'可核實的最新新聞'};
  const schema={type:'object',properties:{type:{type:'string',enum:['choice','open']},question:{type:'string'},tag:{type:'string'},options:{type:'array',items:{type:'string'}},answerIndex:{type:'integer'},explanation:{type:'string'},source_url:{type:'string'},source_title:{type:'string'}},required:['type','question','tag','options','answerIndex','explanation','source_url','source_title'],additionalProperties:false};
  const prompt=`你為兩位異地情侶創作一道繁體中文問答題，領域：${names[topic]}，難度：${{light:'輕鬆',medium:'中等',hard:'挑戰'}[level]||'輕鬆'}，額外關鍵字：${keywords||'不限'}。\n`+
    `「關於我們」可出開放簡答題，其他領域用四選一。禁止猜測真實情侶的私人資訊。選擇題必須有唯一正確答案及清晰的說明。`+
    (news?'請使用 web_search 檢索近期真實新聞，題目須可核實，提供 HTTPS 來源網址與標題及明確事件日期。':'非新聞題 source_url 和 source_title 填空字串。');
  const payload={model:news?(process.env.OPENAI_NEWS_MODEL||'gpt-4.1'):(process.env.OPENAI_MODEL||'gpt-4.1-mini'),input:[{role:'system',content:prompt},{role:'user',content:'請生成一道有趣而準確的題目。'}],text:{format:{type:'json_schema',name:'couple_quiz',strict:true,schema}},max_output_tokens:1200};
  if(news){payload.tools=[{type:'web_search',search_context_size:'medium'}];payload.tool_choice='required'}
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),26000);
  try {
    const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+apiKey(),'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
    const data=await res.json();
    if(!res.ok) fail(502,'AI 暫時無法出題：'+str(data?.error?.message||res.status,200));
    const output=(data.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
    let result;try{result=JSON.parse(output)}catch{fail(502,'AI 未產生有效題目，請再試一次')}
    const q=validateQuestion({...result,topic,origin:'ai'});
    if(news&&!q.source_url)fail(502,'時事題沒有可核實的新聞來源，請重新生成');
    return q;
  } catch(e) {
    if(e.name==='AbortError') fail(504,'AI 產生題目逾時，請重新嘗試');
    if(e instanceof ApiError) throw e;
    fail(502,'AI 服務暫時不可用');
  } finally {clearTimeout(timer)}
}

export async function handleApi(request) {
  const url=new URL(request.url),p=url.pathname,method=request.method.toUpperCase();
  try {
    if(method==='GET'&&p==='/api/health') {
      if(!ready())return json({ok:true,onlineReady:false,aiEnabled:!!apiKey(),message:'尚未設定 Supabase 環境變數'});
      await supabase('GET','?select=code&limit=1');
      return json({ok:true,onlineReady:true,aiEnabled:!!apiKey(),message:'雙人服務已就緒'});
    }
    if(method==='POST'&&p==='/api/rooms') {
      const body=await readBody(request);
      const {room,playerId,token:authToken}=await createRoom(str(body.name,16)||'我');
      return json({code:room.code,playerId,token:authToken,room:view(room,playerId),aiEnabled:!!apiKey()},201);
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
        return json({code,playerId:identity.id,token:identity.token,room:view(room,identity.id),aiEnabled:!!apiKey()});
      }
      if(method==='GET'&&!op){const row=await load(code),person=auth(request,row.payload);return json({room:view(row.payload,person.id),aiEnabled:!!apiKey()})}
      if(method!=='POST')fail(405,'不支援此操作');
      if(op==='question') {
        const body=await readBody(request);
        const {room,result}=await mutate(code,r=>{
          const who=auth(request,r);
          if(r.players.length<2)fail(409,'等待另一半加入後才能出題');
          if(r.current)fail(409,'這一題尚未結束');
          const q=validateQuestion(body); q.createdBy=who.id; r.current=q;
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
    if(method==='POST'&&p==='/api/ai') {
      const body=await readBody(request);
      const code=str(body.room,12).toUpperCase();
      const {room}=await mutate(code,r=>{
        auth(request,r);
        if((r.aiCalls||0)>=30)fail(429,'本房間已達 AI 試玩上限（30 題）');
        r.aiCalls=(r.aiCalls||0)+1;
      });
      const topic=CATEGORIES.has(body.topic)?body.topic:'science';
      const level=['light','medium','hard'].includes(body.level)?body.level:'light';
      const q=await generateAI(topic,level,str(body.keywords,150));
      return json({question:q});
    }
    fail(404,'找不到 API 路徑');
  } catch(e) {
    const code=e instanceof ApiError?e.status:500;
    if(code===500)console.error('[問問星球 API]',method,p,e?.message||'internal error');
    return json({error:code===500?'伺服器出現問題，請稍後再試':e.message},code);
  }
}

export {validateQuestion};
