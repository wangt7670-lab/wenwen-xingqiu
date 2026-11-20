import { randomUUID } from 'node:crypto';
import { fail, readBody, str, UUID } from './http.mjs';
import { getRoomQuestions } from './library.mjs';

const resource = 'quiz_challenges';
const where = code => `?room_code=eq.${code}`;
const representation = { Prefer: 'return=representation' };

function publicState(state) {
  if (!state) return null;
  const { answerIndex, referenceAnswer, explanation, source, source_url, source_title, ...visible } = state.questions[state.step];
  const answer = state.answers[state.step] ?? null;
  const revealed = answer ? { answerIndex, referenceAnswer, explanation, source, source_url, source_title } : {};
  return {
    id: state.id, step: state.step, total: state.questions.length, completed: state.completed,
    turn: state.players[state.step % state.players.length],
    scores: state.scores, question: { ...visible, ...revealed }, answer
  };
}

async function start(body, room, row, db) {
  const { questionIds, previousId } = body;
  if (row && (!row.state.completed || previousId !== row.state.id)) fail(409, '房間已有闖關，請重新開啟目前進度。');
  if (room.players.length !== 2) fail(409, '請邀請另一位玩家加入。');
  if (!Array.isArray(questionIds) || questionIds.length < 3 || questionIds.length > 5 ||
      new Set(questionIds).size !== questionIds.length || questionIds.some(id => typeof id !== 'string' || !UUID.test(id))) {
    fail(400, '請選擇 3 至 5 道不同的房間題目。');
  }
  const questions = await getRoomQuestions(db, room.code, questionIds);
  const byId = new Map(questions.map(q => [q.id, q.content]));
  if (byId.size !== questionIds.length) fail(404, '有題目已移除或不屬於此房間。');
  const players = room.players.map(player => player.id);
  return {
    id: randomUUID(), players, scores: Object.fromEntries(players.map(id => [id, 0])),
    questions: questionIds.map(id => byId.get(id)), step: 0, answers: [], completed: false
  };
}

function change(body, state, who, action) {
  if (!state || state.completed || body.id !== state.id || body.step !== state.step) {
    fail(409, '闖關進度已變更，請重新整理。');
  }
  const updated = structuredClone(state);
  const answered = state.answers[state.step];
  if (action === 'next') {
    if (!answered) fail(409, '請先完成這一關。');
    if (state.step + 1 === state.questions.length) updated.completed = true;
    else updated.step++;
    return updated;
  }
  if (answered || state.players[state.step % state.players.length] !== who.id) fail(409, '現在輪到另一位玩家，或這關已完成。');
  const q = state.questions[state.step];
  let answer;
  if (q.type === 'choice') {
    if (!Number.isInteger(body.answerIndex) || body.answerIndex < 0 || body.answerIndex >= q.options.length) fail(400, '請選擇有效答案。');
    const correct = q.answerIndex === body.answerIndex;
    answer = { playerId: who.id, selectedIndex: body.answerIndex, correct, points: correct ? 10 : 0 };
  } else {
    const value = str(body.text, 1000);
    if (!value) fail(400, '請先輸入答案。');
    answer = { playerId: who.id, text: value, points: 5 };
  }
  updated.answers.push(answer);
  updated.scores[who.id] += answer.points;
  return updated;
}

export async function handleChallenge(request, { db, room, who, parts }) {
  const [, action, extra] = parts;
  const canRead = request.method === 'GET' && !action;
  const canWrite = request.method === 'POST' && !extra && ['start', 'answer', 'next'].includes(action);
  if (!canRead && !canWrite) fail(405, '不支援此操作。');
  const [row] = await db('GET', `${where(room.code)}&select=version,state&limit=1`, undefined, {}, resource);
  if (canRead) return { challenge: publicState(row?.state), version: Number(row?.version ?? 0) };
  const body = await readBody(request);
  const state = action === 'start' ? await start(body, room, row, db) : change(body, row?.state, who, action);
  const rows = row ?
    await db('PATCH', `${where(room.code)}&version=eq.${row.version}&select=version`,
      { version: Number(row.version) + 1, state }, representation, resource) :
    await db('POST', '?select=version', { room_code: room.code, state }, representation, resource);
  if (rows?.length !== 1) fail(409, '另一位玩家已先更新進度。');
  return { challenge: publicState(state), version: Number(rows[0].version) };
}
