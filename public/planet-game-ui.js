import { catalogCards, gameModes, gameView, playGame, startGame } from './planet-game.js';
import { escape } from './studio.js';

const storageKey = 'wenwen-planet-game-v1';
const button = (label, action, style = 'subtle') => `<button type="button" class="button ${style}" data-planet-action="${action}">${label}</button>`;

export function mountPlanetGame({ panel, visible, session, room, request, invite }) {
  const controls = panel.querySelector('#planet-controls');
  const connection = panel.querySelector('#planet-connection');
  const message = panel.querySelector('#planet-message');
  const gamePanel = panel.querySelector('#planet-board');
  let selected = 'quiz', kind = 'solo', difficulty = 0, count = 10;
  let activeSession, game, cards, version = -1, busy = false, reading = false, ready = false;
  let layout = '', formKey = '';

  const showMessage = text => { message.textContent = text; };
  const name = id => kind === 'solo' ? '你' : escape(room().players.find(player => player.id === id)?.name || '玩家');
  const requestGame = (suffix = '', body) => request(`/api/rooms/${encodeURIComponent(activeSession.room)}/planet-game${suffix}`,
    { auth: true, ...(body ? { method: 'POST', body } : {}) });

  function clock() {
    const target = gamePanel.querySelector('[data-planet-clock]');
    if (!target) return;
    const seconds = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
    target.textContent = seconds ? `思考時間 ${seconds} 秒` : '思考時間已到，仍可作答或跳過。';
  }

  function draw() {
    const key = JSON.stringify([game, selected, kind, ready, Boolean(activeSession)]);
    if (key === layout) return;
    layout = key;
    const field = gamePanel.querySelector('#planet-answer');
    const typed = field?.value ?? '';
    const focus = document.activeElement === field;
    const currentKey = game && `${kind}:${game.id}:${game.step}`;
    const preserve = currentKey === formKey;
    formKey = currentKey;
    controls.querySelector('#planet-kind').value = kind;
    if (kind === 'pair' && !activeSession) {
      gamePanel.innerHTML = `<p>建立房間或使用原有邀請連結，兩人就能一起玩。</p>${button('房間與邀請', 'invite', 'primary')}`;
      return;
    }
    if (!ready) {
      gamePanel.innerHTML = `<p>正在等候遊戲資料。</p>${button('重新整理', 'retry')}`;
      return;
    }
    if (!game || game.completed) {
      const choices = Object.entries(gameModes).map(([id, label]) =>
        `<option value="${id}" ${id === selected ? 'selected' : ''}>${label}</option>`).join('');
      const levels = [0, 1, 2, 3].map(level => `<option value="${level}" ${level === difficulty ? 'selected' : ''}>${level ? '難度 ' + level : '所有難度'}</option>`).join('');
      gamePanel.innerHTML = `${game?.completed ? `<p>本局已結束。${game.mode === 'quiz' ? scores() : ''}</p>` : ''}
        <form id="planet-start" class="planet-form">
          <label>玩法 <select name="mode">${choices}</select></label>
          ${selected === 'quiz' ? `<label>難度 <select name="difficulty">${levels}</select></label>` : ''}
          <label>每局最多幾題 <input type="number" min="1" max="10" required name="count" value="${count}"></label>
          <button class="button primary" type="submit">開始遊戲</button>
        </form>`;
      return;
    }
    const quiz = game.mode === 'quiz';
    const canNext = !quiz || (game.revealed && Object.values(game.entries).every(entry => entry.skipped || typeof entry.correct === 'boolean'));
    const other = game.players.find(id => id !== (kind === 'solo' ? 'solo' : activeSession.playerId));
    const result = game.revealed ? `<div class="result-panel">
      ${quiz ? `<p><b>標準答案</b> ${escape(game.correctAnswer)}</p><p><b>為什麼</b> ${escape(game.explanation)}</p>` : ''}
      ${game.players.map(id => {
        const entry = game.entries[id];
        const judgement = entry.correct === true ? ' · 答對（＋10 分）' : entry.correct === false ? ' · 答錯' : '';
        return `<p><b>${name(id)}</b> ${entry.skipped ? '已跳過' : escape(entry.text)}${judgement}</p>`;
      }).join('')}
      ${game.followUp ? `<p>${escape(game.followUp)}</p>` : ''}
      ${quiz && !game.own.skipped ? `<p>同義答案也算答對。${typeof game.own.correct === 'boolean' ? '可在下一題前改判。' : '請為自己的答案評分。'}</p><div class="planet-actions">${button('答對', 'correct')}${button('答錯', 'incorrect')}</div>` : ''}
      <div class="planet-actions">${canNext ? button(game.step + 1 === game.total ? '完成這局' : '下一題', 'next', 'primary') : '<span>等待完成自評。</span>'}</div>
    </div>` : '';
    const input = !game.own ? (game.mode === 'yes_no' ? `<div class="planet-actions">${button('是', 'yes', 'primary')}${button('否', 'no', 'primary')}</div>` :
      '<form id="planet-submit" class="planet-form"><label for="planet-answer">你的答案</label><textarea id="planet-answer" maxlength="1000" required></textarea><button type="submit" class="button primary">送出答案</button></form>') : '';
    gamePanel.innerHTML = `<p class="planet-meta">${gameModes[game.mode]} · 第 ${game.step + 1}／${game.total} 題${quiz ? ` · 難度 ${game.question.difficulty}` : ''}</p>
      <h3>${escape(game.question.text)}</h3>${quiz ? `<p>${scores()}</p>` : ''}
      ${quiz && !game.revealed && !game.own ? '<p data-planet-clock></p>' : ''}${input}${result}
      ${!game.revealed && other && game.own ? `<p role="status">已送出，等待 ${name(other)} 作答或跳過。重新連線後可繼續。</p>` : ''}
      ${!game.revealed && other && !game.own && game.submitted.includes(other) ? `<p role="status">${name(other)} 已送出，等你作答。</p>` : ''}
      <div class="planet-actions">${!game.revealed && !game.own ? button(quiz && kind === 'solo' ? '跳過並揭曉答案' : '跳過這題', 'skip') : ''}${button('結束本局', 'end', 'ghost')}</div>`;
    if (preserve && gamePanel.querySelector('#planet-answer')) {
      const replacement = gamePanel.querySelector('#planet-answer');
      replacement.value = typed;
      if (focus) { replacement.focus(); replacement.setSelectionRange(typed.length, typed.length); }
    }
    clock();
  }

  const scores = () => game.players.map(id => `${name(id)} ${game.scores[id]} 分`).join(' · ');

  function useResponse(result) {
    if (result.version < version) return;
    version = result.version;
    game = result.game;
    ready = true;
    draw();
  }

  async function refresh() {
    if (!visible() || kind !== 'pair' || !activeSession || reading) return;
    const target = activeSession;
    reading = true;
    try {
      const result = await requestGame();
      if (kind === 'pair' && target === activeSession) {
        useResponse(result);
        connection.textContent = '';
      }
    } catch {
      if (kind === 'pair' && target === activeSession) connection.textContent = '雙人連線暫時中斷，正在嘗試重新連線。';
    } finally {
      reading = false;
    }
  }

  function open(mode, contextChanged = false) {
    if (mode) selected = mode;
    const latest = session();
    if (latest !== activeSession || contextChanged) {
      const firstOpen = activeSession === undefined;
      activeSession = latest;
      let next = latest ? 'pair' : 'solo';
      try {
        if (firstOpen && latest && sessionStorage.getItem('wenwen-planet-solo-in-room') === latest.room) next = 'solo';
      } catch {}
      switchKind(next);
    } else {
      draw();
      refresh();
    }
  }

  function switchKind(next) {
    kind = next;
    try { sessionStorage.setItem('wenwen-planet-solo-in-room', kind === 'solo' ? activeSession?.room ?? '' : ''); }
    catch {}
    version = -1;
    ready = kind === 'solo';
    game = null;
    showMessage('');
    connection.textContent = '';
    if (ready) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        game = gameView(saved, 'solo');
      } catch {
        ready = false;
        showMessage('無法讀取本機進度，請檢查瀏覽器的網站資料設定。');
      }
    }
    draw();
    refresh();
  }

  async function loadCards() {
    if (!cards) {
      const response = await fetch('./data/wenwen-questions.json', { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw Error('題庫載入失敗，請再試一次。');
      try { cards = catalogCards(await response.json()); }
      catch { throw Error('題庫資料不完整，請重新載入。'); }
    }
    return cards;
  }

  async function act(action, input = {}) {
    if (busy || !ready) return;
    const target = activeSession;
    const mode = kind;
    busy = true;
    showMessage('');
    const body = { ...input, ...(action === 'start' ? { previousId: game?.id } : { id: game?.id, step: game?.step }) };
    try {
      if (mode === 'pair') {
        const result = await requestGame('/' + action, body);
        if (mode === kind && target === activeSession) useResponse(result);
      } else {
        const latest = JSON.parse(localStorage.getItem(storageKey) || 'null');
        const updated = action === 'start' ? startGame(latest, body, await loadCards(), ['solo'], crypto.randomUUID(), Date.now()) :
          playGame(latest, action, body, 'solo', Date.now());
        if (action === 'start' && JSON.parse(localStorage.getItem(storageKey) || 'null')?.id !== latest?.id) throw Error('另一個分頁已更新進度，請重試。');
        localStorage.setItem(storageKey, JSON.stringify(updated));
        if (kind === mode) {
          game = gameView(updated, 'solo');
          draw();
        }
      }
    } catch (error) {
      if (mode === kind && target === activeSession) {
        showMessage(error.message);
        if (mode === 'pair') refresh();
      }
    } finally {
      busy = false;
    }
  }

  panel.addEventListener('change', event => {
    const target = event.target;
    if (target.id === 'planet-kind') switchKind(target.value);
    if (target.name === 'count') count = target.valueAsNumber || 10;
    if (target.name === 'difficulty') difficulty = Number(target.value);
    if (target.name === 'mode') { selected = target.value; draw(); }
  });
  panel.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.id === 'planet-start') act('start', { mode: selected, difficulty, count });
    if (event.target.id === 'planet-submit') act('submit', { text: gamePanel.querySelector('#planet-answer').value });
  });
  panel.addEventListener('click', event => {
    const action = event.target.closest('[data-planet-action]')?.dataset.planetAction;
    if (action === 'retry') switchKind(kind);
    if (action === 'invite') invite();
    if (action === 'yes' || action === 'no') act('submit', { text: action === 'yes' ? '是' : '否' });
    if (action === 'correct' || action === 'incorrect') act('rate', { correct: action === 'correct' });
    if (action === 'skip' || action === 'next') act(action);
    if (action === 'end' && window.confirm('結束目前這局？')) act(action);
  });
  window.addEventListener('storage', event => {
    if (event.key === storageKey && kind === 'solo' && visible()) switchKind('solo');
  });
  setInterval(() => { if (visible()) clock(); }, 1000);
  return { open, refresh };
}
