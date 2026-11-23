export const gameModes = Object.freeze({ open: '開放式', yes_no: '是／否', quiz: '腦筋急轉彎' });

export class GameError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

const nonempty = value => typeof value === 'string' && Boolean(value.trim());

export function validCard(card) {
  return card && typeof card.id === 'string' && /^[A-Z][A-Z0-9]{1,7}$/.test(card.id) &&
    Object.hasOwn(gameModes, card.answer_type) && nonempty(card.question) &&
    typeof card.default_enabled === 'boolean' && nonempty(card.sensitivity) &&
    (card.answer_type !== 'quiz' || (nonempty(card.correct_answer) && nonempty(card.explanation) &&
      [1, 2, 3].includes(card.difficulty) && card.points === 10 &&
      Number.isInteger(card.time_limit_seconds) && card.time_limit_seconds > 0));
}

export function catalogCards(data) {
  const cards = data?.questions;
  if (!Array.isArray(cards) || cards.length !== 250 || !cards.every(validCard) ||
      new Set(cards.map(card => card.id)).size !== cards.length ||
      cards.filter(card => card.answer_type === 'quiz').length !== 100 ||
      cards.filter(card => card.answer_type === 'yes_no').length !== 42) {
    throw new GameError('題庫資料不完整，請重新載入。', 503);
  }
  return cards;
}

export function startGame(previous, input, cards, players, id, now) {
  if (previous && (!previous.completed || input.previousId !== previous.id)) {
    throw new GameError('已有一局遊戲，請接續目前的進度。');
  }
  const { mode, difficulty, count } = input;
  if (!Object.hasOwn(gameModes, mode) || !Number.isInteger(count) || count < 1 || count > 10 ||
      (mode === 'quiz' && ![0, 1, 2, 3].includes(difficulty))) {
    throw new GameError('請選擇有效的玩法、難度和每局題數。', 400);
  }
  if (!cards.length || !cards.every(validCard)) throw new GameError('題庫資料不完整，請稍後再試。', 503);
  const seen = new Set(previous?.seen ?? []);
  const seenQuestions = new Set(previous?.seenQuestions ?? []);
  const available = cards.filter(card => card.answer_type === mode && card.default_enabled && card.sensitivity !== 'high' &&
    (!difficulty || mode !== 'quiz' || card.difficulty === difficulty) && !seen.has(card.id) && !seenQuestions.has(card.question));
  if (!available.length) throw new GameError('這個選擇已沒有未玩過的題目，請換個難度或玩法。', 422);
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  const selectedQuestions = new Set();
  const questions = available.filter(card => {
    if (selectedQuestions.has(card.question)) return false;
    selectedQuestions.add(card.question);
    return true;
  }).slice(0, count);
  const game = { id, mode, players, questions, step: 0, seen: [...seen], seenQuestions: [...seenQuestions],
    entries: {}, scores: Object.fromEntries(players.map(player => [player, 0])), completed: false };
  enterRound(game, now);
  return game;
}

function enterRound(game, now) {
  const question = game.questions[game.step];
  game.seen.push(question.id);
  game.seenQuestions.push(question.question);
  game.entries = {};
  game.deadline = game.mode === 'quiz' ? now + question.time_limit_seconds * 1000 : null;
}

export function gameView(game, player) {
  if (!game) return null;
  const { id, mode, step, players, completed, deadline, scores } = game;
  const base = { id, mode, step, players, completed, deadline, scores, total: game.questions.length };
  if (completed) return base;
  const card = game.questions[step];
  const submitted = players.filter(who => Object.hasOwn(game.entries, who));
  const revealed = submitted.length === players.length;
  return {
    ...base, submitted, revealed,
    own: game.entries[player] ?? null,
    question: { id: card.id, text: card.question, difficulty: card.difficulty },
    ...(revealed ? {
      entries: game.entries,
      followUp: card.follow_up || '',
      ...(mode === 'quiz' ? { correctAnswer: card.correct_answer, explanation: card.explanation } : {})
    } : {})
  };
}

export function playGame(current, action, input, player, now) {
  if (!current || current.completed || input.id !== current.id || input.step !== current.step || !current.players.includes(player)) {
    throw new GameError('進度已變更，請重新整理。');
  }
  const game = structuredClone(current);
  const status = gameView(current, player);
  if (action === 'end') {
    game.completed = true;
    game.entries = {};
    return game;
  }
  if (action === 'submit' || action === 'skip') {
    if (status.own) throw new GameError('你已送出這題。');
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (action === 'submit' && (!text || text.length > 1000 ||
        (game.mode === 'yes_no' && !['是', '否'].includes(text)))) {
      throw new GameError('請先填寫有效的答案。', 400);
    }
    game.entries[player] = action === 'skip' ? { skipped: true } : { text };
    return game;
  }
  if (!status.revealed) throw new GameError('請等所有玩家作答或跳過。');
  if (action === 'rate') {
    if (game.mode !== 'quiz' || status.own.skipped || typeof input.correct !== 'boolean') {
      throw new GameError('目前無法評分。', 400);
    }
    game.entries[player].correct = input.correct;
    game.scores[player] += (Number(input.correct) - Number(status.own.correct === true)) * 10;
  } else if (action === 'next') {
    if (game.mode === 'quiz' && Object.values(game.entries).some(entry => !entry.skipped && typeof entry.correct !== 'boolean')) {
      throw new GameError('請等所有玩家完成自評。');
    }
    if (game.step + 1 === game.questions.length) game.completed = true;
    else {
      game.step++;
      enterRound(game, now);
    }
  } else throw new GameError('不支援此操作。', 405);
  return game;
}
