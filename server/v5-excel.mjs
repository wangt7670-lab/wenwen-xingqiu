import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { posix } from 'node:path';
import { fail } from './http.mjs';
import { formats } from '../public/v5-fields.js';

export const workbookLimit = 2 * 1024 * 1024;

export function workbookFormat(kind) {
  if (!Object.hasOwn(formats,kind)) fail(400,'不支援此題庫。');
  return formats[kind];
}

function workbookParts(bytes) {
  return new Promise((resolve,reject) => {
    yauzl.fromBuffer(bytes,{lazyEntries:true},(error,zip) => {
      if(error){reject(error);return;}
      let inflated=0,actual=0;
      const names=new Set();
      const parts=new Map();
      zip.on('error',reject);
      zip.on('end',()=>{
        if(!names.has('xl/workbook.xml') || !names.has('[Content_Types].xml')) reject(Error('XLSX required'));
        else resolve(parts);
      });
      zip.on('entry',entry=>{
        inflated+=entry.uncompressedSize;
        if(names.has(entry.fileName)||names.size>=200||inflated>12*1024*1024||
          entry.generalPurposeBitFlag&1||/externalLinks|vbaProject|embeddings|\.bin$/i.test(entry.fileName)) {
          zip.close(); reject(Error('Unsupported Excel archive'));return;
        }
        names.add(entry.fileName);
        if(entry.fileName.endsWith('/')){zip.readEntry();return;}
        zip.openReadStream(entry,(streamError,stream)=>{
          if(streamError){zip.close();reject(streamError);return;}
          const chunks=[];
          const xml=/\.(?:xml|rels)$/i.test(entry.fileName);
          stream.on('error',error=>{zip.close();reject(error);});
          stream.on('data',chunk=>{
            actual+=chunk.length;
            if(actual>12*1024*1024)stream.destroy(Error('Workbook expands beyond limit'));
            else if(xml)chunks.push(chunk);
          });
          stream.on('end',()=>{
            if(xml)parts.set(entry.fileName,Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

function xml(bytes,events) {
  if(!bytes)throw Error('Missing workbook part');
  const parser=new SaxesParser({xmlns:true});
  parser.on('doctype',()=>{throw Error('Unexpected workbook doctype');});
  for(const [event,handler] of Object.entries(events))parser.on(event,handler);
  parser.write(bytes.toString('utf8')).close();
}

const attribute=(tag,name)=>tag.attributes[name]?.value;

function parseWorksheet(parts) {
  let firstId,target;
  xml(parts.get('xl/workbook.xml'),{opentag:tag=>{
    if(tag.local==='sheet'&&!firstId)firstId=Object.values(tag.attributes).find(value=>value.local==='id'&&value.uri.endsWith('/relationships'))?.value;
  }});
  if(!firstId)throw Error('Workbook has no worksheets');
  xml(parts.get('xl/_rels/workbook.xml.rels'),{opentag:tag=>{
    if(tag.local==='Relationship'&&attribute(tag,'Id')===firstId&&attribute(tag,'TargetMode')!=='External')target=attribute(tag,'Target');
  }});
  const path=target?.startsWith('/')?target.slice(1):posix.join('xl',target??'');
  if(!/^xl\/worksheets\/[\w.-]+\.xml$/.test(path))throw Error('Invalid worksheet path');
  const shared=[];
  let item='',reading=false;
  if(parts.has('xl/sharedStrings.xml'))xml(parts.get('xl/sharedStrings.xml'),{
    opentag:tag=>{if(tag.local==='si')item='';if(tag.local==='t')reading=true;},
    text:value=>{if(reading)item+=value;},
    closetag:tag=>{if(tag.local==='t')reading=false;if(tag.local==='si')shared.push(item);}
  });

  const rows=new Map();
  let cell,field;
  const invalid=Symbol('not a plain Excel cell');
  xml(parts.get(path),{
    opentag:tag=>{
      if(tag.local==='c')cell={reference:attribute(tag,'r'),type:attribute(tag,'t'),value:'',formula:false};
      if(cell&&['v','t'].includes(tag.local))field=tag.local;
      if(cell&&tag.local==='f')cell.formula=true;
    },
    text:value=>{if(cell&&field)cell.value+=value;},
    closetag:tag=>{
      if(tag.local===field)field=null;
      if(tag.local!=='c'||!cell)return;
      const {reference,type,value,formula}=cell;
      cell=null;
      if(!value&&!formula)return;
      const match=reference?.match(/^([A-Z]{1,3})([1-9]\d{0,6})$/);
      if(!match)throw Error('Invalid cell position');
      const [,column,position]=match;
      const row=Number(position);
      let plain=invalid;
      if(!formula) {
        if(type==='s')plain=shared[Number(value)]??invalid;
        else if(type==='inlineStr'||type==='str')plain=value;
        else if((!type||type==='n')&&Number.isFinite(Number(value)))plain=Number(value);
      }
      if(!rows.has(row))rows.set(row,new Map());
      rows.get(row).set(column,plain);
      if(rows.size>10001||rows.get(row).size>100)throw Error('Workbook has too many cells');
    }
  });
  return rows;
}

function canonicalHeader(value) {
  return typeof value==='string' ? value.trim().normalize('NFKC').replace(/\s+/gu,'') : '';
}

export async function readWorkbook(bytes,kind) {
  const {fields,required}=workbookFormat(kind);
  let worksheet;
  try {
    if(!bytes.length||bytes.length>workbookLimit) fail(400,'Excel 檔案上限為 2 MiB。');
    worksheet=parseWorksheet(await workbookParts(bytes));
  } catch {
    fail(400,'無法讀取這份 .xlsx。請使用模板或 Excel 匯出格式，並檢查檔案大小。');
  }
  const columns=new Map();
  for(const [index,cell] of worksheet.get(1)??[]) {
    const heading=canonicalHeader(cell);
    const key=Object.keys(fields).find(field=>canonicalHeader(fields[field])===heading);
    if(!key)continue;
    if(columns.has(key)) fail(400,`欄位重複。${fields[key]}`);
    columns.set(key,index);
  }
  const missing=required.filter(key=>!columns.has(key)).map(key=>fields[key]);
  if(missing.length) fail(400,`缺少必填欄位。${missing.join('、')}`);
  const rows=[];
  for(const [number,row] of [...worksheet.entries()].sort(([a],[b])=>a-b)) {
    if(number===1)continue;
    const cells=[...columns].map(([key,index])=>[key,row.get(index)??null]);
    if(cells.every(([,value])=>value==null||(typeof value==='string'&&!value.trim()))) continue;
    if(rows.length===500) fail(400,'每次可導入最多 500 筆。');
    const invalid=cells.find(([,value])=>value!=null&&typeof value!=='string'&&typeof value!=='number');
    if(invalid) rows.push({row:number,error:`「${fields[invalid[0]]}」請使用純文字或數字。`,
      content:Object.fromEntries(cells.filter(([,value])=>typeof value==='string'||typeof value==='number'))});
    else rows.push({row:number,content:Object.fromEntries(cells)});
  }
  return rows;
}

export async function exportWorkbook(kind,rows) {
  const {fields}=workbookFormat(kind);
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet(kind==='quiz'?'考考你':'表演挑戰');
  sheet.columns=Object.entries(fields).map(([key,header])=>({key,header,width:['sequence','seconds','ability'].includes(key)?18:35}));
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF5B49AF'}};
  sheet.views=[{state:'frozen',ySplit:1}];
  for(const row of rows) sheet.addRow(row.content);
  const state=workbook.addWorksheet('備份狀態');
  state.addRow(['題目','狀態','資料庫 ID']);
  for(const row of rows) state.addRow([row.content.prompt,row.status==='disabled'?'停用':'啟用',row.id]);
  return await workbook.xlsx.writeBuffer();
}
