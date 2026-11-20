export const LEVELS = { light: '輕鬆', medium: '中等', hard: '挑戰' };
export const STYLES = { serious: '認真', funny: '搞笑', creative: '腦洞' };

export function questionKey(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function bigrams(key) {
  return new Set(Array.from(key.slice(1), (_, i) => key.slice(i, i + 2)));
}

export function isDuplicate(question, others) {
  const key = questionKey(question);
  const pairs = bigrams(key);
  return others.some(item => {
    const other = questionKey(item);
    if (key === other) return true;
    if (Math.min(key.length, other.length) < 8) return false;
    const comparison = bigrams(other);
    let matches = 0;
    for (const pair of pairs) if (comparison.has(pair)) matches++;
    return (2 * matches) / (pairs.size + comparison.size) >= 0.82;
  });
}

export function drawQuestion(items, seenIds, recent, random = Math.random) {
  const seen = new Set(seenIds);
  const available = items.filter(q => !seen.has(q.id) && !isDuplicate(q.question, recent));
  return available[Math.floor(random() * available.length)] ?? null;
}

export function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 450 || !/^https:\/\//i.test(value) || /[\s\\]/.test(value)) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 450 ? url.href : '';
  } catch {
    return '';
  }
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
