import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.mjs';

const memory=new Map();
const originalFetch=globalThis.fetch;
const originalEnv={...process.env};
const supabaseEndpoint='https://test-supabase.supabase.co';
const secret='sb_secret_testing_only';
const fail=(message)=>{throw Error(message)};

function mockResponse(data,status=200) {
 return new Response(data===null?'':JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
}
function mockDB(url, init) {
 const u=new URL(url);
 assert.equal(u.origin,supabaseEndpoint);
 assert.equal(u.pathname,'/rest/v1/quiz_rooms');
 assert.equal(init.headers.apikey,secret);
 assert.equal(init.headers.Authorization,undefined,'Do not send secret as Bearer JWT');
 const method=init.method;
 const keyFilter=u.searchParams.get('code');
 const code=keyFilter?.startsWith('eq.')?keyFilter.slice(3):null;
 const versionFilter=u.searchParams.get('version');
 const version=versionFilter?.startsWith('eq.')?Number(versionFilter.slice(3)):null;
 if(method==='GET') {
  const rows=code?Array.from(memory.values()).filter(x=>x.code===code):Array.from(memory.values());
  return mockResponse(rows.slice(0,1));
 }
 if(method==='POST') {
  const row=JSON.parse(init.body);
  if(memory.has(row.code))return mockResponse({code:'23505',message:'duplicate'},409);
  memory.set(row.code,structuredClone(row));
  return mockResponse([{code:row.code}],201);
 }
 if(method==='PATCH') {
  const patch=JSON.parse(init.body);const row=memory.get(code);
  if(!row||row.version!==version)return mockResponse([]);
  const next={...row,...patch};memory.set(code,next);
  return mockResponse([{code,version:next.version}]);
 }
 fail('unexpected method '+method);
}
async function call(path, method='GET', body,token) {
 const headers={};
 if(token)headers.authorization='Bearer '+token;
 if(body)headers['content-type']='application/json';
 const res=await handleApi(new Request('https://our-planet.netlify.app'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}));
 const data=await res.json();return {status:res.status,...data};
}

before(()=>{
 process.env.SUPABASE_URL=supabaseEndpoint;
 process.env.SUPABASE_SECRET_KEY=secret;
 delete process.env.OPENAI_API_KEY;
 globalThis.fetch=async(url,init)=>mockDB(url,init);
});
after(()=>{globalThis.fetch=originalFetch;process.env=originalEnv});

test('health, two-player room, secret reference answer, score and next round',async()=>{
 const health=await call('/api/health');
 assert.equal(health.onlineReady,true);
 assert.equal(health.aiEnabled,false);
 const a=await call('/api/rooms','POST',{name:'豆包'});
 assert.equal(a.status,201);
 assert.match(a.code,/^[A-Z2-9]{8}$/);
 assert.equal(a.room.players.length,1);
 const b=await call('/api/rooms/'+a.code+'/join','POST',{name:'原寶'});
 assert.equal(b.room.players.length,2);
 const q=await call('/api/rooms/'+a.code+'/question','POST',{type:'open',question:'我們第一次在灣仔吃什麼？',referenceAnswer:'冬陰功',topic:'couple'},a.token);
 assert.equal(q.status,200);
 const visible=await call('/api/rooms/'+a.code,'GET',null,b.token);
 assert.equal(visible.room.current.referenceAnswer,undefined,'Reference answer hidden from respondent');
 const writerView=await call('/api/rooms/'+a.code,'GET',null,a.token);
 assert.equal(writerView.room.current.referenceAnswer,'冬陰功');
 const wrong=await call('/api/rooms/'+a.code+'/answer','POST',{text:'牛扒'},a.token);
 assert.equal(wrong.status,403);
 const ans=await call('/api/rooms/'+a.code+'/answer','POST',{text:'冬陰功'},b.token);
 assert.equal(ans.room.players[1].score,5);
 assert.equal(ans.room.current.answerText,'冬陰功');
 assert.equal(ans.room.current.referenceAnswer,'冬陰功');
 const after=await call('/api/rooms/'+a.code+'/next','POST',{},a.token);
 assert.equal(after.room.round,2);
 assert.equal(after.room.current,null);
 assert.equal(after.room.history.length,1);
 const go=await call('/api/ai','POST',{room:a.code,topic:'history'},b.token);
 assert.equal(go.status,503);
 const tooMany=await call('/api/rooms/'+a.code+'/join','POST',{name:'陌生人'});
 assert.equal(tooMany.status,409);
});

test('AI key absent and database not configured return a clear response',async()=>{
 delete process.env.SUPABASE_SECRET_KEY;
 const r=await call('/api/health');
 assert.equal(r.status,200);
 assert.equal(r.onlineReady,false);
 const fail=await call('/api/rooms','POST',{name:'豆包'});
 assert.equal(fail.status,503);
 process.env.SUPABASE_SECRET_KEY=secret;
});

test('choice answer is hidden until submitted and awards correct score',async()=>{
 const a=await call('/api/rooms','POST',{name:'A'});
 const b=await call('/api/rooms/'+a.code+'/join','POST',{name:'B'});
 await call('/api/rooms/'+a.code+'/question','POST',{type:'choice',topic:'science',question:'章魚有幾顆心臟？',options:['一','二','三','四'],answerIndex:2,explanation:'章魚有三顆心臟'},a.token);
 const beforeAnswer=await call('/api/rooms/'+a.code,'GET',null,b.token);
 assert.equal(beforeAnswer.room.current.answerIndex,undefined);
 assert.equal(beforeAnswer.room.current.explanation,undefined);
 const answer=await call('/api/rooms/'+a.code+'/answer','POST',{answerIndex:2},b.token);
 assert.equal(answer.room.current.isCorrect,true);
 assert.equal(answer.room.players[1].score,10);
});
