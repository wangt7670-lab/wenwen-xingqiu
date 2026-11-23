import assert from 'node:assert/strict';
import { test } from 'node:test';
import data from '../public/data/wenwen_five_word_cards_180_v4.json' with { type: 'json' };
import { changeWordGame, prepareWordGame, readWordCards, wordCategories, wordStoryText } from '../public/five-word-game.js';

const catalog = readWordCards(data);
const run = (game, action, player, extra={}) => changeWordGame(game,action,{id:game.id,turn:game.turns.length,...extra},player,catalog,360000);

for (const total of [4,6,8]) test(`relay concludes and exports ${total} ordered turns`, () => {
  let game = prepareWordGame({mode:'relay',theme:'奇幻',total},['A','B'],'story',false);
  game=run(game,'start','A');
  const ids = new Set();
  for(let turn=1;turn<=total;turn++) {
    const player=turn%2?'A':'B', partner=turn%2?'B':'A';
    const current=game.turns.at(-1);
    assert.equal(current.writer,player);
    assert.deepEqual(current.cards.map(card=>card.category),wordCategories);
    assert.ok(current.cards.every(card=>card.theme==='奇幻' && !ids.has(card.id)));
    current.cards.forEach(card=>ids.add(card.id));
    const oral=turn===2;
    game=run(game,'submit',player,{format:oral?'oral':'text',text:oral?'':current.cards.map(card=>card.word).join('、')});
    assert.equal(game.turns.at(-1).matches.length,oral?0:5);
    const words=current.cards.slice(0,oral?4:5).map(card=>card.id);
    assert.throws(()=>run(game,'score',player,{words,bonus:5,continuity:true}));
    if(turn>1) assert.throws(()=>run(game,'score',partner,{words,bonus:5}));
    game=run(game,'score',partner,{words,bonus:5,continuity:true});
    assert.equal(game.turns.at(-1).review.points,oral?5:15);
    if(turn<total) game=run(game,'next',partner);
  }
  assert.equal(game.status,'completed');
  assert.equal(game.scores.A,total/2*15);
  assert.equal(game.scores.B,total/2*15-10);
  assert.match(wordStoryText(game,id=>id),/口述，未提供文字摘要/);
  assert.match(wordStoryText(game,id=>id),new RegExp('第 '+total+' 棒'));
  assert.throws(()=>run(game,'next','A'));
});

test('sentence and story preserve timers and recycle only an exhausted category', () => {
  for(const [mode,ms] of [['sentence',60000],['story',180000]]) {
    let game=prepareWordGame({mode,theme:'甜蜜'},['A','B'],'local',false);
    game=run(game,'start','A');
    const ids=new Set();
    assert.equal(game.turns[0].deadline,360000+ms);
    for(let step=1;step<=13;step++) {
      const writer=game.turns.at(-1).writer, partner=writer==='A'?'B':'A';
      const drawn=game.turns.at(-1).cards.map(card=>card.id);
      assert.ok(drawn.every(id=>step<=12?!ids.has(id):ids.has(id)));
      drawn.forEach(id=>ids.add(id));
      game=run(game,'submit',writer,{format:'text',text:'過了倒數仍可提交'});
      game=run(game,'score',partner,{words:drawn,bonus:3});
      game=run(game,'next',partner);
    }
    assert.equal(ids.size,60);
  }
});
