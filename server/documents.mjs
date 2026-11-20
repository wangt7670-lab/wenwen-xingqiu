import { fileURLToPath } from 'node:url';
import { fromBuffer } from 'yauzl';
import { SaxesParser } from 'saxes';
import { ApiError, fail } from './http.mjs';
import { backendConfig } from './deployment.mjs';

export const BUCKET = 'wenwen-documents-v4';
export const MAX_FILE = 3 * 1024 * 1024;
const MAX_XML = 2 * 1024 * 1024;
const MAX_PAGES = 40;
const MAX_SECTIONS = 120;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const MEDIA = {
  txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

export function fileSpec(header) {
  let title;
  try { title = decodeURIComponent(header ?? '').normalize('NFC').trim(); }
  catch { fail(400, '檔名無效。'); }
  if (!title || title.length > 120 || /[\x00-\x1f\x7f/\\]/u.test(title)) fail(400, '請提供有效的檔名。');
  const kind = title.split('.').at(-1).toLowerCase();
  if (!title.includes('.') || !Object.hasOwn(MEDIA, kind)) fail(415, '請上傳 TXT、Markdown、PDF 或 DOCX。');
  return { title, kind, media: MEDIA[kind] };
}

function sectionList(blocks) {
  const sections = [];
  for (const { text, page } of blocks) {
    for (const line of text.split(/\r?\n/u)) {
      const clean = line.trim().replace(/^#{1,6}\s+|^(?:[-*]|\d+\.)\s+/u, '');
      for (const part of clean.split(/(?<=[。！？])\s*/u)) {
        if (part.length < 4) continue;
        const position = sections.length + 1;
        const location = page ? `第 ${page} 頁 · 第 ${position} 段` : `第 ${position} 段`;
        sections.push({ location, text: part.slice(0, 500) });
        if (sections.length === MAX_SECTIONS) return sections;
      }
    }
  }
  return sections;
}

async function pdfBlocks(bytes) {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail(415, '檔案內容與 PDF 格式不符。');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageUrl = import.meta.resolve('pdfjs-dist/package.json');
  const directory = name => fileURLToPath(new URL(name + '/', packageUrl)).replaceAll('\\', '/');
  const task = getDocument({
    data: new Uint8Array(bytes), cMapUrl: directory('./cmaps'),
    cMapPacked: true, standardFontDataUrl: directory('./standard_fonts'),
    isEvalSupported: false, useWasm: false, disableFontFace: true, stopAtErrors: true, verbosity: 0
  });
  try {
    const file = await task.promise;
    if (file.numPages > MAX_PAGES) fail(413, 'PDF 最多 40 頁，請分拆後上傳。');
    const blocks = [];
    let characters = 0;
    for (let page = 1; page <= file.numPages; page++) {
      const pdfPage = await file.getPage(page);
      const content = await pdfPage.getTextContent();
      const text = content.items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : ' ')).join('');
      characters += text.length;
      if (characters > 150000) fail(413, 'PDF 擷取的文字過多，請分拆後上傳。');
      blocks.push({ page, text });
      pdfPage.cleanup();
    }
    return blocks;
  } finally {
    await task.destroy();
  }
}

function readDocxParts(bytes) {
  return new Promise((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(error);
      const parts = new Map();
      const wanted = new Set(['[Content_Types].xml', 'word/document.xml']);
      const errorOut = err => { zip.close(); reject(err); };
      zip.on('error', errorOut);
      zip.on('end', () => resolve(parts));
      if (zip.entryCount > 500) return errorOut(new Error('Too many ZIP entries'));
      zip.on('entry', entry => {
        if (!wanted.has(entry.fileName)) return zip.readEntry();
        if (parts.has(entry.fileName) || entry.uncompressedSize > MAX_XML) {
          return errorOut(new Error('Invalid ZIP entry'));
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return errorOut(streamError);
          const chunks = [];
          let size = 0;
          stream.on('error', errorOut);
          stream.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_XML) stream.destroy(new Error('XML too large'));
            else chunks.push(chunk);
          });
          stream.on('end', () => {
            parts.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

function parseXml(buffer, callback) {
  const xml = UTF8.decode(buffer);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail(415, 'DOCX 包含未支援的 XML。');
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', error => { throw error; });
  callback(parser);
  parser.write(xml).close();
}

async function docxBlocks(bytes) {
  const parts = await readDocxParts(bytes);
  let standardDocument = false;
  parseXml(parts.get('[Content_Types].xml'), parser => {
    parser.on('opentag', tag => {
      const attributes = tag.attributes;
      if (attributes.PartName?.value === '/word/document.xml' &&
          attributes.ContentType?.value === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') standardDocument = true;
    });
  });
  if (!standardDocument || !parts.has('word/document.xml')) fail(415, '請上傳標準 DOCX 文件。');
  const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const blocks = [];
  let content = '', inText = false;
  parseXml(parts.get('word/document.xml'), parser => {
    parser.on('opentag', tag => {
      if (tag.uri === wordNamespace && tag.local === 't') inText = true;
    });
    parser.on('text', value => { if (inText) content += value; });
    parser.on('closetag', tag => {
      if (tag.uri !== wordNamespace) return;
      if (tag.local === 't') inText = false;
      if (tag.local === 'p') {
        blocks.push({ text: content });
        content = '';
      }
    });
  });
  return blocks;
}

export async function extractSections(bytes, kind) {
  if (!bytes.length) fail(400, '檔案沒有內容。');
  if (bytes.length > MAX_FILE) fail(413, '檔案最多 3 MiB。');
  let blocks;
  try {
    if (kind === 'pdf') blocks = await pdfBlocks(bytes);
    else if (kind === 'docx') blocks = await docxBlocks(bytes);
    else {
      const text = UTF8.decode(bytes);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text)) fail(415, '純文字檔請使用 UTF-8。');
      blocks = [{ text }];
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(415, '無法讀取此文件。請確認格式、編碼及檔案是否受密碼保護。');
  }
  const sections = sectionList(blocks);
  if (!sections.length) fail(422, '找不到可出題的文字。掃描圖檔請先轉成可選取的文字。');
  return sections;
}

export function objectKey(code, id) {
  return `${code}/${id}`;
}

export async function storageRequest(action, key, bytes, media) {
  const { url, key: secret } = backendConfig();
  const base = url.replace(/\/$/, '');
  const extension = action === 'delete' ? BUCKET : `${BUCKET}/${key}`;
  const path = action === 'get' ? `object/authenticated/${extension}` : `object/${extension}`;
  const method = { get: 'GET', save: 'POST', delete: 'DELETE' }[action];
  let response;
  try {
    response = await fetch(`${base}/storage/v1/${path}`, {
      method, redirect: 'error',
      headers: {
        apikey: secret,
        ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}),
        ...(action === 'save' ? { 'Content-Type': media, 'x-upsert': 'false' } : {}),
        ...(action === 'delete' ? { 'Content-Type': 'application/json' } : {})
      },
      ...(action === 'save' ? { body: bytes } : {}),
      ...(action === 'delete' ? { body: JSON.stringify({ prefixes: [key] }) } : {}),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    fail(503, '私有檔案儲存暫時無法連線。');
  }
  if (!response.ok && !(action === 'delete' && response.status === 404)) {
    fail(503, '私有檔案儲存暫時無法使用。');
  }
  return response;
}
