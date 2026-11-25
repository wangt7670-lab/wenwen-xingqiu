import { changeWordGame, matchedWords, prepareWordGame, readWordCards, wordBonuses, wordLengths, wordModes, wordStoryText, wordThemes, wordTurnText } from './five-word-game.js';
import { escape } from './studio.js';

const button = (text, action, style = 'subtle') => `<button class="button ${style}" type="button" data-word-action="${action}">${text}</button>`;
const options = (items, selected) => items.map(([value, label]) =>
  `<option value="${escape(value)}" ${value === selected ? 'selected' : ''}>${escape(label)}</option>`).join('');

export function mountWordGame({ panel, visible, session, room, request, invite }) {
  const board = panel.querySelector('#word-board');
  const message = panel.querySelector('#word-message');
  const connection = panel.querySelector('#word-connection');
  const scopeField = panel.querySelector('#word-scope');
  const local = new Map();
  let activeSession, online = null, version = -1, scope = 'local', catalog;
  let config = { mode: 'relay', theme: '混搭', total: 4 };
  let format = 'text', rendering = '', writingKey = '', checking = false, busy = false;
  const game = () => scope === 'room' ? online : local.get(config.mode);
  const label = (id, players) => {
    const letter = id === players[0] ? 'A' : 'B';
    const nickname = scope === 'room' ? room().players.find(player => player.id === id)?.name : '';
    return nickname ? `玩家 ${letter}（${nickname}）` : `玩家 ${letter}`;
  };
  const roomRequest = (path = '', body) => request(`/api/rooms/${encodeURIComponent(activeSession.room)}/word-game${path}`,
    { auth: true, ...(body ? { method: 'POST', body } : {}) });

  function clock() {
    const field = board.querySelector('[data-word-clock]');
    if (!field) return;
    const seconds = Math.max(0, Math.ceil((game().turns.at(-1).deadline - Date.now()) / 1000));
    field.textContent = seconds ? `剩餘 ${seconds} 秒` : '時間到，仍可繼續，分數照常計算。';
  }

  function match() {
    const list = board.querySelector('#word-match');
    if (!list) return;
    const turn = game().turns.at(-1);
    const found = matchedWords(turn.cards, board.querySelector('#word-text').value);
    list.textContent = `原詞符合 ${found.length}／5 · 待核對：${turn.cards.filter(card => !found.includes(card.id)).map(card => card.word).join('、') || '已齊全'}`;
  }

  function render() {
    const state = game();
    const members = scope === 'room' ? room().players.map(({id,name}) => [id,name]) : [];
    const key = JSON.stringify([scope, Boolean(activeSession), scope === 'room' && version < 0, state, config, format, members]);
    if (rendering === key) return;
    rendering = key;
    const nextWritingKey = state?.status === 'writing' ? `${scope}:${state.id}:${state.turns.length}` : '';
    const priorText = nextWritingKey === writingKey ? board.querySelector('#word-text')?.value : undefined;
    writingKey = nextWritingKey;
    scopeField.value = scope;
    if (scope === 'room' && !activeSession) {
      board.innerHTML = `<p>使用現有雙人房間一起接龍。</p>${button('建立或加入房間', 'invite', 'primary')}`;
      return;
    }
    if (scope === 'room' && version < 0) {
      board.innerHTML = `<p>正在讀取房間故事。</p>${button('重新整理', 'retry')}`;
      return;
    }
    const modeMenu = scope === 'local' ? `<label>玩法 <select id="word-mode">${options(Object.entries(wordModes), config.mode)}</select></label>` : '';
    if (!state) {
      const isHost = scope === 'local' || room().players[0]?.id === activeSession.playerId;
      board.innerHTML = !isHost ? '<p>等待房主設定故事接龍。</p>' :
        `<form class="planet-form" id="word-setup">${modeMenu}
          <label>主題 <select name="theme">${options(wordThemes.map(theme => [theme, theme]), config.theme)}</select></label>
          ${scope === 'room' || config.mode === 'relay' ? `<label>總棒數 <select name="total">${options(wordLengths.map(n => [n, String(n)]), config.total)}</select></label>` : ''}
          ${scope === 'room' ? '<label class="word-check"><input type="checkbox" name="agree" required> 我同意把本局的文字與自填口述摘要保存在房間。兩人都可清除本局。</label>' : ''}
          <button type="submit" class="button primary">${scope === 'room' ? '設定接龍' : '抽取第一棒 5 張詞卡'}</button>
        </form>`;
      return;
    }
    const who = activeSession?.playerId;
    const names = id => escape(label(id, state.players));
    const score = state.players.map(id => `${names(id)} ${state.scores[id]} 分`).join(' · ');
    if (state.status === 'setup') {
      board.innerHTML = `<p>${escape(state.theme)} · ${state.total} 棒</p>
        ${!state.consent.includes(who) ? `<form id="word-consent" class="planet-form"><label class="word-check"><input type="checkbox" name="agree" required> 我同意把本局的文字與自填口述摘要保存在房間。兩人都可清除本局。</label><button class="button primary">同意保存</button></form>` :
          state.consent.length === 2 && state.players[0] === who ? button('開始接龍並抽卡', 'start', 'primary') : '<p>等兩位玩家同意後，由房主開始。</p>'}
        <div class="planet-actions">${button('取消設定', 'clear')}</div>`;
      return;
    }
    const turn = state.turns.at(-1);
    const relay = state.mode === 'relay';
    const mine = scope === 'local' || turn.writer === who;
    const partner = scope === 'local' || turn.writer !== who;
    const headline = relay ? turn.number === 1 ? '開頭：交代角色或目標，埋下伏筆。' : turn.number === state.total ?
      '結局：承接前文，為角色與事件收尾。' : '接續：延續前一棒的人物、目標或事件。' :
      state.mode === 'sentence' ? '用這五張詞卡組成一句話。' : '用這五張詞卡編一段有開頭和結尾的故事。';
    const timeline = relay && state.turns.some(entry => entry.review) ? `<section class="word-timeline"><h3>故事時間線</h3><ol>${state.turns.filter(entry => entry.review).map(entry =>
      `<li><h4>第 ${entry.number} 棒 · ${names(entry.writer)} · ${entry.review.points} 分</h4><p>${escape(entry.cards.map(card => card.word).join('、'))}</p><blockquote>${escape(wordTurnText(entry))}</blockquote>
      <p>基礎 ${entry.review.base} 分 · 創意 ${entry.review.bonus} 分${entry.review.continuity === null ? '' : entry.review.continuity ? ' · 接續確認' : ' · 待加強接續'}</p></li>`).join('')}</ol></section>` : '';
    const cards = `<div class="word-cards" aria-label="本棒五張詞卡">${turn.cards.map(card => `<div data-word-id="${card.id}"><small>${card.category}</small><b>${escape(card.word)}</b></div>`).join('')}</div>`;

    let action;
    if (state.status === 'writing') {
      action = `<p>${names(turn.writer)} 作答</p><p data-word-clock></p>${mine ?
        `<form id="word-submit" class="word-writing"><label>回答方式 <select id="word-format">${options([['text', '文字'], ['oral', '口述']], format)}</select></label>
        <label for="word-text">${format === 'oral' ? '這一棒故事摘要（選填）' : '這一棒故事'}</label>
        <textarea id="word-text" name="text" rows="4" maxlength="3000" ${format === 'text' ? 'required' : ''}></textarea>
        ${format === 'text' ? '<p id="word-match"></p>' : '<p>口述請直接講給對方聽，只有你輸入的摘要會留在故事裡。</p>'}
        <button class="button primary">提交給對方評分</button></form>` : '<p>等待對方提交。</p>'}`;
    } else if (state.status === 'review') {
      const reviewer = state.players.find(id => id !== turn.writer);
      action = `<h3>${names(reviewer)} 核對與評分</h3><blockquote>${escape(wordTurnText(turn))}</blockquote>${partner ?
        `<form id="word-review" class="word-writing"><fieldset><legend>勾選本棒確實用到的詞，合理改寫也算</legend>${turn.cards.map(card =>
          `<label class="word-check"><input type="checkbox" name="used" value="${card.id}" ${turn.matches.includes(card.id) ? 'checked' : ''}> ${escape(card.word)}</label>`).join('')}</fieldset>
          ${relay && turn.number > 1 ? '<label>是否接續前文？ <select name="continuity" required><option value="">請選擇</option><option value="yes">有接續</option><option value="no">待加強</option></select></label>' : ''}
          <label>創意加分 <select name="bonus">${options(wordBonuses.map(n => [n, String(n)]), 0)}</select></label><button class="button primary">確認評分</button></form>` : '<p>等待對方評分。</p>'}`;
    } else if (state.status === 'scored') {
      action = `<p>本棒 ${turn.review.points} 分（基礎 ${turn.review.base} ＋ 創意 ${turn.review.bonus}）。</p>${partner ? button('換下一位抽卡', 'next', 'primary') : '<p>等待下一位抽卡。</p>'}`;
    } else {
      action = `<h3>故事已完成</h3><p>${score}</p><div class="planet-actions">${button('下載 TXT', 'download', 'primary')}${button('再編一個故事', 'clear')}</div>`;
    }
    board.innerHTML = `${modeMenu ? `<div class="planet-form">${modeMenu}</div>` : ''}
      <p class="planet-meta">${wordModes[state.mode]} · ${escape(state.theme)} · 第 ${turn.number}${relay ? `／${state.total} 棒` : ' 回合'}</p>
      ${state.status !== 'completed' ? `<p>${headline}</p><p>${score}</p>${cards}` : ''}${timeline}${action}
      ${state.status !== 'completed' ? `<div class="planet-actions">${button('清除本局', 'clear', 'ghost')}</div>` : ''}`;
    if (priorText !== undefined && board.querySelector('#word-text')) board.querySelector('#word-text').value = priorText;
    clock();
    match();
  }

  function apply(result) {
    if (result.version < version) return;
    version = result.version;
    online = result.game;
    render();
  }

  async function refresh() {
    if (!visible() || scope !== 'room' || !activeSession || checking) return;
    const target = activeSession;
    checking = true;
    try {
      const result = await roomRequest();
      if (activeSession === target && scope === 'room') {
        apply(result);
        connection.textContent = '';
      }
    } catch {
      if (activeSession === target && scope === 'room') connection.textContent = '連線暫時中斷。重新連線後會讀取已提交的進度。';
    } finally { checking = false; }
  }

  function open() {
    const latest = session();
    if (activeSession !== latest) {
      activeSession = latest;
      scope = latest ? 'room' : 'local';
      online = null;
      version = -1;
      message.textContent = '';
      connection.textContent = '';
    }
    render();
    refresh();
  }

  async function act(action, values = {}) {
    if (busy) return;
    busy = true;
    message.textContent = '';
    const target = activeSession;
    const currentScope = scope;
    const state = game();
    const input = { version, id: state?.id, turn: state?.turns.length, ...values };
    try {
      if (currentScope === 'room') {
        const result = await roomRequest('/' + action, input);
        if (activeSession === target && scope === currentScope) apply(result);
      } else {
        if (!catalog) {
          const response = await fetch('./data/wenwen_five_word_cards_180_v4.json', { signal: AbortSignal.timeout(12000) });
          if (!response.ok) throw Error('詞卡載入失敗，請再試一次。');
          catalog = readWordCards(await response.json());
        }
        const mode = state?.mode ?? input.mode;
        const player = action === 'score' || action === 'next' ? state.players.find(id => id !== state.turns.at(-1).writer) :
          state?.turns.at(-1)?.writer ?? 'A';
        let result;
        if (action === 'setup') {
          const setup = prepareWordGame(input, ['A', 'B'], crypto.randomUUID(), false);
          result = changeWordGame(setup, 'start', { id: setup.id, turn: 0 }, 'A', catalog, Date.now());
        } else result = changeWordGame(state, action, input, player, catalog, Date.now());
        if (result) local.set(mode, result);
        else local.delete(mode);
        render();
      }
    } catch (error) {
      message.textContent = error.message;
      refresh();
    } finally { busy = false; }
  }

  panel.addEventListener('change', event => {
    const field = event.target;
    if (field.id === 'word-scope') {
      scope = field.value;
      message.textContent = '';
      connection.textContent = '';
      render();
      refresh();
    } else if (field.id === 'word-mode') {
      config.mode = field.value;
      message.textContent = '';
      render();
    } else if (field.id === 'word-format') {
      format = field.value;
      render();
    } else if (field.name === 'theme') config.theme = field.value;
    else if (field.name === 'total') config.total = Number(field.value);
  });
  panel.addEventListener('input', event => { if (event.target.id === 'word-text') match(); });
  panel.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.target);
    if (event.target.id === 'word-setup') act('setup', { ...config, mode: scope === 'room' ? 'relay' : config.mode, agree: data.has('agree') });
    if (event.target.id === 'word-consent') act('consent', { agree: data.has('agree') });
    if (event.target.id === 'word-submit') act('submit', { format, text: data.get('text') });
    if (event.target.id === 'word-review') act('score', { words: data.getAll('used'), bonus: Number(data.get('bonus')), continuity: data.get('continuity') === 'yes' });
  });
  panel.addEventListener('click', event => {
    const action = event.target.closest('[data-word-action]')?.dataset.wordAction;
    if (action === 'invite') invite();
    if (action === 'retry') refresh();
    if (action === 'start' || action === 'next') act(action);
    if (action === 'clear' && window.confirm('清除本局故事與分數？請先下載想保留的故事。')) act(action);
    if (action === 'download') {
      const state = game();
      const blob = new Blob(['\uFEFF' + wordStoryText(state, id => label(id, state.players))], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '問問星球_故事接龍.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  setInterval(() => { if (visible()) clock(); }, 1000);
  return { open, refresh };
}
