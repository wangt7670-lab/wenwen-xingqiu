import { bank } from './question-bank.js';
import { drawQuestion, isDuplicate } from './question-tools.js';
import { quickEditor, bankEditor, escape, readReview, reviewCard, sourceLink } from './studio.js';
import { challengePanel, documentsPanel, libraryPanel } from './library.js';
import { localAiAvailable, rewriteOnDevice } from './local-ai.js';
import { mountPlanetGame } from './planet-game-ui.js';
import { gameModes } from './planet-game.js';
import { mountWordGame } from './five-word-ui.js';

(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const SAVE_KEY='whyus-couple-demo-v1', SESSION_KEY='whyus-couple-session-v1';
const storeGet=k=>{try{return localStorage.getItem(k)}catch{return null}};
const storeSet=(k,v)=>{try{localStorage.setItem(k,v);return true}catch{return false}};
const storeRemove=k=>{try{localStorage.removeItem(k)}catch{}};
const CATS=[
 {id:'couple',emoji:'💌',name:'關於我們',sub:'默契、秘密與小心思',color:'#fbe7ec'},
 {id:'why',emoji:'💡',name:'十萬個為什麼',sub:'那些奇奇怪怪的好奇',color:'#fff0cd'},
 {id:'science',emoji:'🪐',name:'科學科普',sub:'宇宙、動物與冷知識',color:'#e3e7ff'},
 {id:'history',emoji:'🏛️',name:'歷史穿越',sub:'穿越時空來一題',color:'#dff1e9'},
 {id:'riddle',emoji:'🧩',name:'腦筋急轉彎',sub:'答錯也能笑出來',color:'#ffe7d6'},
 {id:'news',emoji:'🌏',name:'當下熱點',sub:'即時新聞與媒體識讀',color:'#e9e4f8'},
];
const localDefault=()=>({players:[{id:'a',name:'我',score:0},{id:'b',name:'TA',score:0}],current:null,history:[],round:1,updatedAt:Date.now()});
function safeJson(k,fallback){try{return JSON.parse(localStorage.getItem(k))||fallback}catch{return fallback}}
let demo=safeJson(SAVE_KEY,localDefault()),session=safeJson(SESSION_KEY,null),online=null,mode=session?'online':'demo',viewer=storeGet('whyus-viewer')||'a';
let tab='play',topic='couple',editorMode='bank',draft=null,aiBusy=false,connected=false,poll=null,modalKind=null;
let playMode=null;
let playState, editingId=null, localAiEnabled=false, localAiBusy=false;
const bankFilters={level:'',style:'',keywords:''};
const aiSettings={topic:'couple',type:'open',level:'',style:'',count:1,keywords:''};
let documents=[], selectedDoc=null, materialDrafts=[], roomQuestions=[];
let challenge=null, challengeVersion=-1, challengeKey='', challengeNew=false, challengeBusy=false;
const challengeSelection=new Set();
const documentSettings={topic:'science',type:'open',count:5};
function saveDemo(){storeSet(SAVE_KEY,JSON.stringify(demo))}
function saveSession(){if(session)storeSet(SESSION_KEY,JSON.stringify(session));else storeRemove(SESSION_KEY)}
function room(){return mode==='online'?(online||{players:[],current:null,history:[],round:1}):demo}
function me(){return mode==='online'?session?.playerId:viewer}
function player(id){return room().players?.find(x=>x.id===id)||{id,name:'等待加入',score:0}}
function other(){return room().players?.find(p=>p.id!==me())||{id:'',name:'TA',score:0}}
function cat(id){return CATS.find(c=>c.id===id)||CATS[0]}
function notify(text){const wrap=$('#toast-wrap'),n=document.createElement('div');n.className='toast';n.textContent=text;wrap.append(n);setTimeout(()=>n.remove(),3400)}
function beep(){ /* 靜音設計：沒有背景音樂或遊戲聲音 */ }
function burst(){const el=$('#burst-layer'),cols=['#8b7ce9','#f3b09f','#f1d483','#adddca','#c8b7eb'];for(let i=0;i<42;i++){const n=document.createElement('i');n.className='confetti';n.style.left=Math.random()*100+'%';n.style.setProperty('--color',cols[i%5]);n.style.setProperty('--dur',(2.3+Math.random()*2.5)+'s');n.style.animationDelay=(Math.random()*.6)+'s';el.append(n);setTimeout(()=>n.remove(),5400)}}
function todayQuestion(){const seed=Math.floor(new Date().setHours(0,0,0,0)/86400000);const arr=bank.filter(q=>q.topic==='couple');return arr[Math.abs(seed)%arr.length]}
function setPlayMode(next) {
 playMode=Object.hasOwn(gameModes,next)?next:null;
 $('#game-content').hidden=Boolean(playMode);
 $('#turn-tag').hidden=Boolean(playMode);
 $('#play-question-bank').hidden=!playMode;
 for(const button of $$('.play-picker button')) {
  const selected=(button.dataset.planetEntry??null)===playMode;
  button.classList.toggle('active',selected);
  button.setAttribute('aria-pressed',String(selected));
 }
 if(playMode)planetGame.open(playMode);
 try{sessionStorage.setItem('wenwen-play-mode',playMode??'')}catch{}
}

function setTab(next) {
 tab=next;
 for(const button of $$('.tab')){
  const active=button.dataset.tab===tab;
  button.classList.toggle('active',active);
  button.setAttribute('aria-selected',String(active));
 }
 for(const pane of $$('.pane'))pane.classList.toggle('active',pane.id===tab+'-pane');
 if(tab==='play')setPlayMode(null);
 if(tab==='create'){renderEditor();loadEditorArea()}
 if(tab==='challenge'){renderChallenge();refreshChallenge(true)}
 if(tab==='diary')renderDiary();
 if(tab==='word')wordGame.open();
 try{sessionStorage.setItem('wenwen-last-pane',tab)}catch{}
 window.scrollTo({top:Math.min(window.scrollY,520),behavior:'smooth'});
}
function renderHeader(){const r=room(),a=r.players?.[0],b=r.players?.[1];$('#name-a').textContent=a?.name||'等待加入';$('#name-b').textContent=b?.name||'等待加入';$('#avatar-a').textContent=(a?.name||'我').slice(0,2);$('#avatar-b').textContent=(b?.name||'TA').slice(0,2);$('#score-name-a').textContent=a?.name||'我';$('#score-name-b').textContent=b?.name||'TA';$('#score-a').textContent=a?.score||0;$('#score-b').textContent=b?.score||0;let total=(a?.score||0)+(b?.score||0);$('#score-progress').style.width=(total?Math.max(7,Math.round((a?.score||0)/total*100)):50)+'%';$('#score-caption').textContent=total?'繼續出題，看看還會發現什麼':'第一個挑戰即將開始';$('#pair-state').textContent=mode==='online'? (r.players?.length===2?'你們已經連線，可以輪流出題':'等待另一半加入房間…') : ('目前由 '+player(me()).name+' 操作 · 可切換角色');$('#switch-person').style.display=mode==='online'?'none':'inline-flex';$('#switch-person').textContent='切換玩家 ↔'}
function renderCats(){const wrap=$('#category-grid');wrap.innerHTML=CATS.map(c=>`<button class="category-card ${topic===c.id?'selected':''}" data-topic="${c.id}" aria-label="選擇${escape(c.name)}"><span class="cat-asterisk">✧</span><span class="cat-icon" style="--c:${c.color}">${c.emoji}</span><b>${escape(c.name)}</b><small>${escape(c.sub)}</small></button>`).join('')}
function resultContent(q){if(q.type==='open')return `<div class="result-panel"><span class="result-tag">💭 完成簡答 · +5 星</span><h3>看看彼此的答案吧 ♡</h3><p><b>${escape(player(q.answerBy).name)}的回答：</b>${escape(q.answerText||'已回覆')}</p>${q.referenceAnswer?`<p class="reference-answer"><b>出題者的參考答案：</b>${escape(q.referenceAnswer)}</p>`:''}<p>${escape(q.explanation||'答案沒有自動判對錯，先聊聊你們的想法吧。')}</p>${sourceLink(q)}</div>`;return `<div class="result-panel ${q.isCorrect?'correct':'wrong'}"><span class="result-tag">${q.isCorrect?'✦ 回答正確 · +10 星星':'✧ 差一點點 · 下次再挑戰'}</span><h3>${q.isCorrect?'好厲害！這顆知識星星是你的。':'猜錯也沒關係，收下今天的新知識！'}</h3><p><b>正確答案：</b>${escape(q.options[q.answerIndex]||'')}</p><p>${escape(q.explanation||'')}</p>${sourceLink(q)}</div>`}
function renderPlay(){const r=room(),q=r.current,who=me();$('#turn-tag').textContent=q?(q.answered?'已揭曉答案':q.createdBy===who?'已寄出 · 等待 TA':'輪到你回答'):'等待第一道題';const box=$('#game-content');
 const state=JSON.stringify([mode,who,r.round,q,r.players.map(({id,name})=>[id,name])]);
 if(state===playState)return;
 playState=state;
 if(!q){box.innerHTML=`<div class="empty-stage"><div><span class="tiny-label">HELLO, CURIOUS HEART</span><h3>第一道問題，<br>由你發射！ ✦</h3><p>可以問「如果我們交換一天的生活？」也可以出一題章魚有幾顆心的冷知識。</p><button class="button primary stage-button" data-stage="create">✎ 去出題工坊 <span>↗</span></button></div><div class="empty-stage-art">?</div></div>`;return}
 let meta=`<div class="question-head"><span class="posted-by"><span>${cat(q.topic).emoji}</span> ${escape(cat(q.topic).name)} · ${escape(player(q.createdBy).name)} 出題 · 第 ${r.round||1} 回合 ${q.origin==='ai'?'· ✨ AI 協助':''}</span></div>`;
 if(!q.answered&&q.createdBy===who){box.innerHTML=meta+`<div class="waiting-stage"><span class="waiting-symbol">💌</span><h3>問題已寄出，等待 TA 的答案。</h3><p>「${escape(q.question)}」<br>${mode==='demo'?'請切換到另一位玩家來回答。':'另一半打開同一間房間，就會收到問題。'}</p><button class="button ${mode==='demo'?'primary':'subtle'}" data-stage="${mode==='demo'?'switch':'invite'}">${mode==='demo'?'切換成 TA 來回答 ↔':'分享房間邀請 ↗'}</button></div>`;return}
 let body=`${meta}<div class="question-body"><h3>${escape(q.question)}</h3>${q.tag?`<p class="context">${escape(q.tag)}</p>`:''}</div>`;
 if(!q.answered){if(q.type==='open'){body+=`<div class="answer-open"><p>請直接輸入你的回答，不需要選擇選項。</p><textarea class="free-answer" id="open-response" maxlength="1000" placeholder="把你的答案寫在這裡……"></textarea></div><div class="answer-bar"><small>送出後，才能看到對方的參考答案 ♡</small><button class="button primary" data-stage="open-answer">送出答案 ↗</button></div>`}else{body+=`<div class="answer-choices">${q.options.map((opt,i)=>`<button class="answer-option" data-answer="${i}"><span class="letter-tag">${'ABCD'[i]}</span>${escape(opt)}</button>`).join('')}</div><div class="answer-bar"><small>偷偷想一下，再選你的答案。</small></div>`}}
 else{body+=resultContent(q)+`<div class="answer-bar"><small>${escape(player(q.answerBy).name)} 已回答</small><button class="button primary" data-stage="next">繼續下一題 ↗</button></div>`}
 box.innerHTML=body;
}
function renderDiary(){const r=room(),arr=r.history||[];$('#history-count').textContent=arr.length+' 次對話';$('#stat-questions').textContent=arr.length;$('#stat-stars').textContent=(r.players||[]).reduce((n,p)=>n+(p.score||0),0)+' ✦';const counts={};arr.forEach(q=>counts[q.topic]=(counts[q.topic]||0)+1);const fav=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];$('#stat-topic').textContent=fav?cat(fav).name:'等待發現';$('#history-items').innerHTML=arr.length?[...arr].reverse().slice(0,25).map(q=>`<div class="history-item"><span class="hicon">${cat(q.topic).emoji}</span><div><h4>${escape(q.question)}</h4><p>${escape(player(q.createdBy).name)} 問 · ${escape(player(q.answerBy).name)} 答 ${q.type==='open'?'· 💭 想法交換':q.isCorrect?'· ✦ 正確':'· ✧ 學到新知'} ${q.type==='open'?'':'· 正確答案：'+escape(q.options[q.answerIndex])}</p></div></div>`).join(''):`<div class="no-history"><div><span>☄️</span><p>你們的第一段問答，<br>還在飛來的路上。</p></div></div>`}
function newDraft(q) { draft=structuredClone(q); }

function bankMatches() {
 const terms=bankFilters.keywords.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
 return bank.filter(q=>q.topic===topic && (!bankFilters.level || q.level===bankFilters.level) &&
   (!bankFilters.style || q.style===bankFilters.style) &&
   terms.every(term=>[q.question,q.tag,q.referenceAnswer,q.explanation,...q.options].join(' ').normalize('NFKC').toLowerCase().includes(term)));
}

const deckKey=()=>`whyus-v4-deck-${session?.room || 'demo'}-${topic}`;
function selectBank() {
 const key=deckKey();
 const deck=safeJson(key,{seen:[],resetAt:0});
 const r=room();
 const recent=[...r.history,...(r.current?[r.current]:[])].filter(q=>!deck.resetAt||q===r.current||q.createdAt>=deck.resetAt).map(q=>q.question);
 draft=drawQuestion(bankMatches(),deck.seen,recent);
 if(draft) {
  deck.seen.push(draft.id);
  storeSet(key,JSON.stringify(deck));
 }
}

const deskKey=()=>`whyus-v4-studio-${session ? `${session.room}-${session.playerId}` : viewer}`;
const readDesk=(key=deskKey())=>safeJson(key,{drafts:[],favorites:[]});
function saveDesk(desk,key=deskKey()) {
 if(storeSet(key,JSON.stringify(desk)))return true;
 notify('瀏覽器無法儲存草稿或收藏，請檢查可用空間。');
 return false;
}

function renderEditor() {
 const body=$('#editor-content');
 $$('.mode-pill').forEach(button=>{
  const selected=button.dataset.mode===editorMode;
  button.classList.toggle('active',selected);
  button.setAttribute('aria-pressed',String(selected));
 });
 if(editorMode==='bank') {
  if(!draft || draft.topic!==topic || draft.origin) selectBank();
  body.innerHTML=bankEditor(draft,topic,bankFilters,bankMatches().length,id=>cat(id).name);
 }else if(editorMode==='custom'){
 body.innerHTML=`<div class="studio-editor"><h3>寫一道想問 TA 的問題。</h3><p class="lead">不用出選項。你只要寫問題，TA 就可以直接輸入答案；參考答案可留空。</p><div class="field"><label for="custom-question">你想問的問題 *</label><textarea maxlength="300" id="custom-question" placeholder="例如：我們第一次在灣仔吃飯，你點了什麼？">${escape(draft?.origin==='custom'?draft.question:'')}</textarea></div><div class="field"><label for="custom-reference">你的參考答案（可選）</label><textarea id="custom-reference" maxlength="300" placeholder="例如：冬陰功。這個答案會在 TA 回答後才公開。">${escape(draft?.origin==='custom'?(draft.referenceAnswer||''):'')}</textarea></div><div class="field"><label for="custom-explain">想對 TA 說的話（可選）</label><textarea id="custom-explain" maxlength="400" placeholder="回答完才會顯示，例如：那是我們第一次一起吃飯。">${escape(draft?.origin==='custom'?(draft.explanation||''):'')}</textarea></div><div class="studio-actions"><button class="button primary" data-editor="custom-send">把這題寄給 TA ↗</button></div><p class="custom-footnote">✦ 簡答題不自動判斷對錯。完成作答可得 5 顆星，適合情侶聊天，也可以考知識。</p></div>`;
 } else if(editorMode==='library') {
  body.innerHTML=`<div class="studio-editor">${libraryPanel(roomQuestions,Boolean(session))}</div>`;
 } else {
  const material=editorMode==='documents';
  const {drafts,favorites}=material?{drafts:materialDrafts,favorites:[]}:readDesk();
  const savedMode=editorMode==='favorites';
  const cards=(savedMode?favorites:drafts).map(q=>reviewCard(q,id=>cat(id).name,{
   editing:q.id===editingId,
   saved:favorites.some(item=>item.id===q.id),
   favorites:savedMode,
   online:Boolean(session),material,local:material&&localAiEnabled&&localAiAvailable()
  })).join('');
  body.innerHTML=`<div class="studio-editor">${savedMode ?
   '<h3>我的收藏</h3><p class="lead">收藏儲存在這個瀏覽器，並依房間與玩家分開。</p>' :
   material ? documentsPanel(documents,selectedDoc,CATS,documentSettings,Boolean(session)) :
   quickEditor(aiSettings,CATS,aiBusy,Boolean(session))}
   ${cards||(savedMode?'<p class="ai-warning">核可草稿後，就可以加入收藏。</p>':'')}</div>`;
 }
}

async function createQuestion(q) {
 if(room().current) {
  notify('先完成現在這一道題，再寄出下一題喔。');
  setTab('play');
  return false;
 }
 if(mode==='online'&&room().players.length<2) {
  notify('請先邀請另一半加入，才能開始雙人出題。');
  showConnection();
  return false;
 }
 try {
  if(mode==='online') {
   const active=session;
   const result=await callApi(`/api/rooms/${encodeURIComponent(active.room)}/question`,{method:'POST',body:q,auth:true});
   if(session!==active)return true;
   online=result.room;
  } else {
   demo.current={...q,id:'sent'+Date.now(),createdBy:viewer,answered:false,answerBy:null,answerText:null,createdAt:Date.now()};
   demo.updatedAt=Date.now();
   saveDemo();
  }
  notify('問題寄出成功！✉');
  setTab('play');
  renderAll();
  return true;
 } catch(e) {
  notify(e.message||'寄題失敗');
  return false;
 }
}
function grabCustom(){const question=$('#custom-question')?.value.trim();if(!question||question.length<2){notify('請先寫一道問題（至少 2 個字）。');$('#custom-question')?.focus();return null}return {topic,type:'open',question,options:[],answerIndex:0,referenceAnswer:$('#custom-reference')?.value.trim()||'',explanation:$('#custom-explain')?.value.trim()||'',source_url:'',source_title:'',tag:'',origin:'custom'}}
async function answerCurrent(value){const q=room().current;if(!q||q.answered||q.createdBy===me())return;try{if(mode==='online'){await callApi(`/api/rooms/${encodeURIComponent(session.room)}/answer`,{method:'POST',body:q.type==='open'?{text:String(value)}:{answerIndex:Number(value)},auth:true});await refreshOnline()}else{q.answered=true;q.answerBy=viewer;if(q.type==='open'){q.answerText=String(value);player(viewer).score+=5;q.isCorrect=null}else{q.selectedIndex=Number(value);q.isCorrect=q.selectedIndex===q.answerIndex;if(q.isCorrect)player(viewer).score+=10}demo.updatedAt=Date.now();saveDemo()}beep(room().current?.isCorrect===false?'wrong':'win');if(room().current?.isCorrect)burst();renderAll()}catch(e){notify(e.message||'提交失敗')}}
async function nextRound(){if(!room().current?.answered)return;try{if(mode==='online'){await callApi(`/api/rooms/${encodeURIComponent(session.room)}/next`,{method:'POST',body:{},auth:true});await refreshOnline()}else{demo.history.push({...demo.current});demo.current=null;demo.round++;demo.updatedAt=Date.now();saveDemo()}beep('tap');renderAll()}catch(e){notify(e.message||'無法繼續')}}
async function callApi(url,{method='GET',body,raw,fileName,download=false,auth=false,timeout=22000}={}){
 if(location.protocol==='file:')throw Error('單檔 HTML 不支援異地連線。請在已部署的 HTTPS 網址建立房間。');
 const opts={method,headers:{'Accept':'application/json','Content-Type':'application/json'}};
 if(auth&&session?.token)opts.headers.Authorization='Bearer '+session.token;
 if(raw!==undefined) {
  opts.body=raw;
  opts.headers['Content-Type']='application/octet-stream';
  opts.headers['X-File-Name']=encodeURIComponent(fileName);
 } else if(body!==undefined)opts.body=JSON.stringify(body);
 const ctl=new AbortController();opts.signal=ctl.signal;const id=setTimeout(()=>ctl.abort(),timeout);
 try{
  const r=await fetch(url,opts);
  if(download&&r.ok)return r.blob();
  const type=r.headers.get('content-type')||'';
  if(!type.includes('application/json')){
   throw Error('找不到 Netlify Functions。請使用正式部署網站，確認後端 Functions 已發佈。');
  }
  let v;try{v=await r.json()}catch{throw Error('伺服器資料格式錯誤，請檢查部署是否完整。')}
  if(!r.ok)throw Error(v.error||`伺服器錯誤 ${r.status}`);return v;
 }catch(e){if(e.name==='AbortError')throw Error('連線逾時，請稍後再試');if(e instanceof TypeError)throw Error('連線服務不可用，請確認已開啟正式部署網址。');throw e}finally{clearTimeout(id)}
}
async function checkRoomService(){
 const status=$('#connect-status'),action=$('[data-dialog="create"]')||$('[data-dialog="join"]');
 if(!status||!action)return;
 action.disabled=true;status.textContent='正在檢查線上房間服務…';
 try{const x=await callApi('/api/health');if(!x.onlineReady){status.textContent='雙人房間未啟用：請在 Netlify 設定 Supabase URL 和 Secret Key，然後重新部署。';return}
 status.textContent='● 雙人房間服務已連線，可以建立或加入房間。';action.disabled=false;
 }catch(e){status.textContent='● '+e.message}
}

async function refreshOnline() {
 if(!session)return;
 const active=session;
 try {
  const result=await callApi(`/api/rooms/${encodeURIComponent(active.room)}`,{auth:true});
  if(session!==active)return;
  if(!online || result.room.updatedAt>=online.updatedAt)online=result.room;
  connected=true;
  const enabled=result.localAiEnabled===true;
  if(enabled!==localAiEnabled){
   localAiEnabled=enabled;
   if(tab==='create'&&editorMode==='documents'&&!editingId)renderEditor();
  }
  renderAll();
  if(tab==='challenge')refreshChallenge();
 } catch(e) {
  if(session!==active)return;
  connected=false;
  renderHeader();
  if(/不存在|權限|token|有效/i.test(e.message)) {
   notify('房間驗證失效，已切回本機模式。');
   leaveOnline();
  }
 }
}
function startPolling(){clearInterval(poll);poll=setInterval(()=>{if(mode==='online'&&session){refreshOnline();planetGame.refresh();wordGame.refresh()}},2200)}
function refreshStudioContext() {
 draft=null;
 editingId=null;
 documents=[];selectedDoc=null;materialDrafts=[];roomQuestions=[];
 challenge=null;challengeVersion=-1;challengeKey='';challengeNew=false;challengeSelection.clear();
 if(tab==='create'){renderEditor();loadEditorArea()}
 if(tab==='challenge'){renderChallenge();refreshChallenge(true)}
 if(tab==='play'&&playMode)planetGame.open(playMode,true);
 if(tab==='word')wordGame.open();
}
function leaveOnline(){clearInterval(poll);mode='demo';session=null;online=null;connected=false;localAiEnabled=false;saveSession();refreshStudioContext();renderAll()}
function connectRoom(s,data){session={room:data.code,playerId:data.playerId,token:data.token};saveSession();mode='online';connected=true;online=data.room;localAiEnabled=data.localAiEnabled===true;startPolling();hideDialog();beep('win');refreshStudioContext();renderAll()}
function dialog(html){$('#dialog').innerHTML=`<button class="x" id="close-dialog" aria-label="關閉">×</button>${html}`;$('#modal-backdrop').classList.remove('hidden');$('#close-dialog').onclick=hideDialog}
function hideDialog(){$('#modal-backdrop').classList.add('hidden');modalKind=null}
function showConnection(){modalKind='connect';const r=room();const params=new URLSearchParams(location.search);const link=mode==='online'?location.origin+location.pathname+'?room='+encodeURIComponent(session.room):'';dialog(`<div class="modal-icon">🪐</div><span class="eyebrow dark">DISTANCE? NO PROBLEM.</span><h2>邀請 TA，來你的星球玩。</h2><p>部署完成後，建立專屬房間，複製邀請連結給 TA；兩部手機就能跨城市互相出題。</p>${mode==='online'?`<div class="room-code">${escape(session.room)}</div><div class="invite-box">房間邀請網址：<br>${escape(link)}</div><div class="dialog-buttons"><button class="button primary" data-dialog="copy">複製邀請連結 ↗</button><button class="button subtle" data-dialog="leave">離開線上房間</button></div><p class="tip">已連線：${escape(r.players.map(x=>x.name).join('、'))}。房間碼相當於入場券，請只分享給信任的人。</p>`:`<div class="field"><label for="local-a">玩家 1</label><input id="local-a" maxlength="16" value="${escape(demo.players[0].name)}" /></div><div class="field"><label for="local-b">玩家 2</label><input id="local-b" maxlength="16" value="${escape(demo.players[1].name)}" /></div><button class="button subtle full-width" data-dialog="save-names">儲存暱稱</button><div class="separator">或使用雙人連線</div><p id="connect-status" class="tip" role="status">檢查中…</p><div class="field"><label for="room-name">你的暱稱</label><input id="room-name" maxlength="16" placeholder="例如：豆包" /></div><div class="dialog-buttons"><button class="button primary" data-dialog="create">建立雙人房間</button><button class="button ghost" data-dialog="join-form">輸入房間碼加入</button></div><p class="tip">線上房間由 Netlify Functions 與 Supabase 儲存。若顯示未連線，請確認已部署網站並設定環境變數。</p>`}`);if(mode!=='online')checkRoomService()}
function showJoin(){modalKind='join';const code=new URLSearchParams(location.search).get('room')||'';dialog(`<div class="modal-icon">💌</div><span class="eyebrow dark">JOIN THE UNIVERSE</span><h2>收到 TA 的邀請了嗎？</h2><p>輸入房間碼和暱稱，就能在兩部手機同步問答。</p><div class="field"><label for="join-code">房間碼</label><input id="join-code" maxlength="12" autocapitalize="characters" value="${escape(code)}" placeholder="例如：7KQ4M2TY" /></div><div class="field"><label for="join-name">你的暱稱</label><input id="join-name" maxlength="16" placeholder="例如：原寶" /></div><p id="connect-status" class="tip" role="status">檢查中…</p><div class="dialog-buttons"><button class="button primary full-width" data-dialog="join">加入房間 ↗</button></div><div class="tip">請使用 Netlify 正式網站網址。房間邀請碼請只分享給另一半。</div>`);checkRoomService()}
function showInfo(){modalKind='info';dialog(`<div class="modal-icon">✳</div><h2>怎樣一起玩？</h2><p>① 一方出題，另一方作答。答對知識題獲得 10 顆星；開放題分享想法得到 5 顆星。<br>② 選擇「關於我們、科普、歷史、十萬個為什麼、腦筋急轉彎」等領域。<br>③ 同一台手機可切換玩家；兩部手機互動時，請建立並分享線上房間。<br>④ 資料出題可用自己的文章或筆記。審核後分享至房間題庫，就能選題闖關。<br>⑤ 答案、解說與戰績會留在你們的房間；這是原型版本，正式部署前需要更完善的帳號和隱私控制。</p><div class="dialog-buttons"><button class="button primary full-width" data-dialog="close">我知道啦 ♡</button></div>`)}
async function copyLink(){const url=location.origin+location.pathname+'?room='+encodeURIComponent(session.room);try{await navigator.clipboard.writeText(url);notify('邀請連結已複製！')}catch{window.prompt('請複製這個邀請連結：',url)}}
function renderAll(){renderHeader();renderCats();renderPlay();renderDiary();$('#today-date').textContent=new Date().toLocaleDateString('zh-Hant',{month:'short',day:'numeric'})+' · TODAY';$('#daily-question').textContent=todayQuestion().question}
function setMode(m){editorMode=m;draft=null;editingId=null;renderEditor();loadEditorArea()}
function setTopic(t) {
 topic=t;
 aiSettings.topic=t;
 aiSettings.type=t==='couple'?'open':'choice';
 draft=null;
 renderCats();
 if(tab==='create'&&(editorMode==='ai'||editorMode==='bank'))renderEditor();
}
function readAISettings() {
 if(!$('#ai-settings'))return;
 Object.assign(aiSettings,{
  topic:$('#ai-topic').value,type:$('#ai-type').value,level:$('#ai-tone').value,
  style:$('#ai-style').value,count:Number($('#ai-count').value),keywords:$('#ai-keywords').value
 });
}
function renderAIAvailability() {
 readAISettings();
 renderEditor();
}

async function reviewAction(card, action, button) {
 const material=editorMode==='documents';
 const key=deskKey(), desk=material?{drafts:materialDrafts,favorites:[]}:readDesk(key), id=card.dataset.questionId;
 const active=session;
 const list=editorMode==='favorites'?'favorites':'drafts';
 const q=desk[list].find(item=>item.id===id);
 if(!q)return;
 const replace=value=>{
  for(const name of ['drafts','favorites'])desk[name]=desk[name].map(item=>item.id===id?value:item);
 };
 switch(action) {
 case 'edit':
  editingId=id;
  renderEditor();
  return;
 case 'cancel-edit':
  editingId=null;
  renderEditor();
  return;
 case 'approve': {
  const approved=readReview(card,q);
  const others=[...desk.drafts,...desk.favorites].filter(item=>item.id!==id).map(item=>item.question);
  if(isDuplicate(approved.question,others))throw Error('已有相同或相近的題目。');
  replace(approved);
  break;
 }
 case 'local-rewrite': {
  if(!material)return;
  if(localAiBusy){notify('另一道題正在本機改寫，請稍候。');return}
  localAiBusy=true;
  button.disabled=true;
  button.textContent='載入本地模型…';
  try {
   const result=await rewriteOnDevice(q,{onProgress: info=>{
    button.textContent=info.progress>=1?'正在本機改寫…':`下載本地模型 ${Math.round(info.progress*100)}%`;
   }});
   if(session!==active||editorMode!=='documents'||!materialDrafts.includes(q))return;
   materialDrafts=materialDrafts.map(item=>item.id===id?result:item);
   renderEditor();
   return;
  } finally {
   localAiBusy=false;
   button.disabled=false;
   button.textContent='在此裝置改寫題幹';
  }
  break;
 }
 case 'share-library': {
  if(q.reviewState==='draft')return;
  const result=await roomCall('library',{method:'POST',body:{...q,reviewState:'approved'}});
  if(session!==active)return;
  roomQuestions=[result.question,...roomQuestions];
  if(material)desk.drafts=desk.drafts.filter(item=>item.id!==q.id);
  notify('已分享至房間題庫。');
  break;
 }
 case 'favorite':
  if(q.reviewState==='draft')return;
  if(isDuplicate(q.question,desk.favorites.map(item=>item.question)))throw Error('你已收藏同一道題。');
  if(desk.favorites.length>=200)throw Error('收藏已滿，請先移除部分題目。');
  desk.favorites.unshift(q);
  break;
 case 'unfavorite':
 case 'discard':
  desk[list]=desk[list].filter(item=>item.id!==id);
  break;
 case 'send-ai':
  if(q.reviewState==='draft')return;
  if(!await createQuestion({...q,reviewState:'approved'}))return;
  // Re-read after the request so this write keeps other edits made while sending.
  for(const [name,items] of Object.entries(readDesk(key)))desk[name]=items;
  replace({...q,reviewState:'used'});
  break;
 default:
  return;
 }
 if(material)materialDrafts=desk.drafts;
 if((material||saveDesk(desk,key))&&deskKey()===key) {
  editingId=null;
  if(tab==='create')renderEditor();
 }
}

async function handleEditorClick(event) {
 const button=event.target.closest('[data-editor]');
 if(!button)return;
 const action=button.dataset.editor;
 readAISettings();
 try {
  switch(action) {
  case 'shuffle':selectBank();renderEditor();break;
  case 'reset-bank':
   storeSet(deckKey(),JSON.stringify({seen:[],resetAt:Date.now()}));
   selectBank();
   renderEditor();
   break;
  case 'send':
   if(draft)await createQuestion({...draft,origin:'bank'});
   break;
  case 'custom-send':{
   const q=grabCustom();
   if(q){newDraft(q);await createQuestion(q)}
   break;
  }
  case 'go-ai':setMode('ai');break;
  case 'go-documents':setMode('documents');break;
  case 'select-doc':selectedDoc=button.dataset.id;renderEditor();break;
  case 'download-doc':await downloadDocument(button.dataset.id);break;
  case 'delete-doc':await deleteDocument(button.dataset.id);break;
  case 'reload-library':await refreshLibrary();break;
  case 'send-library':await createQuestion({libraryId:button.dataset.id});break;
  case 'remove-library':await removeLibraryQuestion(button.dataset.id);break;
  case 'go-challenge':setTab('challenge');break;
  case 'go-bank':setMode('bank');break;
  case 'connect':showConnection();break;
  default:{
   const card=button.closest('[data-question-id]');
   if(card)await reviewAction(card,action,button);
  }
  }
 } catch(error) {notify(error.message)}
}

async function handleEditorSubmit(event) {
 event.preventDefault();
 if(event.target.id==='bank-filters') {
  Object.assign(bankFilters,{level:$('#bank-level').value,style:$('#bank-style').value,keywords:$('#bank-keywords').value.trim()});
  selectBank();
  renderEditor();
 } else if(event.target.id==='ai-settings') {
  readAISettings();
  await quickDrafts(event.target.querySelector('button[type="submit"]'));
 } else if(event.target.id==='document-upload'||event.target.id==='document-generate') {
  const button=event.target.querySelector('button[type="submit"]');
  const label=button.textContent;
  button.disabled=true;
  button.textContent=event.target.id==='document-upload'?'正在擷取文字…':'正在產生草稿…';
  try {
   if(event.target.id==='document-upload')await submitDocument();
   else await generateFromDocument();
  } catch(error) {notify(error.message)}
  finally {button.disabled=false;button.textContent=label}
 }
}

function init(){renderAll();setTab('play');$$('.tab').forEach(b=>b.addEventListener('click',()=>{beep();setTab(b.dataset.tab)}));$('#hero-start').onclick=()=>setTab('create');$('#hero-join').onclick=showConnection;$('#info-btn').onclick=showInfo;$('#switch-person').onclick=()=>{viewer=viewer==='a'?'b':'a';storeSet('whyus-viewer',viewer);refreshStudioContext();beep();renderAll()};$('#category-grid').addEventListener('click',e=>{const b=e.target.closest('[data-topic]');if(!b)return;setTopic(b.dataset.topic);setTab('create')});$('#use-daily').onclick=()=>{setTopic('couple');editorMode='bank';newDraft(todayQuestion());setTab('create')};$('#new-round').onclick=()=>setTab('create');$('.mode-pills').onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;beep();setMode(b.dataset.mode)};
 $('#game-content').addEventListener('click',async e=>{const answer=e.target.closest('[data-answer]');if(answer){await answerCurrent(Number(answer.dataset.answer));return}const a=e.target.closest('[data-stage]');if(!a)return;switch(a.dataset.stage){case 'create':setTab('create');break;case 'switch':$('#switch-person').click();break;case 'invite':showConnection();break;case 'open-answer':{const text=$('#open-response')?.value.trim();if(!text)return notify('請先輸入你的答案。');await answerCurrent(text);break}case 'next':await nextRound();break}});
 $('#editor-content').addEventListener('input',readAISettings);
 $('#editor-content').addEventListener('change',readAISettings);
 $('#editor-content').addEventListener('click',handleEditorClick);
 $('#editor-content').addEventListener('submit',handleEditorSubmit);
 $('#challenge-content').addEventListener('click',handleChallengeClick);
 $('#challenge-content').addEventListener('submit',handleChallengeSubmit);
 $('#challenge-content').addEventListener('change',event=>{
  const input=event.target;
  if(input.name!=='question')return;
  if(input.checked&&challengeSelection.size>=5){input.checked=false;notify('一次最多選 5 題。');return}
  if(input.checked)challengeSelection.add(input.value);else challengeSelection.delete(input.value);
 });
 $('#modal-backdrop').addEventListener('click',e=>{if(e.target.id==='modal-backdrop')hideDialog()});$('#dialog').addEventListener('click',async e=>{const a=e.target.closest('[data-dialog]');if(!a)return;const action=a.dataset.dialog;try{if(action==='close'){hideDialog();return}if(action==='save-names'){demo.players[0].name=$('#local-a').value.trim().slice(0,16)||'我';demo.players[1].name=$('#local-b').value.trim().slice(0,16)||'TA';saveDemo();renderAll();hideDialog();notify('暱稱已更新');return}if(action==='create'){const health=await callApi('/api/health');if(!health.onlineReady)throw Error('Supabase 尚未準備好，請先完成環境變數設定');const name=$('#room-name').value.trim()||'我';const v=await callApi('/api/rooms',{method:'POST',body:{name}});connectRoom(null,v);showConnection();return}if(action==='join-form'){showJoin();return}if(action==='join'){const code=$('#join-code').value.trim().toUpperCase(),name=$('#join-name').value.trim()||'TA';if(!code)return notify('請填入房間碼');const v=await callApi('/api/rooms/'+encodeURIComponent(code)+'/join',{method:'POST',body:{name}});connectRoom(null,v);showConnection();return}if(action==='copy'){await copyLink();return}if(action==='leave'){leaveOnline();hideDialog();notify('已切回單機輪流模式');return}}catch(err){notify(err.message||'連線失敗，請確認伺服器正在運行')}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal-backdrop').classList.contains('hidden'))hideDialog()});
 if(session&&location.protocol==='file:'){leaveOnline();notify('單檔網頁無法連上原來的房間，已改為單機輪流模式。')}else if(session){refreshOnline().then(()=>startPolling())}else if(new URLSearchParams(location.search).has('room')){showJoin()}
}
async function quickDrafts(button) {
 if(aiBusy||!session)return;
 if(editingId){notify('請先儲存或取消正在編輯的題目。');return}
 const active=session, key=deskKey();
 const {drafts,favorites}=readDesk(key);
 if(drafts.length+aiSettings.count>60) {
  notify('草稿最多保存 60 題，請先移除部分草稿。');
  return;
 }
 const recent=[...new Set([...drafts,...favorites].map(q=>q.question))].slice(0,30);
 aiBusy=true;
 button.disabled=true;
 button.textContent='正在生成題目…';
 try {
  const {questions}=await callApi('/api/questions/generate',{
   method:'POST',auth:true,timeout:57000,body:{room:active.room,...aiSettings,recent}
  });
  if(!questions.length){notify('沒有符合條件的新題，請調整篩選。');return}
  const desk=readDesk(key);
  desk.drafts.unshift(...questions);
  if(saveDesk(desk,key)&&session===active)notify(`已生成 ${questions.length} 題，請逐題核對。`);
 } catch(e) {
  if(session===active)notify(e.message||'AI 出題失敗');
 } finally {
  aiBusy=false;
  if(tab==='create'&&editorMode==='ai'&&!editingId)renderAIAvailability();
 }
}
function roomCall(path, options) {
 if(!session)throw Error('請先加入線上房間。');
 return callApi(`/api/rooms/${encodeURIComponent(session.room)}/${path}`,{...options,auth:true});
}

function loadEditorArea() {
 if(!session)return;
 const task=editorMode==='documents'?refreshDocuments():editorMode==='library'?refreshLibrary():null;
 task?.catch(error=>notify(error.message));
}

async function refreshDocuments() {
 const active=session;
 const result=await roomCall('documents');
 if(session!==active)return;
 documents=result.documents;
 if(!documents.some(doc=>doc.id===selectedDoc&&doc.state==='ready'))selectedDoc=null;
 if(tab==='create'&&editorMode==='documents')renderEditor();
}

async function refreshLibrary() {
 const active=session;
 const result=await roomCall('library');
 if(session!==active)return;
 roomQuestions=result.questions;
 if(tab==='create'&&editorMode==='library')renderEditor();
 if(tab==='challenge')renderChallenge();
}

async function submitDocument() {
 const active=session;
 const file=$('#document-file').files[0];
 const text=$('#document-text').value.trim();
 if(Boolean(file)===Boolean(text))throw Error('請選一份檔案，或貼上文字。');
 if(file?.size>3*1024*1024)throw Error('檔案最多 3 MiB。');
 const response=await roomCall('documents',{
  method:'POST',raw:file??text,fileName:file?.name??'貼上的文字.txt',timeout:55000
 });
 if(session!==active)return;
 selectedDoc=response.document.id;
 await refreshDocuments();
 notify('已擷取文字，可開始出題。');
}

async function generateFromDocument() {
 const active=session, id=selectedDoc;
 if(!id)return;
 Object.assign(documentSettings,{topic:$('#doc-topic').value,type:$('#doc-type').value,count:Number($('#doc-count').value)});
 const recent=[...materialDrafts,...roomQuestions,...room().history].map(q=>q.question).slice(0,60);
 const {questions}=await roomCall(`documents/${encodeURIComponent(id)}/drafts`,{method:'POST',body:{...documentSettings,recent}});
 if(session!==active)return;
 materialDrafts=[...questions,...materialDrafts].slice(0,60);
 if(tab==='create'&&editorMode==='documents')renderEditor();
 notify(questions.length ? `生成 ${questions.length} 道可核對的草稿。` : '資料暫時無法生成這種題型。請改試簡答或補充資料。');
}

async function downloadDocument(id) {
 const doc=documents.find(item=>item.id===id);
 if(!doc)return;
 const active=session;
 const blob=await roomCall(`documents/${encodeURIComponent(doc.id)}/download`,{download:true});
 if(session!==active)return;
 const href=URL.createObjectURL(blob);
 const link=document.createElement('a');
 link.href=href;
 link.download=doc.title;
 link.click();
 setTimeout(()=>URL.revokeObjectURL(href),1000);
}

async function deleteDocument(id) {
 if(!window.confirm('刪除此文件和由它分享至題庫的題目？已寄出的問答和已開始的闖關會保留。'))return;
 const active=session;
 await roomCall(`documents/${encodeURIComponent(id)}`,{method:'DELETE'});
 if(session!==active)return;
 materialDrafts=materialDrafts.filter(q=>q.documentId!==id);
 await refreshDocuments();
 notify('已刪除原檔和連結的題庫題目。');
}

async function removeLibraryQuestion(id) {
 if(!window.confirm('將題目移出房間題庫？'))return;
 await roomCall(`library/${encodeURIComponent(id)}`,{method:'DELETE'});
 await refreshLibrary();
}

function renderChallenge() {
 const state={challenge,questions:roomQuestions,players:room().players,me:me(),online:Boolean(session),newRound:challengeNew};
 const key=JSON.stringify(state);
 if(challengeKey===key)return;
 challengeKey=key;
 $('#challenge-content').innerHTML=challengePanel({...state,selected:challengeSelection});
}

function applyChallenge(result, active) {
 if(session!==active||result.version<challengeVersion)return;
 if(result.challenge?.id!==challenge?.id)challengeNew=false;
 challenge=result.challenge;
 challengeVersion=result.version;
 if(tab==='challenge')renderChallenge();
}

let challengeRefresh;
async function refreshChallenge(withLibrary=false) {
 if(!session)return;
 const active=session;
 if(challengeRefresh===active)return;
 challengeRefresh=active;
 try {
  const result=await roomCall('challenge');
  applyChallenge(result,active);
  if(session===active&&(withLibrary||(!challenge&&roomQuestions.length<3)))await refreshLibrary();
 } catch(error) {
  if(withLibrary&&session===active)notify(error.message);
 } finally {
  if(challengeRefresh===active)challengeRefresh=null;
 }
}

async function changeChallenge(action, body) {
 if(challengeBusy)return;
 challengeBusy=true;
 const active=session;
 try {
  const result=await roomCall(`challenge/${action}`,{method:'POST',body});
  if(session!==active)return;
  if(action==='start')challengeSelection.clear();
  applyChallenge(result,active);
 } catch(error) {
  notify(error.message);
  await refreshChallenge();
 } finally {challengeBusy=false}
}

async function handleChallengeClick(event) {
 const button=event.target.closest('[data-challenge]');
 if(!button)return;
 const action=button.dataset.challenge;
 if(action==='connect')showConnection();
 else if(action==='library'){editorMode='library';setTab('create')}
 else if(action==='reload')await refreshChallenge(true);
 else if(action==='restart'){challengeNew=true;renderChallenge();await refreshChallenge(true)}
 else if(challenge&&action==='choice')await changeChallenge('answer',{id:challenge.id,step:challenge.step,answerIndex:Number(button.dataset.index)});
 else if(challenge&&action==='next')await changeChallenge('next',{id:challenge.id,step:challenge.step});
}

async function handleChallengeSubmit(event) {
 event.preventDefault();
 if(event.target.id==='challenge-start'){
  await changeChallenge('start',{questionIds:[...challengeSelection],previousId:challenge?.id});
 } else if(event.target.id==='challenge-answer'&&challenge){
  await changeChallenge('answer',{id:challenge.id,step:challenge.step,text:$('#challenge-text').value});
 }
}

const planetGame=mountPlanetGame({
 panel:$('#play-question-bank'),visible:()=>tab==='play'&&Boolean(playMode),session:()=>session,room,request:callApi,invite:showConnection
});
const wordGame=mountWordGame({
 panel:$('#word-pane'),visible:()=>tab==='word',session:()=>session,room,request:callApi,invite:showConnection
});
let resumedPane,resumedPlayMode;
try{
 resumedPane=sessionStorage.getItem('wenwen-last-pane');
 resumedPlayMode=sessionStorage.getItem('wenwen-play-mode');
}catch{}
init();
if(resumedPane==='word')setTab('word');
if(resumedPane==='planet')setPlayMode('quiz');
if(resumedPane==='play'&&resumedPlayMode)setPlayMode(resumedPlayMode);
$('#hero-word').onclick=()=>{
 setTab('word');
 $('#word-pane').scrollIntoView({block:'start'});
};
$('#play-original').onclick=()=>setPlayMode(null);
for(const entry of $$('[data-planet-entry]'))entry.onclick=()=>setPlayMode(entry.dataset.planetEntry);
})();
