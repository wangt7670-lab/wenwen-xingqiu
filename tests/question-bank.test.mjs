import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bank } from '../public/question-bank.js';
import { drawQuestion, isDuplicate, LEVELS, questionKey, safeSourceUrl, STYLES, validDate } from '../public/question-tools.js';
import { sourceLink } from '../public/studio.js';

test('150 distinct cards cover all six topics and carry valid answers, explanations and source metadata', () => {
  assert.equal(bank.length, 150);
  assert.equal(new Set(bank.map(q => q.id)).size, 150);
  assert.equal(new Set(bank.map(q => questionKey(q.question))).size, 150);
  for (const topic of ['couple','why','science','history','riddle','news']) {
    const cards = bank.filter(q => q.topic === topic);
    assert.equal(cards.length, 25);
    assert.deepEqual(new Set(cards.map(q => q.level)), new Set(Object.keys(LEVELS)));
    for (const q of cards) {
      assert.ok(q.explanation && Object.hasOwn(STYLES,q.style));
      if (q.type === 'choice') {
        assert.equal(q.options.length, 4);
        assert.equal(new Set(q.options).size, 4);
        assert.ok(q.options[q.answerIndex]);
      } else {
        assert.deepEqual(q.options, []);
        if (topic !== 'couple') assert.ok(q.referenceAnswer);
      }
      if (['why','science','history','news'].includes(topic)) assert.ok(safeSourceUrl(q.source_url) && q.source_title);
      if (topic === 'news') assert.equal(q.tag, '媒體識讀練習');
    }
  }
});

test('drawing excludes normalized history and already drawn cards until exhaustion', () => {
  const cards = bank.filter(q => q.topic === 'science');
  const recent = cards.slice(0,5).map(q => `${q.question}！`);
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const next = drawQuestion(cards, seen, recent, () => 0);
    assert.ok(next, `Card ${i + 1} should be available`);
    assert.ok(!recent.includes(`${next.question}！`));
    assert.ok(!seen.includes(next.id));
    seen.push(next.id);
  }
  assert.equal(drawQuestion(cards, seen, recent), null);
  assert.ok(drawQuestion(cards, [], []));
  assert.ok(isDuplicate('為什麼閃電通常比雷聲先被看到？', ['為甚麼閃電通常比雷聲先被看到！']));
});

test('source cards accept HTTPS and escape titles; impossible calendar dates are rejected', () => {
  assert.equal(sourceLink({source_url:'javascript:alert(1)'}), '');
  assert.equal(sourceLink({source_url:'https://example.org@evil.org/'}), '');
  assert.match(sourceLink({source_url:'https://example.org',source_title:'<script>'}), /&lt;script&gt;/);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2024-02-29'), true);
});
