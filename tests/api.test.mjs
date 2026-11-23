import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { handleApi } from '../server/api.mjs';
import { BUCKET } from '../server/documents.mjs';

const origin = 'https://isolated-db.example';
const secret = 'sb_secret_testing_only';
const tables = new Map(['quiz_rooms','quiz_documents','quiz_library_questions','quiz_challenges','quiz_planet_games','quiz_planet_questions','quiz_word_games'].map(name => [name, new Map()]));
const blobs = new Map();
const fetchBefore = globalThis.fetch;
const envBefore = { ...process.env };

function matchFilters(row, filters) {
  return [...filters].every(([key, value]) => {
    if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
    if (value.startsWith('in.(')) return value.slice(4,-1).split(',').includes(row[key]);
    return true;
  });
}

async function mockSupabase(url, { method, headers, body }) {
  const endpoint = new URL(url);
  assert.equal(endpoint.origin, origin, 'Only the isolated Supabase host should be contacted');
  assert.equal(headers.apikey, secret);
  assert.equal(headers.Authorization, undefined);
  if (endpoint.pathname.startsWith('/storage/v1/')) {
    if (method === 'DELETE') {
      assert.equal(endpoint.pathname, '/storage/v1/object/' + BUCKET);
      for (const key of JSON.parse(body).prefixes) blobs.delete(key);
      return Response.json([]);
    }
    const key = endpoint.pathname.split('/').slice(-2).join('/');
    if (method === 'POST') {
      assert.equal(headers['x-upsert'], 'false');
      blobs.set(key, Buffer.from(body));
      return Response.json({});
    }
    assert.match(endpoint.pathname, /\/authenticated\//);
    return blobs.has(key) ? new Response(blobs.get(key)) : Response.json({}, {status:404});
  }
  const data = body && JSON.parse(body);
  const path = endpoint.pathname.replace('/rest/v1/', '');
  if (path === 'rpc/reserve_quiz_document') {
    const doc = { ...data.document, state: 'pending', created_at: new Date().toISOString() };
    tables.get('quiz_documents').set(doc.id, doc);
    return Response.json(true);
  }
  if (path === 'rpc/save_quiz_library_question') {
    const questions = tables.get('quiz_library_questions');
    const q = data.question;
    if ([...questions.values()].some(item => item.room_code === q.room_code && item.fingerprint === q.fingerprint)) return Response.json('duplicate');
    questions.set(q.id, { ...q, created_at: new Date().toISOString() });
    return Response.json('ok');
  }
  const rows = tables.get(path);
  assert.ok(rows, path);
  const keyOf = row => row.id ?? row.code ?? row.room_code;
  const matches = [...rows.values()].filter(row => matchFilters(row, endpoint.searchParams));
  if (method === 'GET') return Response.json(matches);
  if (method === 'POST') {
    const key = keyOf(data);
    if (rows.has(key)) return Response.json({}, {status:409});
    const row = { version: 1, ...data };
    rows.set(key, row);
    return Response.json([row], {status:201});
  }
  if (method === 'PATCH') {
    const result = matches.map(row => {
      const updated = {...row, ...data};
      rows.set(keyOf(row), updated);
      return updated;
    });
    return Response.json(result);
  }
  assert.equal(method, 'DELETE');
  for (const row of matches) {
    rows.delete(keyOf(row));
    if (path === 'quiz_documents') {
      for (const [id,q] of tables.get('quiz_library_questions')) {
        if (q.document_id === row.id) tables.get('quiz_library_questions').delete(id);
      }
    }
  }
  return Response.json(matches);
}

async function call(path, { method = 'GET', body, raw, filename, token } = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body) headers['content-type'] = 'application/json';
  if (filename) headers['x-file-name'] = encodeURIComponent(filename);
  const result = await handleApi(new Request('https://quiz.example' + path, {
    method, headers, ...(body ? { body: JSON.stringify(body) } : raw!==undefined ? { body:raw } : {})
  }));
  if (result.headers.get('content-type')?.startsWith('application/json')) {
    return { status:result.status, ...await result.json() };
  }
  return { status:result.status, text:await result.text(), headers:result.headers };
}

const post = (path, token, body) => call(path, {method:'POST',token,body});

test('story relay requires both consents, serializes drawing and reviews, and clears only the relay', async () => {
  const {a,b,path} = await pair();
  const outsider = await pair();
  const endpoint = path+'/word-game';
  const originalRoom = (await call(path,{token:a.token})).room;
  assert.equal((await call(endpoint,{token:outsider.a.token})).status,403);
  assert.equal((await call(endpoint)).status,401);
  const settings = { version:0, mode:'relay', theme:'甜蜜', total:4, agree:true };
  assert.equal((await post(endpoint+'/setup',b.token,settings)).status,403);
  let result = await post(endpoint+'/setup',a.token,settings);
  const args = () => ({ version:result.version, id:result.game.id, turn:result.game.turns.length });
  assert.equal(result.game.turns.length,0);
  assert.equal((await post(endpoint+'/start',a.token,args())).status,409);
  result = await post(endpoint+'/consent',b.token,{...args(),agree:true});
  const race = await Promise.all([post(endpoint+'/start',a.token,args()),post(endpoint+'/start',a.token,args())]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  result = race.find(r=>r.status===200);
  assert.deepEqual((await call(endpoint,{token:b.token})).game,result.game);
  const cards = result.game.turns[0].cards.map(card=>card.id);
  assert.equal((await post(endpoint+'/submit',b.token,{...args(),format:'text',text:'wrong player'})).status,409);
  result = await post(endpoint+'/submit',a.token,{...args(),format:'oral',text:''});
  const review = {...args(),words:cards,bonus:5};
  assert.equal((await post(endpoint+'/score',a.token,review)).status,409);
  assert.equal((await post(endpoint+'/submit',a.token,{...args(),format:'text',text:'overwrite'})).status,409);
  result = await post(endpoint+'/score',b.token,review);
  assert.equal(result.game.scores[a.playerId],15);
  assert.equal((await post(endpoint+'/score',b.token,review)).status,409);
  const next = args();
  result = await post(endpoint+'/next',b.token,next);
  assert.equal((await post(endpoint+'/next',b.token,next)).status,409);
  assert.equal(result.game.turns[1].writer,b.playerId);
  assert.ok(result.game.turns[1].cards.every(card=>!cards.includes(card.id)));
  const cleared = await post(endpoint+'/clear',b.token,args());
  assert.ok(cleared.version>result.version);
  assert.equal((await call(endpoint,{token:a.token})).game,null);
  assert.deepEqual((await call(path,{token:a.token})).room,originalRoom);
});

async function pair() {
  const a = await post('/api/rooms',null,{name:'Alpha'});
  assert.equal(a.status,201);
  const path = '/api/rooms/' + a.code;
  const b = await post(path+'/join',null,{name:'Beta'});
  assert.equal(b.status,200);
  return {a,b,path};
}

before(() => {
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SECRET_KEY = secret;
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = mockSupabase;
});
after(() => { process.env = envBefore; globalThis.fetch = fetchBefore; });

test('legacy room can open, hide the answer, score and preserve its history', async () => {
  const health = await call('/api/health');
  assert.equal(health.onlineReady,true);
  const {a,b,path} = await pair();
  const result = await post(path+'/question',a.token,{type:'open',topic:'couple',question:'Existing question',referenceAnswer:'Private until reveal'});
  assert.equal(result.status,200);
  assert.equal((await call(path,{token:b.token})).room.current.referenceAnswer,undefined);
  assert.equal((await post(path+'/answer',a.token,{text:'test'})).status,403);
  const answered = await post(path+'/answer',b.token,{text:'My answer'});
  assert.equal(answered.room.players[1].score,5);
  assert.equal(answered.room.current.referenceAnswer,'Private until reveal');
  const next = await post(path+'/next',a.token,{});
  assert.equal(next.room.history[0].answerText,'My answer');
  assert.equal(next.room.round,2);
  assert.equal((await post(path+'/join',null,{})).status,409);
});

test('1, 5 and 10 drafts work without a provider and legacy endpoint is retained', async () => {
  const {a} = await pair();
  for (const count of [1,5,10]) {
    const result = await post('/api/questions/generate',a.token,{room:a.code,topic:'science',type:'open',count});
    assert.equal(result.status,200);
    assert.equal(result.questions.length,count);
    assert.equal(result.questions[0].origin,'rules');
  }
  const legacy = await post('/api/ai',a.token,{room:a.code,topic:'science'});
  assert.equal(legacy.status,200);
  assert.ok(legacy.question.question);
  const bad = await post('/api/questions/generate','invalid',{room:a.code,topic:'science',type:'open',count:10});
  assert.equal(bad.status,403);
});

test('private documents, reviewed room sharing, cross-room isolation and deletion', async () => {
  const {a,b,path} = await pair();
  const foreign = await pair();
  const text = 'Orbit: The path of an object around a star.\nCrater: A depression from a collision.\nComet: An icy body with a tail.\nGravity: Attraction between objects with mass.';
  const result = await call(path+'/documents',{
    method:'POST', raw:text, filename:'Science.md', token:a.token
  });
  assert.equal(result.status,200);
  const id = result.document.id;
  const docPath = path+'/documents/'+id;
  assert.equal(result.document.sections,undefined);
  assert.equal((await call(path+'/documents',{token:b.token})).documents.length,0);
  assert.equal((await call(docPath+'/download',{token:b.token})).status,404);
  assert.equal((await call(docPath+'/download',{token:foreign.a.token})).status,403);
  assert.equal((await call(foreign.path+'/documents/'+id+'/download',{token:foreign.a.token})).status,404);
  const raw = await call(docPath+'/download',{token:a.token});
  assert.equal(raw.text,text);
  assert.match(raw.headers.get('content-disposition'),/^attachment/);
  assert.equal(raw.headers.get('cache-control'),'private, no-store');
  assert.equal((await post(docPath+'/drafts',b.token,{topic:'science',type:'choice',count:5})).status,404);
  const {questions} = await post(docPath+'/drafts',a.token,{topic:'science',type:'choice',count:5});
  assert.equal(questions.length,4);
  assert.ok(questions.every(q=>q.options.length===4 && q.source.location && q.source.excerpt));
  const draft = questions[0];
  assert.equal((await post(path+'/library',a.token,draft)).status,400);
  assert.equal((await post(path+'/library',b.token,{...draft,reviewState:'approved'})).status,404);
  const share = await post(path+'/library',a.token,{...draft,source:{excerpt:'forged'},reviewState:'approved'});
  assert.equal(share.status,200);
  assert.notEqual(share.question.source.excerpt,'forged');
  const guest = await call(path+'/library',{token:b.token});
  assert.equal(guest.questions.length,1);
  assert.equal(guest.questions[0].answerIndex,undefined);
  assert.equal(guest.questions[0].source,undefined);
  assert.equal((await call(foreign.path+'/library',{token:foreign.a.token})).questions.length,0);
  assert.equal((await post(path+'/question',b.token,{libraryId:share.question.id})).status,404);
  assert.equal((await post(path+'/question',a.token,{libraryId:share.question.id})).status,200);
  assert.equal((await call(path,{token:b.token})).room.current.source,undefined);
  const reveal = await post(path+'/answer',b.token,{answerIndex:draft.answerIndex});
  assert.match(reveal.room.current.source.excerpt,/Orbit/);
  assert.equal((await call(docPath,{method:'DELETE',token:b.token})).status,404);
  assert.equal((await call(docPath,{method:'DELETE',token:a.token})).status,200);
  assert.equal(blobs.has(a.code+'/'+id),false);
  assert.equal((await call(path+'/library',{token:a.token})).questions.length,0);
});

test('invalid file rolls back its reservation and the storage write never starts', async () => {
  const {a,path} = await pair();
  const result = await call(path+'/documents',{
    method:'POST',raw:'wrong format',filename:'fake.pdf',token:a.token
  });
  assert.equal(result.status,415);
  assert.equal((await call(path+'/documents',{token:a.token})).documents.length,0);
  assert.ok([...blobs.keys()].every(key=>!key.startsWith(a.code)));
  const oversized = await call(path+'/documents',{
    method:'POST',raw:Buffer.alloc(3*1024*1024+1),filename:'large.txt',token:a.token
  });
  assert.equal(oversized.status,413);
});

test('challenge is versioned, alternates turns, resumes and records points independently', async () => {
  const {a,b,path} = await pair();
  const other = await pair();
  const ids = [];
  for (const question of ['First stable question','Second stable question','Third stable question']) {
    const {question:q,status} = await post(path+'/library',a.token,{
      reviewState:'approved',type:'choice',topic:'science',question,options:['A','B','C','D'],answerIndex:2
    });
    assert.equal(status,200);
    ids.push(q.id);
  }
  assert.equal((await post(other.path+'/challenge/start',other.a.token,{questionIds:ids})).status,404);
  let result = await post(path+'/challenge/start',a.token,{questionIds:ids});
  assert.equal(result.status,200);
  const firstId = result.challenge.id;
  assert.equal(result.challenge.question.answerIndex,undefined);
  assert.equal((await post(path+'/challenge/answer',b.token,{id:firstId,step:0,answerIndex:2})).status,409);
  for (const [step,player] of [a,b,a].entries()) {
    const parameter = {id:firstId,step,answerIndex:2};
    const reconnected = await call(path+'/challenge',{token:player.token});
    assert.equal(reconnected.challenge.step,step);
    assert.equal(reconnected.challenge.question.answerIndex,undefined);
    const submitted = await post(path+'/challenge/answer',player.token,parameter);
    assert.equal(submitted.challenge.answer.points,10);
    assert.equal(submitted.challenge.question.answerIndex,2);
    assert.equal((await post(path+'/challenge/answer',player.token,parameter)).status,409);
    result = await post(path+'/challenge/next',player.token,{id:firstId,step});
  }
  assert.equal(result.challenge.completed,true);
  assert.equal(result.challenge.scores[a.playerId],20);
  assert.equal(result.challenge.scores[b.playerId],10);
  assert.equal((await call(path,{token:a.token})).room.players[0].score,0);
});

test('250-card room rounds hide both answers until simultaneous submissions and keep legacy records', async () => {
  const {a,b,path} = await pair();
  const foreign = await pair();
  const endpoint = path+'/planet-game';
  const roomBefore = (await call(path,{token:a.token})).room;
  const card = { id:'Q001', answer_type:'quiz', question:'Cloud quiz probe', default_enabled:true,
    sensitivity:'low', correct_answer:' four ', explanation:'Reason', difficulty:1, points:10, time_limit_seconds:20 };
  tables.get('quiz_planet_questions').set(card.id,{id:card.id,answer_type:'quiz',content:card});
  assert.equal((await call(endpoint,{token:foreign.a.token})).status,403);
  const started = await post(endpoint+'/start',a.token,{mode:'quiz',difficulty:1,count:1});
  assert.equal(started.status,200);
  assert.equal(started.game.correctAnswer,undefined);
  const turn = {id:started.game.id,step:0};
  assert.equal((await post(endpoint+'/next',a.token,turn)).status,409);
  assert.equal((await post(endpoint+'/rate',b.token,{...turn,correct:true})).status,409);
  const submissions = await Promise.all([
    post(endpoint+'/submit',a.token,{...turn,text:'four'}),
    post(endpoint+'/submit',b.token,{...turn,text:'四個'})
  ]);
  assert.ok(submissions.every(response=>response.status===200));
  const earlier = submissions.find(result=>!result.game.revealed);
  assert.ok(earlier);
  assert.equal(earlier.game.entries,undefined);
  assert.equal(earlier.game.explanation,undefined);
  const revealed = await call(endpoint,{token:a.token});
  assert.equal(revealed.game.entries[b.playerId].text,'四個');
  assert.equal(revealed.game.correctAnswer,card.correct_answer);
  assert.equal((await post(endpoint+'/submit',a.token,{...turn,text:'again'})).status,409);
  assert.equal((await post(endpoint+'/next',a.token,turn)).status,409);
  for(const [player,correct] of [[a,true],[b,false],[b,true],[b,true]]) {
    assert.equal((await post(endpoint+'/rate',player.token,{...turn,correct})).status,200);
  }
  const completed = await post(endpoint+'/next',b.token,turn);
  assert.equal(completed.game.completed,true);
  assert.deepEqual(completed.game.scores,{[a.playerId]:10,[b.playerId]:10});
  assert.deepEqual((await call(path,{token:a.token})).room,roomBefore);
  assert.equal((await post(endpoint+'/start',a.token,{mode:'quiz',difficulty:1,count:1,previousId:turn.id})).status,422);
});
