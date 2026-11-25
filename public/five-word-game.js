export const wordModes = { sentence: '五詞造句', story: '五詞故事', relay: '故事接龍' };
export const wordThemes = ['甜蜜', '搞笑', '奇幻', '混搭'];
export const wordCategories = ['人物', '地點', '物品', '動作', '轉折'];
export const wordLengths = [4, 6, 8];
export const wordBonuses = [0, 3, 5];

export class WordGameError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

export function readWordCards(data) {
  const cards = data?.cards;
  if (!Array.isArray(cards) || cards.length !== 180 || !cards.every(card =>
    /^WC\d{4}$/.test(card?.id) && wordThemes.slice(0, 3).includes(card.theme) &&
    wordCategories.includes(card.category) && typeof card.word === 'string' && card.word.trim()) ||
    new Set(cards.map(card => card.id)).size !== 180 ||
    !wordThemes.slice(0, 3).every(theme => wordCategories.every(category =>
      cards.filter(card => card.theme === theme && card.category === category).length === 12))) {
    throw new WordGameError('詞卡資料不完整，請重新載入。', 503);
  }
  return cards;
}

export function prepareWordGame({ mode, theme, total }, players, id, online) {
  if (!Object.hasOwn(wordModes, mode) || !wordThemes.includes(theme) ||
      (mode === 'relay' && !wordLengths.includes(total)) || (online && mode !== 'relay')) {
    throw new WordGameError('請選擇有效的玩法、主題和棒數。', 400);
  }
  if (players.length !== 2 || players[0] === players[1]) throw new WordGameError('請先邀請另一位玩家。');
  return { id, mode, theme, total: mode === 'relay' ? total : null, players,
    consent: online ? [players[0]] : [...players], status: 'setup', turns: [], used: [],
    scores: Object.fromEntries(players.map(player => [player, 0])) };
}

function drawTurn(game, catalog, now) {
  const used = new Set(game.used);
  const cards = wordCategories.map(category => {
    const pool = catalog.filter(card => card.category === category && (game.theme === '混搭' || card.theme === game.theme));
    let available = pool.filter(card => !used.has(card.id));
    if (!available.length) {
      for (const card of pool) used.delete(card.id);
      available = pool;
    }
    const card = available[Math.floor(Math.random() * available.length)];
    used.add(card.id);
    return card;
  });
  const number = game.turns.length + 1;
  const time = { sentence: 60, story: 180, relay: 120 }[game.mode];
  game.used = [...used];
  game.status = 'writing';
  game.turns.push({ number, writer: game.players[(number - 1) % 2], cards, deadline: now + time * 1000 });
}

export const matchedWords = (cards, text) => cards.filter(card => text.includes(card.word)).map(card => card.id);

export function changeWordGame(current, action, input, player, catalog, now) {
  if (!current || current.id !== input.id || !current.players.includes(player) ||
      input.turn !== current.turns.length) throw new WordGameError('接龍進度已變更，請重新整理。');
  const game = structuredClone(current);
  const turn = game.turns.at(-1);
  if (action === 'clear') return null;
  if (action === 'consent' && game.status === 'setup') {
    if (input.agree !== true || game.consent.includes(player)) throw new WordGameError('請確認同意，或等候房主開始。');
    game.consent.push(player);
  } else if (action === 'start' && game.status === 'setup' && game.players[0] === player && game.consent.length === 2) {
    drawTurn(game, catalog, now);
  } else if (action === 'submit' && game.status === 'writing' && turn.writer === player) {
    if (!['text', 'oral'].includes(input.format) || typeof input.text !== 'string' || input.text.length > 3000 ||
        (input.format === 'text' && !input.text.trim())) throw new WordGameError('請輸入故事，最多 3,000 字。', 400);
    turn.text = input.text.trim();
    turn.oral = input.format === 'oral';
    turn.matches = turn.oral ? [] : matchedWords(turn.cards, turn.text);
    game.status = 'review';
  } else if (action === 'score' && game.status === 'review' && turn.writer !== player) {
    const { words, bonus, continuity } = input;
    const validWords = new Set(turn.cards.map(card => card.id));
    const needsContinuity = game.mode === 'relay' && turn.number > 1;
    if (!Array.isArray(words) || new Set(words).size !== words.length || !words.every(id => validWords.has(id)) ||
        !wordBonuses.includes(bonus) || (needsContinuity && typeof continuity !== 'boolean')) {
      throw new WordGameError('請核對本棒詞卡、創意加分和接續情況。', 400);
    }
    const base = words.length === 5 ? 10 : 0;
    turn.review = { words, bonus, base, points: base + bonus, continuity: needsContinuity ? continuity : null };
    game.scores[turn.writer] += turn.review.points;
    game.status = turn.number === game.total ? 'completed' : 'scored';
  } else if (action === 'next' && game.status === 'scored' && turn.writer !== player) {
    drawTurn(game, catalog, now);
  } else {
    throw new WordGameError('目前不能執行這個操作，請確認玩家與回合。');
  }
  return game;
}

export const wordTurnText = turn => turn.text || (turn.oral ? '（口述，未提供文字摘要）' : '');

export function wordStoryText(game, label) {
  return [`問問星球｜故事接龍`, `主題：${game.theme}　共 ${game.total} 棒`,
    game.players.map(player => `${label(player)}：${game.scores[player]} 分`).join(' · '),
    ...game.turns.map(turn => `\n第 ${turn.number} 棒｜${label(turn.writer)}｜${turn.review.points} 分\n${wordTurnText(turn)}\n詞卡：${turn.cards.map(card => card.word).join('、')}`)
  ].join('\n');
}
