import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { exportWorkbook, readWorkbook } from '../server/v5-excel.mjs';
import { handleApi } from '../server/api.mjs';
import { duringDeployment } from '../server/deployment.mjs';

test('published templates have the expected headers and open as empty import sheets',async()=>{
  for(const kind of ['quiz','performance']) {
    const bytes=await readFile(new URL(`../public/templates/v5-${kind}.xlsx`,import.meta.url));
    assert.deepEqual(await readWorkbook(bytes,kind),[]);
  }
});

test('Excel parser recognizes normalized headings, preserves row positions, and refuses formulas',async()=>{
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet('表演挑戰');
  sheet.addRow(['訓練能力','挑戰題目','建議時間(秒)','技巧提示']);
  sheet.addRow(['講故事','描述一趟旅程',90,'加上對話']);
  sheet.addRow([]);
  sheet.addRow(['演講能力',{formula:'1+2',result:3}]);
  const bytes=Buffer.from(await workbook.xlsx.writeBuffer());
  const rows=await readWorkbook(bytes,'performance');
  assert.deepEqual(rows[0],{row:2,content:{ability:'講故事',prompt:'描述一趟旅程',seconds:90,tips:'加上對話'}});
  assert.equal(rows[1].row,4);
  assert.match(rows[1].error,/純文字/);
  await assert.rejects(readWorkbook(bytes,'quiz'),/缺少必填欄位/);
  await assert.rejects(readWorkbook(Buffer.from('hello'),'quiz'),/無法讀取/);
});

test('backup preserves imported content as text, with states in a separate sheet',async()=>{
  const input=[{id:'sample',status:'disabled',content:{prompt:'=1+1',answer:'二',explanation:'加法',series:'第一組',sequence:1}}];
  const bytes=await exportWorkbook('quiz',input);
  const parsed=await readWorkbook(Buffer.from(bytes),'quiz');
  assert.deepEqual(parsed[0].content,input[0].content);
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.equal(workbook.worksheets[1].getCell('B2').value,'停用');
});

test('HTTP import checks administrator access before parsing and binds publish to the preview workbook',async()=>{
  const before=globalThis.fetch;
  const previous={...process.env};
  const key='sb_publishable_test';
  const token='long.test.jwt.valid.format';
  const calls=[];
  try {
    Object.assign(process.env,{SUPABASE_URL:'https://db.example',SUPABASE_SECRET_KEY:'private-test-only',SUPABASE_PUBLISHABLE_KEY:key});
    globalThis.fetch=async(url,options)=>{
      calls.push([url,JSON.parse(options.body)]);
      assert.equal(options.headers.apikey,key);
      if(options.headers.authorization.endsWith('.outsider'))return Response.json({code:'PT403',message:'denied'},{status:403});
      if(url.endsWith('/v5_import')) return Response.json({added:1,duplicates:0,errors:0,rows:[]});
      return Response.json('admin');
    };
    const request=(path,{key:auth=token,body,digest}={})=>duringDeployment({deploy:{context:'production'}},()=>handleApi(new Request(`https://client.example/api/v5/${path}`,{
      method:body?'POST':'GET',headers:{authorization:`Bearer ${auth}`,'x-v5-filename':'test.xlsx',...(digest?{'x-v5-preview':digest}:{})},body
    })));
    assert.equal((await request('quiz/preview',{key:token+'.outsider',body:Buffer.from('bad spreadsheet')})).status,403);
    assert.equal(calls.length,1);
    const original=Buffer.from(await exportWorkbook('quiz',[{content:{prompt:'題目甲',answer:'答案甲'}}]));
    const changed=Buffer.from(await exportWorkbook('quiz',[{content:{prompt:'題目乙',answer:'答案乙'}}]));
    const preview=await request('quiz/preview',{body:original});
    const {digest}=await preview.json();
    assert.equal(preview.status,200);
    assert.equal((await request('quiz/publish',{body:changed,digest})).status,409);
    assert.equal((await request('quiz/publish',{body:original,digest})).status,200);
    assert.deepEqual(calls.filter(([url])=>url.endsWith('/v5_import')).map(([,args])=>args.p_publish),[false,true]);
  } finally {globalThis.fetch=before;process.env=previous;}
});
