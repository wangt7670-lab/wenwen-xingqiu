import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.mjs';

const memory=new Map();
const originalFetch=globalThis.fetch;
const originalEnv={...process.env};
const supabaseEndpoint='https://test-supabase.supabase.co';
const secret='sb_secret_testing_only';
const fail=(message)=>{throw Error(message)};
let reservation='ok', reservations=[], requests=[], openAI;

function mockResponse(data,status=200) {
 return new Response(data===null?'':JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
}
function mockDB(url, init) {
 const u=new URL(url);
 assert.equal(u.origin,supabaseEndpoint);
 assert.equal(init.headers.apikey,secret);
 assert.equal(init.headers.Authorization,undefined,'Do not send secret as Bearer JWT');
 if (u.pathname==='/rest/v1/rpc/reserve_quiz_ai') {
  assert.equal(init.method,'POST');
  reservations.push(JSON.parse(init.body));
  return mockResponse(reservation);
 }
 assert.equal(u.pathname,'/rest/v1/quiz_rooms');
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
 globalThis.fetch=async(url,init)=>{
  if(url!=='https://api.openai.com/v1/responses')return mockDB(url,init);
  assert.equal(init.headers.Authorization,'Bearer testing-only');
  const payload=JSON.parse(init.body);
  requests.push(payload);
  return openAI(payload);
 };
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
 assert.equal(reservations.length,0);
 const tooMany=await call('/api/rooms/'+a.code+'/join','POST',{name:'陌生人'});
 assert.equal(tooMany.status,409);
});

const prompts=[
 '這是風箏節的問答測試', '銀河列車會停哪一站？', '打翻顏料後怎樣作畫？', '海龜正在尋找什麼？', '哪一種布適合測驗？',
 '從窗戶看到什麼形狀？', '小熊借走了幾本書？', '算出盆栽的數量', '黑板上畫了哪隻鳥？', '哪把鑰匙可以打開箱子？'
];
const example=(question=prompts[0],type='choice')=>({
 type,question,tag:'',options:type==='choice'?['甲種','乙種','丙種','丁種']:[],answerIndex:type==='choice'?3:0,
 referenceAnswer:type==='open'?'丁種':'',explanation:'這項是測試答案。',source_url:'',source_title:'',publishedDate:'',eventDate:''
});
const completed=(questions,output=[])=>mockResponse({status:'completed',output:[...output,{type:'message',content:[{
 type:'output_text',text:JSON.stringify({insufficient:false,questions})
}]}]});

test('Responses API supports 1/5/10, each draft has metadata, and legacy clients can still send one',async()=>{
 process.env.OPENAI_API_KEY='testing-only';
 const a=await call('/api/rooms','POST',{name:'A'});
 const b=await call(`/api/rooms/${a.code}/join`,'POST',{name:'B'});
 openAI=payload=>{
  assert.equal(payload.text.format.strict,true);
  assert.equal(payload.store,false);
  assert.equal(payload.tools,undefined);
  const {數量:count,題型:type}=JSON.parse(payload.input);
  return completed(prompts.slice(0,count).map(prompt=>example(prompt,type==='簡答'?'open':'choice')));
 };
 for(const [count,type] of [[1,'choice'],[5,'open'],[10,'choice']]) {
  const generated=await call('/api/ai','POST',{room:a.code,topic:'riddle',type,count,style:'creative',level:'hard'},a.token);
  assert.equal(generated.status,200);
  assert.equal(generated.questions.length,count);
  assert.deepEqual(generated.questions[0],generated.question);
  assert.deepEqual(reservations.at(-1),{room_code:a.code,question_count:count});
  for(const q of generated.questions) {
   assert.equal(q.type,type);
   assert.equal(q.level,'hard');
   assert.equal(q.style,'creative');
   assert.equal(q.reviewState,'draft');
   assert.ok(Number.isSafeInteger(q.generatedAt));
  }
 }

 const legacy=await call('/api/ai','POST',{room:a.code,topic:'riddle'},a.token);
 assert.equal(legacy.status,200);
 assert.equal(legacy.question.reviewState,undefined);
 const sent=await call(`/api/rooms/${a.code}/question`,'POST',legacy.question,a.token);
 assert.equal(sent.status,200);
 const hidden=await call(`/api/rooms/${a.code}`,'GET',null,b.token);
 assert.equal(hidden.room.current.answerIndex,undefined);
});

test('AI authenticates and reserves before spending quota and returns safe errors',async()=>{
 const a=await call('/api/rooms','POST',{name:'A'});
 const body={room:a.code,topic:'riddle',count:5};
 const beforeRequests=requests.length,beforeReservations=reservations.length;
 assert.equal((await call('/api/ai','POST',body,'wrong')).status,403);
 assert.equal((await call('/api/ai','POST',{...body,count:3},a.token)).status,400);
 assert.equal(reservations.length,beforeReservations);
 for(const code of ['cooldown','room_limit','global_limit']) {
  reservation=code;
  assert.equal((await call('/api/ai','POST',body,a.token)).status,429);
 }
 assert.equal(requests.length,beforeRequests);
 reservation='ok';
 for(const [providerStatus,status] of [[401,503],[429,429],[500,502]]) {
  openAI=()=>mockResponse({error:{message:'must not leak testing-only'}},providerStatus);
  const response=await call('/api/ai','POST',body,a.token);
  assert.equal(response.status,status);
  assert.doesNotMatch(response.error,/testing-only|must not leak/);
 }
 openAI=()=>mockResponse({error:{code:'credit_balance_exhausted',message:'sensitive provider diagnostic'}},429);
 const depleted=await call('/api/ai','POST',body,a.token);
 assert.equal(depleted.status,429);
 assert.match(depleted.error,/帳戶額度已用完/);
 assert.doesNotMatch(depleted.error,/sensitive|credit_balance_exhausted/);
 openAI=()=>mockResponse({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'secret'}]}]});
 assert.equal((await call('/api/ai','POST',body,a.token)).status,422);
 openAI=()=>{throw new DOMException('sensitive diagnostic','TimeoutError');};
 assert.equal((await call('/api/ai','POST',body,a.token)).status,504);
});

test('AI rejects invalid count, duplicate options, and duplicate titles without leaking history to OpenAI',async()=>{
 const a=await call('/api/rooms','POST',{name:'A'});
 const body={room:a.code,topic:'riddle',count:1,type:'choice'};
 for(const invalid of [[],[{...example(),answerIndex:8}],[{...example(),options:['甲種','甲種','丙種','丁種']}],[{...example(),question:'星'.repeat(301)}]]) {
  openAI=()=>completed(invalid);
  assert.equal((await call('/api/ai','POST',body,a.token)).status,502);
 }
 openAI=()=>completed([example()]);
 assert.equal((await call('/api/ai','POST',{...body,recent:[prompts[0]+'！','private-question']},a.token)).status,422);
 assert.doesNotMatch(JSON.stringify(requests.at(-1)),/private-question/);
 openAI=()=>completed(prompts.slice(0,4).concat(prompts[0]).map(q=>example(q)));
 assert.equal((await call('/api/ai','POST',{...body,count:5},a.token)).status,422);
});

test('news needs actual search sources and recent dates, preserved only after the answer is revealed',async()=>{
 const a=await call('/api/rooms','POST',{name:'A'});
 const b=await call(`/api/rooms/${a.code}/join`,'POST',{name:'B'});
 const body={room:a.code,topic:'news',count:1,type:'open'};
 const date=new Date().toISOString().slice(0,10);
 const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 const news={...example(prompts[0],'open'),source_url:'https://example.org/report',source_title:'報導',publishedDate:date,eventDate:date};
 const evidence=(hasCitation=true)=>mockResponse({status:'completed',output:[
  {type:'web_search_call',status:'completed',action:{type:'search'}},
  {type:'message',content:[{type:'output_text',text:`發布日 ${date}、事件日 ${date}，請參考 ${news.source_url}`,
   annotations:hasCitation?[{type:'url_citation',url:news.source_url,title:news.source_title}]:[]}]}
 ]});
 openAI=()=>evidence(false);
 const countBefore=requests.length;
 assert.equal((await call('/api/ai','POST',body,a.token)).status,422);
 assert.equal(requests.length,countBefore+1,'Do not generate from URLs without source metadata');
 for(const invalid of [{...news,eventDate:'2020-02-01'},{...news,eventDate:yesterday},{...news,source_url:'https://example.org/unverified'}]) {
  openAI=payload=>payload.tools?evidence():completed([invalid]);
  assert.equal((await call('/api/ai','POST',body,a.token)).status,502);
 }
 openAI=payload=>{
  if(payload.tools) {
   assert.equal(payload.tool_choice,'required');
   assert.equal(payload.max_tool_calls,4);
   assert.deepEqual(payload.include,['web_search_call.action.sources']);
   assert.equal(payload.text,undefined);
   return evidence();
  }
  assert.equal(payload.text.format.strict,true);
  assert.deepEqual(JSON.parse(payload.input).可用來源,[news.source_url]);
  return completed([news]);
 };
 const priorReservations=reservations.length;
 const generated=await call('/api/ai','POST',body,a.token);
 assert.equal(generated.status,200);
 assert.equal(reservations.length,priorReservations+1);
 const draft=generated.questions[0];
 const roomEndpoint=`/api/rooms/${a.code}`;
 assert.equal((await call(roomEndpoint+'/question','POST',draft,a.token)).status,400);
 const sent=await call(roomEndpoint+'/question','POST',{...draft,reviewState:'approved'},a.token);
 assert.equal(sent.status,200);
 assert.equal(sent.room.current.reviewState,'used');
 const hidden=(await call(roomEndpoint,'GET',null,b.token)).room.current;
 for(const key of ['source_url','source_title','eventDate','publishedDate','referenceAnswer','explanation']) assert.equal(hidden[key],undefined);
 const {room}=await call(roomEndpoint+'/answer','POST',{text:'自由回答'},b.token);
 assert.equal(room.current.source_url,news.source_url);
 assert.equal(room.current.publishedDate,date);
 assert.equal(room.current.generatedAt,draft.generatedAt);
 assert.equal(room.players[1].score,5);
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
