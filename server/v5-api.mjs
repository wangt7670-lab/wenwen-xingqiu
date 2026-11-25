import { createHash, randomUUID } from 'node:crypto';
import { backendConfig } from './deployment.mjs';
import { ApiError, fail, readBody, readBytes, UUID } from './http.mjs';
import { exportWorkbook, readWorkbook, workbookFormat, workbookLimit } from './v5-excel.mjs';

const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
const json=value=>Response.json(value,{headers});
const audioLimit=3*1024*1024;
const bucket='v5-performance-audio';

function config() {
  const {url,key,publishable}=backendConfig();
  if(!url||!key||!publishable) fail(503,'此環境尚未設定 V5 登入服務。');
  return {url:new URL(url).origin,key,publishable};
}

async function checkedFetch(url,options) {
  try {return await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{fail(503,'暫時無法連線至 Supabase，請稍後重試。');}
}

function dbFor(request,current) {
  const bearer=request.headers.get('authorization')??'';
  if(!/^Bearer [\w.-]{20,4096}$/.test(bearer)) fail(401,'請先登入。');
  return async (name,args={})=>{
    const response=await checkedFetch(`${current.url}/rest/v1/rpc/${name}`,{method:'POST',
      headers:{apikey:current.publishable,authorization:bearer,'content-type':'application/json'},body:JSON.stringify(args)});
    if(response.ok) return response.status===204?null:await response.json();
    const data=await response.json().catch(()=>({}));
    if(/^PT(400|403|404|409)$/.test(data.code)) fail(Number(data.code.slice(2)),data.message);
    if(response.status===401) fail(401,'登入已過期，請重新登入。');
    if(response.status===403) fail(403,'此操作需要私人空間或管理員權限。');
    fail(503,'資料服務暫時無法使用。');
  };
}

function audioType(bytes) {
  if(bytes.slice(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return 'audio/webm';
  if(bytes.toString('ascii',4,8)==='ftyp')return 'audio/mp4';
  if(bytes.toString('ascii',0,4)==='OggS')return 'audio/ogg';
  fail(400,'請使用網頁錄音或上傳 WebM、MP4、Ogg 錄音。');
}

async function audio(request,current,db,id) {
  if(!UUID.test(id)) fail(400,'無效的錄音識別。');
  const objects=`${current.url}/storage/v1/object`;
  const auth={apikey:current.key,...(current.key.startsWith('eyJ')?{authorization:`Bearer ${current.key}`}:{})};
  if(request.method==='GET') {
    const path=await db('v5_audio_path',{p_submission:id});
    const response=await checkedFetch(`${objects}/authenticated/${bucket}/${path}`,{headers:auth});
    if(!response.ok)fail(response.status===404?404:503,'暫時無法取得錄音。');
    return new Response(response.body,{headers:{...headers,'content-type':response.headers.get('content-type')??'application/octet-stream'}});
  }
  const mode=request.headers.get('x-v5-mode');
  const owner=await db('v5_audio_owner',{p_thread:id,p_mode:mode});
  const bytes=await readBytes(request,audioLimit);
  const path=`${owner}/${randomUUID()}`;
  const response=await checkedFetch(`${objects}/${bucket}/${path}`,{method:'POST',headers:{...auth,'content-type':audioType(bytes)},body:bytes});
  if(!response.ok)fail(503,'錄音儲存失敗，請稍後重試。');
  try {return json(await db('v5_interact',{p_action:'submit',p_args:{thread_id:id,mode,audio:path}}));}
  catch(error) {
    if(error instanceof ApiError&&error.status<500)await checkedFetch(`${objects}/${bucket}`,{method:'DELETE',
      headers:{...auth,'content-type':'application/json'},body:JSON.stringify({prefixes:[path]})}).catch(()=>{});
    throw error;
  }
}

export async function handleV5(request,path) {
  const current=config();
  if(request.method==='GET'&&path==='/api/v5/config') return json({url:current.url,publishable:current.publishable});
  const db=dbFor(request,current);
  if(request.method==='GET'&&path==='/api/v5/board') {
    const offset=Number(new URL(request.url).searchParams.get('offset')??0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail(400,'無效的頁數。');
    return json(await db('v5_board',{p_offset:offset}));
  }
  if(request.method==='POST'&&path==='/api/v5/interact') {
    const {action,args}=await readBody(request);
    return json(await db('v5_interact',{p_action:action,p_args:args}));
  }
  if(request.method==='POST'&&path==='/api/v5/edit') {
    const {id,version,action,content}=await readBody(request);
    await db('v5_edit',{p_id:id,p_version:version,p_action:action,p_content:content??null});
    return json({ok:true});
  }
  const match=path.match(/^\/api\/v5\/(quiz|performance)\/(catalog|preview|publish|export)$/);
  if(match) {
    const [,kind,action]=match;
    workbookFormat(kind);
    if(request.method==='GET'&&['catalog','export'].includes(action)) {
      const rows=await db('v5_admin_catalog',{p_kind:kind});
      if(action==='catalog')return json(rows);
      return new Response(await exportWorkbook(kind,rows),{headers:{...headers,
        'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition':`attachment; filename="wenwen-${kind}-backup.xlsx"`}});
    }
    if(request.method==='POST'&&['preview','publish'].includes(action)) {
      await db('v5_role',{require_admin:true});
      if(!/\.xlsx$/i.test(request.headers.get('x-v5-filename')??''))fail(400,'請選擇 .xlsx 檔案。');
      const bytes=await readBytes(request,workbookLimit);
      const digest=createHash('sha256').update(kind).update(bytes).digest('hex');
      if(action==='publish'&&request.headers.get('x-v5-preview')!==digest)fail(409,'檔案已變更，請先重新預覽。');
      const rows=await readWorkbook(bytes,kind);
      const result=await db('v5_import',{p_kind:kind,p_rows:rows,p_publish:action==='publish'});
      return json({...result,digest});
    }
  }
  const recording=path.match(/^\/api\/v5\/audio\/([\w-]+)$/);
  if(recording&&['GET','POST'].includes(request.method))return audio(request,current,db,recording[1]);
  fail(404,'找不到 V5 路徑。');
}
