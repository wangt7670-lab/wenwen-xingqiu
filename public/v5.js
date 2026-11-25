import { createClient } from './vendor/supabase.js';
import { escape } from './studio.js';
import { abilities, names } from './v5-fields.js';
import { openAdmin } from './v5-admin.js';

const $=selector=>document.querySelector(selector);
const messageTypes={comment:'留言',followup:'追問',feedback:'評價',suggestion:'改進建議'};
const e=escape;
const date=value=>new Date(value).toLocaleString('zh-HK');
const limit=3*1024*1024;
let account,client,channel,board,refreshId=0,screen='home',offset=0,filter='',adminOpen=false,recording;
let needsRender=false;
const expanded=new Set();
const objectUrls=new Set();

function notice(message) {
  const status=$('#v5-status');
  status.textContent=message;
  status.hidden=!message;
}

async function call(path,{json,body,headers={},blob=false}={}) {
  const response=await fetch(`/api/v5${path}`,{
    method:json!==undefined||body?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(24000),
    headers:{...headers,...(account?{authorization:`Bearer ${account.access_token}`}:{}) ,...(json!==undefined?{'content-type':'application/json'}:{})},
    ...(json!==undefined||body?{body:json!==undefined?JSON.stringify(json):body}:{})
  });
  if(!response.ok)throw Error((await response.json().catch(()=>null))?.error||'暫時無法完成操作，請稍後再試。');
  return blob?await response.blob():await response.json();
}

const person=id=>e(board.members?.[id]||'房間成員');
const pending=thread=>thread.recipient===board.me&&!thread.submissions.length;
const audioUrl=blob=>{const url=URL.createObjectURL(blob);objectUrls.add(url);return url;};

function clearAudio() {
  if(recording) {
    const current=recording;
    recording=null;
    if(current.recorder?.state==='recording')current.recorder.stop();
    current.stream?.getTracks().forEach(track=>track.stop());
    clearTimeout(current.timeout);
  }
  for(const url of objectUrls)URL.revokeObjectURL(url);
  objectUrls.clear();
}

function showHome() {
  $('#v5-greeting').textContent=board.ready?`${board.members[board.me]}，今天想一起玩什麼？`:'請先設定第二個固定帳戶。';
  const received=board.threads.filter(pending);
  const activity=board.threads.map(thread=>({thread,last:[...thread.messages,...thread.submissions]
    .reduce((latest,item)=>item.created_at>latest?item.created_at:latest,thread.created_at)})).sort((a,b)=>b.last.localeCompare(a.last)).slice(0,6);
  const entries=items=>items.length?`<ul>${items.map(({thread,last})=>`<li><button class="link-button" data-screen="${thread.kind}" data-open-thread="${e(thread.id)}">${e(thread.snapshot.prompt)}</button>${last?`<small> ${e(date(last))}</small>`:''}</li>`).join('')}</ul>`:'<p>目前沒有項目。</p>';
  $('#v5-overview').innerHTML=[['待回答問題',received.filter(t=>t.kind==='quiz').map(thread=>({thread}))],
    ['待完成挑戰',received.filter(t=>t.kind==='performance').map(thread=>({thread}))],['最新互動',activity]].map(([title,rows])=>
    `<section class="side-card"><h2>${title}</h2>${entries(rows)}</section>`).join('');
}

function compose() {
  const catalog=board.catalog.filter(item=>item.kind===screen&&(!filter||item.content.ability===filter));
  const type=names[screen];
  $('#v5-compose').innerHTML=`<h2>${screen==='quiz'?'出題給對方':'發送挑戰'}</h2>
    ${screen==='performance'?`<label class="field">訓練能力<select id="v5-ability"><option value="">全部</option>${abilities.map(ability=>`<option ${ability===filter?'selected':''}>${ability}</option>`).join('')}</select></label>`:''}
    <form data-send><label class="field">${screen==='quiz'?'從題庫選題':'從挑戰庫選題'}<select name="catalog_id" ${catalog.length?'':'disabled'} required>
    ${catalog.map(({id,content})=>`<option value="${e(id)}">${e(content.prompt)}${content.series?` · ${e(content.series)} #${content.sequence}`:''}</option>`).join('')}</select></label>
    ${catalog.length?'':`<p>目前沒有可發送的${screen==='quiz'?'題目':'挑戰'}。${board.role==='admin'?`可使用下方「管理題庫」提供 ${type} 的 Excel。`:''}</p>`}
    <div class="v5-tools"><button class="button primary" ${board.ready&&catalog.length?'':'disabled'}>發送所選</button><button class="button subtle" type="button" data-random ${board.ready&&catalog.length?'':'disabled'}>隨機發送一題</button></div></form>`;
}

function messageForm(thread,submission=null) {
  const feedback=submission&&thread.kind==='performance'&&submission.author!==board.me;
  return `<form data-message data-thread="${e(thread.id)}" data-submission="${e(submission?.id??'')}">
    <label class="field">${feedback?'回饋此版本':'互動'}<select name="mode">${Object.entries(messageTypes).filter(([key])=>feedback||['comment','followup'].includes(key)).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>
    <label class="field">內容<textarea name="text" rows="2" maxlength="3000" required></textarea></label><button class="button subtle">送出</button></form>`;
}

function submitForm(thread,mode) {
  const performance=thread.kind==='performance';
  const heading=mode==='relay'?'接續上文':performance?(thread.submissions.some(s=>s.mode==='version')?'重新表演':'提交表演'):'回答這道題';
  return `<form class="v5-version" data-submission-form data-thread="${e(thread.id)}" data-mode="${mode}">
    <label class="field">${heading}<textarea name="text" rows="3" maxlength="6000" ${performance?'':'required'}></textarea></label>
    ${performance?`<div class="v5-methods"><button type="button" class="button subtle" data-record>開始錄音</button><button type="button" class="button subtle" data-stop-record disabled>停止</button><span data-record-status></span></div>
      <label class="field">上傳已有錄音<input type="file" name="audio" accept=".webm,.mp4,.m4a,.ogg,audio/webm,audio/mp4,audio/ogg"></label><audio controls hidden data-record-preview></audio>`:''}
    <button class="button primary">${performance?'送出表演':'送出答案'}</button></form>`;
}

function renderThread(thread) {
  const {snapshot,kind,submissions,messages}=thread;
  const history=target=>messages.filter(message=>message.submission_id===target).map(message=>`<p class="v5-text"><strong>${person(message.author)} · ${messageTypes[message.mode]}</strong><br>${e(message.body)}</p>`).join('');
  const relay=submissions.filter(item=>item.mode==='relay');
  const canContinue=snapshot.ability==='講故事'&&(relay.length?relay.at(-1).author!==board.me:thread.recipient===board.me);
  const versions=submissions.filter(item=>item.mode==='version');
  return `<details class="v5-thread" id="v5-thread-${e(thread.id)}" data-thread-card="${e(thread.id)}" ${expanded.has(thread.id)?'open':''}>
    <summary>${e(snapshot.prompt)}${pending(thread)?' · 待完成':''}</summary><p class="v5-muted">${person(thread.sender)} → ${person(thread.recipient)} · ${e(date(thread.created_at))}</p>
    ${snapshot.series?`<p>${e(snapshot.series)} · 第 ${snapshot.sequence} 題</p>`:''}
    ${snapshot.ability?`<p>${e(snapshot.ability)}${snapshot.seconds?` · 建議 ${snapshot.seconds} 秒`:''}</p>`:''}
    ${snapshot.seconds?`<div class="v5-methods"><button type="button" class="button subtle" data-timer="${snapshot.seconds}">開始計時</button><output></output></div>`:''}
    ${snapshot.tips?`<p class="v5-text"><strong>技巧提示</strong><br>${e(snapshot.tips)}</p>`:''}
    ${submissions.map(item=>`<article class="v5-version"><h3>${item.mode==='relay'?'故事接龍第 '+(relay.indexOf(item)+1)+' 段': item.mode==='version'?'表演版本 '+(versions.indexOf(item)+1):'作答'} · ${person(item.author)}</h3>
      ${item.body?`<p class="v5-text">${e(item.body)}</p>`:''}${item.has_audio?`<button type="button" class="button subtle" data-audio="${e(item.id)}">載入錄音</button><audio controls hidden></audio>`:''}
      ${kind==='quiz'&&board.me!==item.author?`<button type="button" class="button subtle" data-favorite="${e(item.id)}" aria-pressed="${Boolean(item.favorite)}">${item.favorite?'已收藏':'收藏神回答'}</button>`:''}
      ${history(item.id)}${kind==='performance'&&board.me!==item.author?messageForm(thread,item):''}</article>`).join('')}
    ${snapshot.answer?`<p class="v5-text"><strong>參考答案</strong><br>${e(snapshot.answer)}</p>`:''}
    ${snapshot.explanation?`<p class="v5-text">${e(snapshot.explanation)}</p>`:''}
    ${pending(thread)&&kind==='quiz'?submitForm(thread,'answer'):''}
    ${kind==='performance'&&thread.recipient===board.me?submitForm(thread,'version'):''}${canContinue?submitForm(thread,'relay'):''}
    ${history(null)}${messageForm(thread)}</details>`;
}

function render() {
  const home=screen==='home';
  for(const selector of ['#v5-home','#v5-overview'])$(selector).classList.toggle('hidden',!home);
  $('#v5-module').classList.toggle('hidden',home);
  if(home){showHome();return;}
  $('#v5-module-title').textContent=names[screen];
  $('#v5-admin-toggle').classList.toggle('hidden',board.role!=='admin');
  compose();
  const items=board.threads.filter(thread=>thread.kind===screen);
  $('#v5-thread-list').innerHTML=items.length?items.map(renderThread).join(''):'<p>本頁暫無互動紀錄。</p>';
  $('#v5-pagination').innerHTML=`${offset?'<button class="button subtle" data-page="prev">上一頁</button>':''}${offset+30<board.total?'<button class="button subtle" data-page="next">下一頁互動</button>':''}`;
}

async function refresh(background=false) {
  if(!account)return;
  const requestId=++refreshId;
  const user=account.user.id;
  const data=await call(`/board?offset=${offset}`);
  if(account?.user.id!==user||requestId!==refreshId)return;
  if(background&&!needsRender&&board&&JSON.stringify(data)===JSON.stringify(board))return;
  board=data;
  const focus=document.activeElement;
  if(background&&(recording||focus.closest('#v5-thread-list form, #v5-compose, #v5-admin')||$('#v5-thread-list audio[src]'))) {needsRender=true;return;}
  needsRender=false;
  render();
}

function closeAdmin() {
  adminOpen=false;
  $('#v5-admin').classList.add('hidden');
  $('#v5-admin').replaceChildren();
  $('#v5-admin-toggle').setAttribute('aria-expanded','false');
}

function openScreen(next,thread) {
  if(!board||!['home','quiz','performance'].includes(next))return;
  clearAudio();
  closeAdmin();
  offset=0;
  screen=next;
  filter='';
  if(thread)expanded.add(thread);
  render();
  window.scrollTo({top:0,behavior:'instant'});
  if(thread)document.getElementById(`v5-thread-${thread}`)?.scrollIntoView({block:'start'});
  refresh().catch(error=>notice(error.message));
}

async function send(action,args) {
  const thread=await call('/interact',{json:{action,args}});
  expanded.add(thread);
  notice('已同步。');
  await refresh();
}

async function startRecording(form) {
  if(recording)throw Error('請先完成目前的錄音。');
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('目前無法直接錄音，可上傳已有錄音。');
  const active={form,stream:null,recorder:null,timeout:null};
  recording=active;
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}
  catch{if(recording===active)recording=null;throw Error('無法取得麥克風，可上傳已有錄音。');}
  if(recording!==active||!form.isConnected){stream.getTracks().forEach(track=>track.stop());return;}
  active.stream=stream;
  const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
  if(!mime){clearAudio();throw Error('瀏覽器的錄音格式不相容，可上傳已有錄音。');}
  const recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000});
  active.recorder=recorder;
  const pieces=[];
  let size=0;
  recorder.ondataavailable=event=>{
    size+=event.data.size;
    if(size<=limit)pieces.push(event.data);
    else if(recorder.state==='recording')recorder.stop();
  };
  recorder.onstop=()=>{
    stream.getTracks().forEach(track=>track.stop());
    clearTimeout(active.timeout);
    if(recording!==active)return;
    recording=null;
    if(!form.isConnected)return;
    form.querySelector('[data-record]').disabled=false;
    form.querySelector('[data-stop-record]').disabled=true;
    form.recordedAudio=size<=limit&&size>0?new Blob(pieces,{type:mime}):null;
    const preview=form.querySelector('[data-record-preview]');
    if(preview.src){URL.revokeObjectURL(preview.src);objectUrls.delete(preview.src);preview.removeAttribute('src');}
    preview.hidden=!form.recordedAudio;
    if(form.recordedAudio)preview.src=audioUrl(form.recordedAudio);
    form.querySelector('[data-record-status]').textContent=form.recordedAudio?'錄音已就緒，可試聽或送出。':'錄音不完整或超過 3 MiB，請重新錄製。';
  };
  recorder.onerror=()=>{clearAudio();notice('錄音失敗，可上傳已有錄音。');};
  recorder.start(400);
  active.timeout=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},180000);
  form.querySelector('[data-record]').disabled=true;
  form.querySelector('[data-stop-record]').disabled=false;
  form.querySelector('[data-record-status]').textContent='錄音中，最長 3 分鐘。';
}

function interactForm(form) {
  const values=Object.fromEntries(new FormData(form));
  if(form.matches('[data-send]'))return send('send',{kind:screen,ability:filter,catalog_id:values.catalog_id});
  if(form.matches('[data-message]'))return send('message',{thread_id:form.dataset.thread,submission_id:form.dataset.submission||null,...values});
  const {thread,mode}=form.dataset;
  if(recording?.form===form)throw Error('請先停止錄音。');
  const clip=values.audio?.size?values.audio:form.recordedAudio;
  if(!clip)return send('submit',{thread_id:thread,mode,text:values.text});
  if(clip.size>limit)throw Error('錄音上限為 3 MiB。');
  return call(`/audio/${thread}`,{body:clip,headers:{'x-v5-mode':mode}}).then(async()=>{
    expanded.add(thread);notice('錄音已同步。');await refresh();
  });
}

async function run(element,task) {
  if(element.dataset.working)return;
  element.dataset.working='1';
  const button=element.matches('button')?element:element.querySelector('button:not([type="button"])');
  if(button)button.disabled=true;
  try{await task();}catch(error){notice(error.message);}
  finally{delete element.dataset.working;if(button&&!button.matches('[data-record],[data-stop-record],[data-audio]'))button.disabled=false;}
}

$('#v5-app').addEventListener('submit',event=>{const form=event.target;if(form.closest('#v5-admin'))return;event.preventDefault();run(form,()=>interactForm(form));});
$('#v5-app').addEventListener('toggle',event=>{if(event.target.dataset.threadCard){if(event.target.open)expanded.add(event.target.dataset.threadCard);else expanded.delete(event.target.dataset.threadCard);}},true);
$('#v5-app').addEventListener('change',event=>{if(event.target.id==='v5-ability'){filter=event.target.value;compose();}});
$('#v5-app').addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button||button.closest('#v5-admin'))return;
  if(button.dataset.screen){openScreen(button.dataset.screen,button.dataset.openThread);return;}
  if(button.id==='v5-admin-toggle') {
    if(adminOpen){closeAdmin();return;}
    adminOpen=true;
    button.setAttribute('aria-expanded','true');
    $('#v5-admin').classList.remove('hidden');
    openAdmin($('#v5-admin'),screen,call,refresh).catch(error=>notice(error.message));
  } else if(button.matches('[data-random]'))run(button,()=>send('send',{kind:screen,ability:filter}));
  else if(button.dataset.page){offset=Math.max(0,offset+(button.dataset.page==='next'?30:-30));run(button,()=>refresh());}
  else if(button.dataset.audio)run(button,async()=>{
    const target=button.nextElementSibling;
    try{target.src=audioUrl(await call(`/audio/${button.dataset.audio}`,{blob:true}));target.hidden=false;button.hidden=true;}
    catch(error){button.disabled=false;throw error;}
  });
  else if(button.dataset.favorite)run(button,()=>send('favorite',{thread_id:button.closest('[data-thread-card]').dataset.threadCard,
    submission_id:button.dataset.favorite,saved:button.getAttribute('aria-pressed')!=='true'}));
  else if(button.matches('[data-record]')){const form=button.closest('form');startRecording(form).catch(error=>notice(error.message));}
  else if(button.matches('[data-stop-record]')&&recording?.form===button.closest('form')){if(recording.recorder.state==='recording')recording.recorder.stop();}
  else if(button.dataset.timer) {
    const output=button.nextElementSibling;
    const end=Date.now()+Number(button.dataset.timer)*1000;
    button.disabled=true;
    const timer=setInterval(()=>{
      const seconds=Math.max(0,Math.ceil((end-Date.now())/1000));
      output.textContent=seconds?`${seconds} 秒`:'時間到';
      if(!seconds||!output.isConnected){button.disabled=false;clearInterval(timer);}
    },250);
  }
});

async function sessionChanged(next) {
  if(account?.user.id===next?.user.id&&board){account=next;return;}
  account=next;
  board=null;
  if(channel){await client.removeChannel(channel);channel=null;}
  clearAudio();closeAdmin();expanded.clear();offset=0;screen='home';filter='';
  $('#v5-app').classList.add('hidden');
  $('#v5-login').classList.remove('hidden');
  $('#sign-out').classList.toggle('hidden',!next);
  if(!next)return;
  try {
    await refresh();
    if(!board||account?.user.id!==next.user.id)return;
    $('#v5-login').classList.add('hidden');
    $('#v5-app').classList.remove('hidden');
    channel=client.channel('wenwen-v5').on('postgres_changes',{event:'UPDATE',schema:'public',table:'v5_clock'},()=>{
      refresh(true).catch(()=>{});
    }).subscribe();
  }catch(error){notice(error.message);}
}

async function boot() {
  const config=await call('/config');
  client=createClient(config.url,config.publishable,{auth:{detectSessionInUrl:false}});
  $('#sign-in button').disabled=false;
  client.auth.onAuthStateChange((_event,next)=>{setTimeout(()=>sessionChanged(next).catch(error=>notice(error.message)),0);});
  $('#sign-in').onsubmit=event=>{
    event.preventDefault();
    const form=event.target;
    run(form,async()=>{
      const {email,password}=Object.fromEntries(new FormData(form));
      const {error}=await client.auth.signInWithPassword({email,password});
      if(error)throw Error('登入失敗，請核對電郵及密碼。');
      form.reset();notice('');
    });
  };
  $('#sign-out').onclick=()=>run($('#sign-out'),async()=>{
    const {error}=await client.auth.signOut();if(error)throw error;notice('已登出。');
  });
  setInterval(()=>refresh(true).catch(()=>{}),12000);
}

boot().catch(error=>notice(error.message));
