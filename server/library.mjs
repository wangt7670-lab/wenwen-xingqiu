import { randomUUID } from 'node:crypto';
import { fail, readBody, readBytes, str, UUID } from './http.mjs';
import { extractSections, fileSpec, MAX_FILE, objectKey, storageRequest } from './documents.mjs';
import { documentDrafts, fingerprint, sourceRef, TOPICS, validOptions } from './rules.mjs';

const Documents = 'quiz_documents';
const Questions = 'quiz_library_questions';
const docFields = 'id,title,kind,bytes,state,created_at';
const documentView = ({ id, title, kind, bytes, state, created_at }) => ({ id, title, kind, bytes, state, created_at });
const roomFilter = code => `room_code=eq.${code}`;
const ownerFilter = (code, who) => `${roomFilter(code)}&owner_id=eq.${who.id}`;

function checkId(id) {
  if (!UUID.test(id ?? '')) fail(400, '項目識別碼無效。');
}

async function ownDocument(db, code, who, id, readyOnly = true) {
  checkId(id);
  const suffix = readyOnly ? '&state=eq.ready' : '';
  const rows = await db('GET', `?${ownerFilter(code, who)}&id=eq.${id}${suffix}&limit=1`, undefined, {}, Documents);
  if (!rows?.length) fail(404, '找不到可存取的文件。');
  return rows[0];
}

async function upload(request, db, code, who) {
  const file = fileSpec(request.headers.get('x-file-name'));
  const bytes = await readBytes(request, MAX_FILE);
  if (!bytes.length) fail(400, '檔案沒有內容。');
  const metadata = { id: randomUUID(), room_code: code, owner_id: who.id, title: file.title, kind: file.kind, bytes: bytes.length };
  const reserved = await db('POST', '', { document: metadata }, {}, 'rpc/reserve_quiz_document');
  if (!reserved) fail(429, '文件容量已滿。每個房間最多六份文件。');

  const key = objectKey(code, metadata.id);
  const filter = `?${ownerFilter(code, who)}&id=eq.${metadata.id}`;
  let attemptedStorage = false;
  try {
    const sections = await extractSections(bytes, file.kind);
    attemptedStorage = true;
    await storageRequest('save', key, bytes, file.media);
    const result = await db('PATCH', `${filter}&state=eq.pending&select=${docFields}`,
      { state: 'ready', sections }, { Prefer: 'return=representation' }, Documents);
    if (result?.length !== 1) fail(409, '無法完成這次上傳，請再試。');
    return { document: documentView(result[0]) };
  } catch (error) {
    try {
      // A timed-out final PATCH may already have committed. Preserve a completed upload.
      const result = await db('GET', `${filter}&select=${docFields}&limit=1`, undefined, {}, Documents);
      if (result?.[0]?.state === 'ready') return { document: documentView(result[0]) };
      if (attemptedStorage) await storageRequest('delete', key);
      await db('DELETE', `${filter}&state=eq.pending`, undefined, {}, Documents);
    } catch { /* The scheduled cleanup retries pending objects. */ }
    throw error;
  }
}

async function download(document) {
  const file = await storageRequest('get', objectKey(document.room_code, document.id));
  return new Response(file.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="document.${document.kind}"; filename*=UTF-8''${encodeURIComponent(document.title).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))}`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer'
    }
  });
}

async function removeDocument(db, document) {
  const filter = `?${ownerFilter(document.room_code, {id: document.owner_id})}&id=eq.${document.id}`;
  if (document.state === 'pending') fail(409, '檔案還在處理中，請稍後再試。');
  if (document.state === 'ready') {
    await db('PATCH', `${filter}&state=eq.ready`, { state: 'deleting' }, {}, Documents);
  }
  await storageRequest('delete', objectKey(document.room_code, document.id));
  await db('DELETE', `${filter}&state=eq.deleting`, undefined, {}, Documents);
}

function questionCard(row, who) {
  const { answerIndex, referenceAnswer, explanation, source, ...safe } = row.content;
  const own = row.owner_id === who.id;
  return { ...safe, ...(own ? { answerIndex, referenceAnswer, explanation, source } : {}),
    id: row.id, owned: own, linked: Boolean(row.document_id) };
}

async function saveQuestion(request, db, code, who, validateQuestion) {
  const body = await readBody(request);
  if (body.reviewState !== 'approved') fail(400, '請先審核題目，再分享至房間題庫。');
  if (!['open', 'choice'].includes(body.type)) fail(400, '題型無效。');
  const q = validateQuestion({ ...body, source: undefined });
  if (q.type === 'choice' && !validOptions(body.options, body.answerIndex)) fail(400, '選項必須不同，並指定唯一正解。');
  const document = body.documentId ? await ownDocument(db, code, who, body.documentId) : null;
  if (document && (!Number.isInteger(body.sectionIndex) || !document.sections[body.sectionIndex])) fail(400, '找不到引用段落。');
  const content = {
    question: q.question, topic: q.topic, type: q.type, options: q.options, answerIndex: q.answerIndex,
    referenceAnswer: q.referenceAnswer, explanation: q.explanation,
    source_url: q.source_url, source_title: q.source_title,
    ...(document ? { source: sourceRef(document, body.sectionIndex) } : {})
  };
  const id = randomUUID();
  const result = await db('POST', '', { question: {
    id, room_code: code, owner_id: who.id, document_id: document?.id ?? null, fingerprint: fingerprint(q.question), content
  } }, {}, 'rpc/save_quiz_library_question');
  if (result === 'duplicate') fail(409, '房間題庫已有這道題。');
  if (result === 'missing') fail(404, '找不到引用文件。');
  if (result !== 'ok') fail(429, '題庫已滿，每個房間最多 100 道題。');
  return { question: questionCard({ id, content, owner_id: who.id, document_id: document?.id }, who) };
}

export async function getRoomQuestions(db, code, ids) {
  const filter = ids ? `&id=in.(${ids.join(',')})` : '&order=created_at.desc&limit=100';
  return db('GET', `?${roomFilter(code)}&select=id,content,owner_id,document_id${filter}`, undefined, {}, Questions);
}

export async function handleLibrary(request, { db, code, who, parts, validateQuestion }) {
  const [area, id, action] = parts;
  const method = request.method;
  if (area === 'documents') {
    if (!id && method === 'GET') {
      const rows = await db('GET', `?${ownerFilter(code, who)}&select=${docFields}&order=created_at.desc`, undefined, {}, Documents);
      return { documents: rows.map(documentView) };
    }
    if (!id && method === 'POST') return upload(request, db, code, who);
    if (id && !action && method === 'DELETE') {
      await removeDocument(db, await ownDocument(db, code, who, id, false));
      return { ok: true };
    }
    if (id && action === 'download' && method === 'GET') return download(await ownDocument(db, code, who, id));
    if (id && action === 'drafts' && method === 'POST') {
      const document = await ownDocument(db, code, who, id);
      const { type, topic, count, recent } = await readBody(request);
      if (!['open', 'choice'].includes(type) || !TOPICS.has(topic) || ![1, 5, 10].includes(count)) fail(400, '出題設定無效。');
      const excluded = Array.isArray(recent) ? recent.slice(0, 60).filter(value => typeof value === 'string' && value.length <= 300) : [];
      return { questions: documentDrafts(document, { type, topic, count }, excluded) };
    }
  }
  if (area === 'library') {
    if (!id && method === 'GET') return { questions: (await getRoomQuestions(db, code)).map(row => questionCard(row, who)) };
    if (!id && method === 'POST') return saveQuestion(request, db, code, who, validateQuestion);
    if (id && !action && method === 'DELETE') {
      checkId(id);
      const rows = await db('DELETE', `?${ownerFilter(code, who)}&id=eq.${id}&select=id`, undefined, { Prefer: 'return=representation' }, Questions);
      if (!rows?.length) fail(404, '找不到可移除的題目。');
      return { ok: true };
    }
  }
  fail(405, '不支援此操作。');
}

export async function cleanExpiredDocuments(db) {
  const rows = await db('POST', '', {}, {}, 'rpc/quiz_documents_for_cleanup');
  const outcomes = await Promise.allSettled(rows.map(async ({ id, room_code }) => {
    await storageRequest('delete', objectKey(room_code, id));
    await db('DELETE', `?room_code=eq.${room_code}&id=eq.${id}`, undefined, {}, Documents);
  }));
  return outcomes.filter(outcome => outcome.status === 'fulfilled').length;
}
