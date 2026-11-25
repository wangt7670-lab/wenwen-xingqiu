import { randomUUID } from 'node:crypto';
import { fail, readBody } from './http.mjs';
import { GameError, gameModes, gameView, playGame, startGame } from '../public/planet-game.js';

const resource = 'quiz_planet_games';
const representation = { Prefer: 'return=representation' };

export async function handlePlanetGame(request, { db, room, who, parts }) {
  const [, action, extra] = parts;
  const canRead = request.method === 'GET' && !action;
  const canWrite = request.method === 'POST' && !extra && ['start', 'submit', 'skip', 'rate', 'next', 'end'].includes(action);
  if (!canRead && !canWrite) fail(405, '不支援此操作。');
  const filter = `?room_code=eq.${room.code}`;
  const body = canWrite ? await readBody(request) : null;
  let cards;
  if (action === 'start') {
    if (room.players.length !== 2) fail(409, '請先邀請另一位玩家加入。');
    if (!Object.hasOwn(gameModes, body.mode)) fail(400, '請選擇有效玩法。');
    const rows = await db('GET', `?answer_type=eq.${body.mode}&select=content&order=id&limit=250`, undefined, {}, 'quiz_planet_questions');
    cards = rows.map(row => row.content);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db('GET', `${filter}&select=version,state&limit=1`, undefined, {}, resource);
    if (canRead) return { game: gameView(row?.state, who.id), version: Number(row?.version ?? 0) };
    let state;
    try {
      state = action === 'start' ? startGame(row?.state, body, cards, room.players.map(player => player.id), randomUUID(), Date.now()) :
        playGame(row?.state, action, body, who.id, Date.now());
    } catch (error) {
      if (error instanceof GameError) fail(error.status, error.message);
      throw error;
    }
    try {
      const rows = row ? await db('PATCH', `${filter}&version=eq.${row.version}&select=version`,
        { version: Number(row.version) + 1, state }, representation, resource) :
        await db('POST', '?select=version', { room_code: room.code, state }, representation, resource);
      if (rows?.length === 1) return { game: gameView(state, who.id), version: Number(rows[0].version) };
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }
  fail(409, '另一位玩家正在更新進度，請稍後再試。');
}
