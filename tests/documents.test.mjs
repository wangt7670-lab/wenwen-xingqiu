import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { extractSections } from '../server/documents.mjs';
import { rewriteOnDevice } from '../public/local-ai.js';

function pdfWithText(text) {
  const stream = `BT /F1 12 Tf 30 90 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 140] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.5\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index+1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function storedZip(files) {
  const entries = [], directory = [];
  let offset = 0;
  for (const [file, content] of Object.entries(files)) {
    const filename = Buffer.from(file);
    const bytes = Buffer.from(content);
    const checksum = crc32(bytes);
    const entry = Buffer.alloc(30);
    entry.writeUInt32LE(0x04034b50);
    entry.writeUInt16LE(20,4);
    entry.writeUInt32LE(checksum,14);
    entry.writeUInt32LE(bytes.length,18);
    entry.writeUInt32LE(bytes.length,22);
    entry.writeUInt16LE(filename.length,26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(20,4);
    header.writeUInt16LE(20,6);
    header.writeUInt32LE(checksum,16);
    header.writeUInt32LE(bytes.length,20);
    header.writeUInt32LE(bytes.length,24);
    header.writeUInt16LE(filename.length,28);
    header.writeUInt32LE(offset,42);
    entries.push(entry,filename,bytes);
    directory.push(header,filename);
    offset += entry.length + filename.length + bytes.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length/2,8);
  end.writeUInt16LE(directory.length/2,10);
  end.writeUInt32LE(directory.reduce((n, buffer) => n+buffer.length,0),12);
  end.writeUInt32LE(offset,16);
  return Buffer.concat([...entries,...directory,end]);
}

const documentParts = text => ({
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
});

test('TXT and Markdown extract text; a text PDF captures its page number', async () => {
  const txt = await extractSections(Buffer.from('土星：擁有明顯的行星環。'), 'txt');
  assert.equal(txt[0].text,'土星：擁有明顯的行星環。');
  const md = await extractSections(Buffer.from('# 行星知識\n月球是天然衛星。'),'md');
  assert.equal(md[0].text,'行星知識');
  assert.deepEqual(await extractSections(pdfWithText('Jupiter has many moons.'),'pdf'),[
    {location:'第 1 頁 · 第 1 段',text:'Jupiter has many moons.'}
  ]);
});

test('DOCX extracts Chinese paragraphs and rejects DTD or non-document archives', async () => {
  const input = storedZip(documentParts('土星：擁有明顯的行星環。'));
  assert.equal((await extractSections(input,'docx'))[0].text,'土星：擁有明顯的行星環。');
  const unsafe = documentParts('&external;');
  unsafe['word/document.xml'] = '<!DOCTYPE x [<!ENTITY external SYSTEM "https://example.test/">]>' + unsafe['word/document.xml'];
  await assert.rejects(extractSections(storedZip(unsafe),'docx'),{status:415});
  await assert.rejects(extractSections(storedZip({'only.txt':'not DOCX'}),'docx'),{status:415});
  await assert.rejects(extractSections(Buffer.from([255,254,0]),'txt'),{status:415});
});

test('optional on-device adapter receives only the chosen excerpt and preserves source and answer', async () => {
  const draft = {
    question:'依資料填空：恆星有＿＿＿。', referenceAnswer:'核心',
    source:{title:'should not be sent',excerpt:'恆星有核心。'}
  };
  const unavailable = {requestAdapter:async()=>null};
  await assert.rejects(rewriteOnDevice(draft,{gpu:unavailable}), /WebGPU/);
  let unloaded = false;
  const result = await rewriteOnDevice(draft,{
    gpu:{requestAdapter:async()=>({features:new Set(['shader-f16'])})},
    loadRuntime:async()=>({
      MLCEngine:class {
        async reload(model){assert.match(model,/q4f16_1/)}
        chat={completions:{create:async ({messages})=>{
            assert.equal(JSON.parse(messages[1].content).出處片段,draft.source.excerpt);
            assert.doesNotMatch(messages[1].content,/should not be sent/);
            return {choices:[{message:{content:'{"question":"恆星有哪些結構？請補上＿＿＿。"}'}}]};
          }}};
        async unload(){unloaded=true}
      }
    })
  });
  assert.equal(result.referenceAnswer,'核心');
  assert.equal(result.source,draft.source);
  assert.equal(result.reviewState,'draft');
  assert.ok(unloaded);
});
