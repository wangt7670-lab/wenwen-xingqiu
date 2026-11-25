import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { catalogCards, gameView, playGame, startGame } from '../public/planet-game.js';

const data = JSON.parse((await readFile(new URL('../public/data/wenwen-questions.json', import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const cards = catalogCards(data);
const quiz = cards.filter(card=>card.answer_type==='quiz');
const input = (game, extra={}) => ({id:game.id,step:game.step,...extra});

test('the imported deck validates and every quiz can independently show its answer and explanation', () => {
  assert.deepEqual(quiz.map(card=>card.id),Array.from({length:100},(_,index)=>'Q'+String(index+1).padStart(3,'0')));
  assert.equal(cards.filter(card=>card.answer_type==='open').length,108);
  assert.equal(cards.filter(card=>card.answer_type==='yes_no').length,42);
  assert.throws(()=>catalogCards({questions:cards.slice(1)}),/題庫資料不完整/);
  assert.throws(()=>catalogCards({questions:cards.map(card=>card.id==='Q001'?{...card,explanation:null}:card)}),/題庫資料不完整/);
  for(const card of quiz) {
    const game = startGame(null,{mode:'quiz',difficulty:card.difficulty,count:1},[card],['solo'],'one',0);
    assert.equal(gameView(game,'solo').correctAnswer,undefined);
    const revealed = gameView(playGame(game,'skip',input(game),'solo',100000),'solo');
    assert.equal(revealed.correctAnswer,card.correct_answer);
    assert.equal(revealed.explanation,card.explanation);
  }
});

test('solo resumes a saved game, survives timeout, accepts arbitrary synonyms and excludes seen cards', () => {
  let game = startGame(null,{mode:'quiz',difficulty:3,count:10},cards,['solo'],'round-1',0);
  game = JSON.parse(JSON.stringify(game));
  assert.equal(game.questions.length,10);
  assert.ok(game.deadline>0 && game.questions.every(card=>card.difficulty===3));
  const expiredTime=game.deadline+1;
  assert.equal(gameView(game,'solo').revealed,false);
  game = playGame(game,'submit',input(game,{text:'另一種說法'}),'solo',expiredTime);
  game = playGame(game,'rate',input(game,{correct:true}),'solo',expiredTime);
  assert.equal(gameView(game,'solo').scores.solo,10);
  game = playGame(game,'rate',input(game,{correct:false}),'solo',expiredTime);
  assert.equal(gameView(game,'solo').scores.solo,0);
  game = playGame(game,'next',input(game),'solo',expiredTime);
  assert.equal(game.step,1);
  assert.throws(()=>playGame(game,'submit',{id:game.id,step:0,text:'stale'},'solo',expiredTime),/進度已變更/);
  while (!game.completed) {
    game=playGame(game,'skip',input(game),'solo',expiredTime);
    game=playGame(game,'next',input(game),'solo',expiredTime);
  }
  const next = startGame(game,{mode:'quiz',difficulty:3,count:10,previousId:game.id},cards,['solo'],'round-2',0);
  assert.equal(next.questions.length,10);
  assert.ok(next.questions.every(card=>!game.seen.includes(card.id)));
});

test('open and yes/no modes filter sensitive questions, keep both answers private, and never score or show a standard answer', () => {
  for(const mode of ['open','yes_no']) {
    let game = startGame(null,{mode,count:10},cards,['a','b'],'dialogue',0);
    assert.ok(game.questions.every(card=>card.default_enabled && card.sensitivity!=='high'));
    const answer=mode==='open'?'我的想法':'是';
    game=playGame(game,'submit',input(game,{text:answer}),'a',1);
    assert.equal(gameView(game,'b').own,null);
    assert.equal(gameView(game,'b').entries,undefined);
    const reconnected=JSON.parse(JSON.stringify(game));
    game=playGame(reconnected,'skip',input(game),'b',2);
    const visible=gameView(game,'b');
    assert.equal(visible.entries.a.text,answer);
    assert.equal(visible.correctAnswer,undefined);
    assert.equal(visible.explanation,undefined);
    assert.deepEqual(visible.scores,{a:0,b:0});
  }
});
