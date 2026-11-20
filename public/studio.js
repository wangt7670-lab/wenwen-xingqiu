import { isDuplicate, LEVELS, safeSourceUrl, STYLES } from './question-tools.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function select(id, label, choices, selected) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${Object.entries(choices).map(([value, text]) =>
    `<option value="${escape(value)}"${String(selected) === value ? ' selected' : ''}>${escape(text)}</option>`).join('')}</select></div>`;
}

export function sourceLink(q) {
  const url = safeSourceUrl(q.source_url);
  if (!url) return '';
  const dates = q.eventDate && q.publishedDate ?
    `<p class="question-source">事件 ${escape(q.eventDate)} · 發布 ${escape(q.publishedDate)}</p>` : '';
  return `<a class="source-link" target="_blank" rel="noopener noreferrer" href="${escape(url)}">${escape(q.source_title || '查看資料來源')} ↗</a>${dates}`;
}

function preview(q, categoryName) {
  const answer = q.type === 'choice' ? `<div class="preview-options">${q.options.map((option, i) =>
    `<span class="${i === q.answerIndex ? 'correct' : ''}">${'ABCD'[i]}. ${escape(option)} ${i === q.answerIndex ? '✓' : ''}</span>`).join('')}</div>` :
    `<p class="question-source">${q.referenceAnswer ? `參考答案：${escape(q.referenceAnswer)}` : '自由分享想法'}</p>`;
  return `<span class="tiny-label">${escape([categoryName(q.topic), q.tag === '媒體識讀練習' && q.tag, q.type === 'open' ? '簡答題' : '四選一', LEVELS[q.level], STYLES[q.style]].filter(Boolean).join(' · '))}</span>
    <h4>${escape(q.question)}</h4>${answer}<p class="question-source">${escape(q.explanation)}</p>${sourceLink(q)}`;
}

export function bankEditor(q, topic, filters, matched, categoryName) {
  return `<div class="studio-editor"><h3>${topic === 'news' ? '媒體識讀練習' : '抽一張好奇心卡片'}</h3>
    ${topic === 'news' ? `<p class="lead">用情境題練習查證消息。想玩近期新聞，請用 AI 搜尋。</p><button class="button subtle" data-editor="go-ai">✨ 生成即時新聞題</button>` : ''}
    <form id="bank-filters">
      <div class="fields-2">${select('bank-level', '難度', { '': '不限', ...LEVELS }, filters.level)}${select('bank-style', '風格', { '': '不限', ...STYLES }, filters.style)}</div>
      <div class="field"><label for="bank-keywords">搜尋題庫（可選）</label><input id="bank-keywords" maxlength="100" value="${escape(filters.keywords)}"></div>
      <button class="button subtle" type="submit">套用篩選</button>
    </form>
    ${q ? `<div class="bank-question">${preview(q, categoryName)}</div><div class="studio-actions"><button class="button subtle" data-editor="shuffle">↻ 換一題</button><button class="button primary" data-editor="send">💌 寄給 TA ↗</button></div>` :
      `<div class="ai-warning" role="status">${matched ? '符合條件的題目已抽完。你可以重抽本類，或請 AI 生成新題。' : '沒有符合條件的題目，請調整篩選。'}</div>
      <div class="studio-actions">${matched ? '<button class="button subtle" data-editor="reset-bank">重抽本類</button>' : ''}<button class="button primary" data-editor="go-ai">✨ 前往 AI 出題</button></div>`}
    </div>`;
}

export function aiEditor(settings, categories, busy, online, hasKey) {
  const status = !online ? '加入線上房間後即可使用 AI。' : !hasKey ? '伺服器尚未啟用 AI 出題。' : '';
  return `<h3>批量 AI 出題 ✨</h3><form id="ai-settings">
    <div class="fields-2">${select('ai-topic','出題領域',Object.fromEntries(categories.map(q => [q.id,q.name])),settings.topic)}
      ${select('ai-type','題型',{open:'簡答',choice:'四選一'},settings.type)}</div>
    <div class="fields-2">${select('ai-tone','難度',LEVELS,settings.level)}${select('ai-style','風格',STYLES,settings.style)}</div>
    <div class="fields-2">${select('ai-count','題數',{1:'1 題',5:'5 題',10:'10 題'},settings.count)}
      <div class="field"><label for="ai-keywords">關鍵字（可選）</label><input id="ai-keywords" maxlength="150" value="${escape(settings.keywords)}" placeholder="例如：天文、香港歷史"></div></div>
    ${status ? `<p class="ai-warning">${status} <button type="button" class="link-button" data-editor="${online ? 'go-bank' : 'connect'}">${online ? '抽一道內建題' : '連接房間'}</button></p>` : ''}
    <div class="studio-actions"><button class="button primary" type="submit" ${busy || status ? 'disabled' : ''}>${busy ? '正在生成題目…' : '✨ 生成草稿 ↗'}</button></div>
    </form>`;
}

function editFields(q) {
  const id = escape(q.id);
  const area = (key, label, max) => `<div class="field"><label for="${id}-${key}">${label}</label><textarea id="${id}-${key}" data-field="${key}" maxlength="${max}">${escape(q[key])}</textarea></div>`;
  return `<fieldset class="review-fields"><legend>編輯題目</legend>${area('question', '問題', 300)}${q.type === 'open' ?
    area('referenceAnswer', '參考答案', 300) : `<div class="fields-2">${q.options.map((option, i) => `<div class="field"><label for="${id}-option-${i}">選項 ${'ABCD'[i]}</label>
    <input id="${id}-option-${i}" data-option="${i}" maxlength="120" value="${escape(option)}"></div>`).join('')}</div>
    ${select(`${id}-answerIndex`, '正解', {0:'A',1:'B',2:'C',3:'D'}, q.answerIndex)}`}${area('explanation', '解析', 600)}</fieldset>`;
}

export function reviewCard(q, categoryName, { editing, saved, favorites }) {
  const state = { draft: '待審核', approved: '已核可', used: '已使用' }[q.reviewState];
  return `<article class="bank-question review-card" data-question-id="${escape(q.id)}">
    <p class="review-state">AI 生成 · ${state} · ${new Date(q.generatedAt).toLocaleDateString('zh-Hant')}</p>
    ${preview(q, categoryName)}${editing ? editFields(q) : ''}
    <div class="studio-actions">${editing ? `<button class="button primary" data-editor="approve">儲存並核可</button><button class="button subtle" data-editor="cancel-edit">取消編輯</button>` :
      `<button class="button subtle" data-editor="edit">編輯</button>${q.reviewState === 'draft' ? '<button class="button primary" data-editor="approve">核可題目</button>' :
      `${saved ? '' : '<button class="button subtle" data-editor="favorite">♡ 收藏</button>'}<button class="button primary" data-editor="send-ai">💌 寄給 TA ↗</button>`}
      <button class="link-button" data-editor="${favorites ? 'unfavorite' : 'discard'}">${favorites ? '取消收藏' : '移除草稿'}</button>`}</div>
  </article>`;
}

export function readReview(card, question) {
  const fields = Object.fromEntries(Array.from(card.querySelectorAll('[data-field]'), el => [el.dataset.field,el.value.trim()]));
  const q = { ...question, ...fields };
  if (q.type === 'choice' && Object.keys(fields).length) {
    q.options = Array.from(card.querySelectorAll('[data-option]'), el => el.value.trim());
    q.answerIndex = Number(card.querySelector('select').value);
  }
  if (q.question.length < 2 || !/[\p{L}\p{N}]/u.test(q.question)) throw Error('問題至少需要兩個有效字元。');
  if (q.explanation.length < 2) throw Error('請填寫解析。');
  if (q.type === 'open' && q.topic !== 'couple' && !q.referenceAnswer) throw Error('請填寫參考答案。');
  if (q.type === 'choice' && q.options.some((option, i) => !/[\p{L}\p{N}]/u.test(option) || isDuplicate(option,q.options.slice(0,i)))) {
    throw Error('請填寫四個不同的選項。');
  }
  return { ...q, reviewState: 'approved' };
}
