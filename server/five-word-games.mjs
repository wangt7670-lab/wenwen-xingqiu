import { randomUUID } from 'node:crypto';
import data from '../public/data/wenwen_five_word_cards_180_v4.json' with { type: 'json' };
import { WordGameError, changeWordGame, prepareWordGame, readWordCards } from '../public/five-word-game.js';
import { fail, readBody } from './http.mjs';

const catalog = readWordCards(data);
const table = 'quiz_word_games';
const representation = { Prefer: 'return=representation' };

export async function handleWordGame(request, { db, room, who, parts }) {
  const [, action, extra] = parts;
  const read = request.method === 'GET' && !action;
  const write = request.method === 'POST' && !extra && ['setup', 'consent', 'start', 'submit', 'score', 'next', 'clear'].includes(action);
  if (!read && !write) fail(405, '不支援這個操作。');
  const filter = `?room_code=eq.${room.code}`;
  const [row] = await db('GET', `${filter}&select=version,state&limit=1`, undefined, {}, table);
  const version = Number(row?.version ?? 0);
  if (read) return { version, game: row?.state ?? null };

  const input = await readBody(request);
  if (input.version !== version) fail(409, '另一位玩家已更新，請確認最新進度。');
  let state;
  try {
    if (action === 'setup') {
      if (room.players[0].id !== who.id) fail(403, '由房主設定接龍。');
      if (row?.state || input.agree !== true) fail(409, '請先同意保存，並清除舊局後再開始。');
      state = prepareWordGame(input, room.players.map(player => player.id), randomUUID(), true);
    } else {
      state = changeWordGame(row?.state, action, input, who.id, catalog, Date.now());
    }
  } catch (error) {
    if (error instanceof WordGameError) fail(error.status, error.message);
    throw error;
  }

  // The conditional update publishes the complete next turn and its draw in one write.
  const updated = row ? await db('PATCH', `${filter}&version=eq.${version}&select=version`,
    { version: version + 1, state }, representation, table) :
    await db('POST', '?select=version', { room_code: room.code, state }, representation, table);
  if (updated?.length !== 1) fail(409, '另一位玩家已更新，請確認最新進度。');
  return { version: Number(updated[0].version), game: state };
}
