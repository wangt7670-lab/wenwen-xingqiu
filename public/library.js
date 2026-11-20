import { escape, sourceLink } from './studio.js';

export function documentsPanel(documents, selected, topicOptions, settings, canUse) {
  if (!canUse) return '<p>加入線上房間後，即可上傳自己的資料。</p><button class="button primary" data-editor="connect">連接房間</button>';
  return `<h3>用你的資料出題</h3>
    <p class="lead">每份最多 3 MiB，PDF 最多 40 頁。原檔只有你可開啟；審核分享時，題目會連同引用片段加入房間題庫。</p>
    <form id="document-upload">
      <div class="field"><label for="document-file">選擇 TXT、Markdown、PDF 或 DOCX</label><input id="document-file" type="file" accept=".txt,.md,.pdf,.docx"></div>
      <div class="field"><label for="document-text">或貼上文字</label><textarea id="document-text" maxlength="120000" placeholder="例如：地球的衛星：月球是地球唯一的天然衛星。"></textarea></div>
      <p class="tip">每次選一種來源。掃描圖檔請先轉成可選取的文字。</p>
      <button class="button subtle" type="submit">上傳並擷取文字</button>
    </form>
    ${documents.length ? `<div class="document-list">${documents.map(doc => `<div class="document-item">
      <strong>${escape(doc.title)}</strong>
      <div class="studio-actions">${doc.state === 'ready' ?
    `<button class="button subtle" data-editor="select-doc" data-id="${escape(doc.id)}" aria-pressed="${doc.id === selected}">${doc.id === selected ? '已選取' : '選取'}</button><button class="link-button" data-editor="download-doc" data-id="${escape(doc.id)}">下載原檔</button>` : ''}
      <button class="link-button" data-editor="delete-doc" data-id="${escape(doc.id)}">${doc.state === 'deleting' ? '再次嘗試刪除' : '刪除'}</button></div>
    </div>`).join('')}</div>` : ''}
    ${selected ? `<form id="document-generate">
      <div class="fields-2">
        <div class="field"><label for="doc-topic">領域</label><select id="doc-topic">${topicOptions.map(item => `<option value="${escape(item.id)}" ${settings.topic === item.id ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="doc-type">題型</label><select id="doc-type"><option value="open">簡答／填空</option><option value="choice" ${settings.type === 'choice' ? 'selected' : ''}>四選一</option></select></div>
        <div class="field"><label for="doc-count">最多幾題</label><select id="doc-count">${[1,5,10].map(n => `<option value="${n}" ${settings.count === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      </div>
      <button class="button primary" type="submit">從原文生成草稿 ↗</button>
    </form>` : ''}`;
}

export function libraryPanel(questions, canUse) {
  if (!canUse) return '<h3>房間題庫</h3><p>加入線上房間後，即可使用共享題庫。</p><button class="button primary" data-editor="connect">連接房間</button>';
  return `<h3>房間題庫</h3>
    <p class="lead">同房玩家可用已核可的題目闖關。</p>
    <div class="studio-actions"><button class="button subtle" data-editor="reload-library">重新整理</button><button class="button primary" data-editor="go-challenge">到雙人闖關 ↗</button></div>
    ${questions.map(q => `<article class="bank-question"><h4>${escape(q.question)}</h4>
      <p class="question-source">${q.type === 'choice' ? '四選一' : '簡答／填空'}</p>
      ${q.owned ? `<div class="studio-actions"><button class="button subtle" data-editor="send-library" data-id="${escape(q.id)}">寄給 TA</button>
      <button class="link-button" data-editor="remove-library" data-id="${escape(q.id)}">移除</button></div>` : ''}
    </article>`).join('') || '<p class="ai-warning">題庫還沒有題目。審核草稿後，即可分享。</p>'}`;
}

export function challengePanel({ challenge, questions, players, me, online, newRound, selected }) {
  if (!online || players.length < 2) return '<h3>雙人闖關</h3><p>等兩位玩家加入同一個線上房間，就能開始闖關。</p><button class="button primary" data-challenge="connect">邀請 TA</button>';
  const name = id => escape(players.find(p => p.id === id)?.name ?? 'TA');
  if (!challenge || (challenge.completed && newRound)) {
    return `<h3>選 3 至 5 題一起闖關</h3>
      <p class="lead">兩人輪流作答，答完會同步揭曉。闖關星星在這裡獨立記錄。</p>
      <button class="link-button" data-challenge="reload">重新讀取題庫</button>
      ${questions.length >= 3 ? `<form id="challenge-start"><div class="challenge-picker">${questions.map(q => `<label><input type="checkbox" name="question" value="${escape(q.id)}" ${selected.has(q.id) ? 'checked' : ''}> <span>${escape(q.question)}</span></label>`).join('')}</div>
      <button type="submit" class="button primary">開始闖關 ↗</button></form>` : '<p>房間題庫至少需要 3 道題。</p><button class="button subtle" data-challenge="library">前往房間題庫</button>'}`;
  }
  const { question: q, answer, completed, step, total, turn, scores } = challenge;
  const score = players.map(p => `${name(p.id)} ${Number(scores[p.id]) || 0} ✦`).join(' · ');
  const answerText = answer && q.type === 'choice'
    ? `<p>${name(answer.playerId)} 選了「${escape(q.options[answer.selectedIndex])}」</p><p>正解為「${escape(q.options[q.answerIndex])}」</p>`
    : answer && `<p>${name(answer.playerId)} 的答案是「${escape(answer.text)}」</p>${q.referenceAnswer ? `<p>參考答案為「${escape(q.referenceAnswer)}」</p>` : ''}`;
  return `<h3>${completed ? '闖關完成！' : `第 ${step+1}／${total} 關`}</h3><p class="lead">${score}</p>
    <progress class="challenge-progress" max="${total}" value="${completed || answer ? step+1 : step}" aria-label="闖關進度"></progress>
    <article class="bank-question"><h4>${escape(q.question)}</h4>
    ${answer ? `${answerText}<p>${escape(q.explanation)}</p>${sourceLink(q)}<p>本關獲得 ${Number(answer.points)} ✦</p>`
    : turn !== me ? `<p>等待 ${name(turn)} 作答。</p>`
    : q.type === 'choice' ? `<div class="answer-choices">${q.options.map((option, index) => `<button class="answer-option" data-challenge="choice" data-index="${index}">${escape(option)}</button>`).join('')}</div>`
    : '<form id="challenge-answer"><label class="field" for="challenge-text">你的答案</label><textarea class="free-answer" id="challenge-text" maxlength="1000" required></textarea><button type="submit" class="button primary">提交答案</button></form>'}
    </article>
    ${completed ? '<button class="button primary" data-challenge="restart">再選一組題目</button>' : answer ? `<button class="button primary" data-challenge="next">${step+1 === total ? '完成闖關' : '下一關 ↗'}</button>` : ''}`;
}
