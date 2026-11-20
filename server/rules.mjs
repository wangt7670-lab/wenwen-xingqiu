import { createHash, randomUUID } from 'node:crypto';
import { bank } from '../public/question-bank.js';
import { isDuplicate, questionKey } from '../public/question-tools.js';

export const TOPICS = new Set(['couple', 'why', 'science', 'history', 'riddle', 'news']);
export const fingerprint = text => createHash('sha256').update(questionKey(text)).digest('hex');

export function validOptions(options, index) {
  return Array.isArray(options) && options.length === 4 && Number.isInteger(index) && index >= 0 && index < 4 &&
    options.every((value, i) => typeof value === 'string' && value.length <= 120 && questionKey(value) &&
      !isDuplicate(value, options.slice(0, i)));
}

export function sourceRef(document, sectionIndex, includeExcerpt = true) {
  const section = document.sections[sectionIndex];
  return {
    title: document.title, location: section.location,
    ...(includeExcerpt ? { excerpt: section.text.slice(0, 340) } : {})
  };
}

function candidates(sections) {
  const result = [];
  for (const [index, section] of sections.entries()) {
    const line = section.text;
    const definition = line.match(/^([^：:。；！？\n]{2,32})[：:]\s*(.{4,240})$/u);
    if (definition) {
      result.push({
        index, kind: 'term', value: definition[1].trim(), definition: definition[2],
        masked: `哪個名詞符合這項描述？「${definition[2]}」`,
        open: `根據資料，如何解釋「${definition[1].trim()}」？`
      });
      continue;
    }
    const value = line.match(/\d{4}年(?:\d{1,2}月(?:\d{1,2}日)?)?|\d{4}-\d{2}-\d{2}|\d+(?:\.\d+)?\s*(?:公里|公尺|公斤|公克|小時|分鐘|秒|%|％|人|個|層|度|年|月|日)/u);
    if (!value || line.length > 240 || line.split(value[0]).length !== 2) continue;
    const kind = /^\d{4}(?:年|[-])/u.test(value[0]) ? 'date' : value[0].replace(/[\d.\s]/g, '').replace('％', '%');
    result.push({ index, kind, value: value[0], masked: `依資料填空：${line.replace(value[0], '＿＿＿')}` });
  }
  return result;
}

export function documentDrafts(document, { type, topic, count }, excluded = []) {
  const facts = candidates(document.sections);
  const questions = [];
  const seen = [...excluded];
  const add = (index, question, referenceAnswer, options = [], answerIndex = 0) => {
    if (questions.length >= count || isDuplicate(question, seen)) return;
    seen.push(question);
    questions.push({
      id: randomUUID(), topic, type, question, options, answerIndex, referenceAnswer,
      explanation: '可對照附上的資料片段。', reviewState: 'draft', origin: 'rules', generatedAt: Date.now(),
      documentId: document.id, sectionIndex: index, source: sourceRef(document, index)
    });
  };

  for (const fact of facts) {
    if (type === 'open') {
      add(fact.index, fact.open ?? fact.masked, fact.definition ?? fact.value);
      continue;
    }
    const alternatives = [];
    for (const other of facts) {
      if (other.kind === fact.kind && !isDuplicate(other.value, [fact.value, ...alternatives])) alternatives.push(other.value);
      if (alternatives.length === 3) break;
    }
    const answerIndex = fact.index % 4;
    alternatives.splice(answerIndex, 0, fact.value);
    if (validOptions(alternatives, answerIndex)) add(fact.index, fact.masked, '', alternatives, answerIndex);
  }

  if (type === 'open') {
    for (const [index, section] of document.sections.entries()) {
      if (facts.some(fact => fact.index === index) || section.text.length < 12 || section.text.length > 300) continue;
      add(index, `依「${section.location}」的資料，請用一句話概括「${section.text.slice(0, 16)}…」這段內容。`, section.text);
    }
  }
  return questions;
}

export function builtInDrafts(settings, excluded) {
  const { topic, type, count, keywords, level, style } = settings;
  const search = questionKey(keywords);
  const questions = [];
  for (const item of bank) {
    if (questions.length === count) break;
    if (item.topic !== topic || (level && item.level !== level) || (style && item.style !== style) ||
        (search && !questionKey([item.question, item.explanation, ...item.options].join(' ')).includes(search)) ||
        isDuplicate(item.question, excluded)) continue;
    if (type === 'choice' && item.type !== 'choice') continue;
    questions.push({
      ...item, id: randomUUID(), type, options: type === 'choice' ? item.options : [],
      answerIndex: type === 'choice' ? item.answerIndex : 0,
      referenceAnswer: type === 'open' && item.type === 'choice' ? item.options[item.answerIndex] : item.referenceAnswer,
      origin: 'rules', reviewState: 'draft', generatedAt: Date.now()
    });
  }
  return questions;
}
