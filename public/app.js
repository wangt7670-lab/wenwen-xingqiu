(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const SAVE_KEY='whyus-couple-demo-v1', SESSION_KEY='whyus-couple-session-v1';
const storeGet=k=>{try{return localStorage.getItem(k)}catch{return null}};
const storeSet=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
const storeRemove=k=>{try{localStorage.removeItem(k)}catch{}};
const CATS=[
 {id:'couple',emoji:'💌',name:'關於我們',sub:'默契、秘密與小心思',color:'#fbe7ec'},
 {id:'why',emoji:'💡',name:'十萬個為什麼',sub:'那些奇奇怪怪的好奇',color:'#fff0cd'},
 {id:'science',emoji:'🪐',name:'科學科普',sub:'宇宙、動物與冷知識',color:'#e3e7ff'},
 {id:'history',emoji:'🏛️',name:'歷史穿越',sub:'穿越時空來一題',color:'#dff1e9'},
 {id:'riddle',emoji:'🧩',name:'腦筋急轉彎',sub:'答錯也能笑出來',color:'#ffe7d6'},
 {id:'news',emoji:'🌏',name:'當下熱點',sub:'AI 搜尋新近資訊',color:'#e9e4f8'},
];
// Curated evergreen content; "當下熱點" deliberately has no offline factual items.
const BANK=[
 ['couple','open','如果今天只能分享一件小事給我，你會選哪件？','',[],0,'沒有標準答案。真正的任務是聽完彼此的故事。'],
 ['couple','open','我做過哪件看似普通的小事，讓你偷偷開心過？','',[],0,'問完也記得分享自己的答案。'],
 ['couple','open','如果我們有一張「下一次見面」願望清單，第一項是什麼？','',[],0,'可以把答案真的加入你們的下次約會。'],
 ['couple','open','哪一次遠距離聊天，你最捨不得掛電話？','',[],0,'交換回憶，而不是比誰記得更多。'],
 ['couple','open','如果我們可以在一座城市一起生活一天，你最想安排什麼？','',[],0,'你們可以互相設計一日旅行路線。'],
 ['couple','open','你覺得我們的相處，最像哪一部動漫或電影？為什麼？','',[],0,'比較理由比片名更有趣。'],
 ['couple','open','最近你有沒有一件想讓我知道，卻一直忘記說的小事？','',[],0,'這道題很適合在睡前玩。'],
 ['couple','open','如果今天交換一天的生活，你最想體驗我的哪個時刻？','',[],0,'別忘了描述你想看到的細節。'],
 ['couple','open','幫我們的異地關係發明一個好笑的超能力，會是什麼？','',[],0,'例如瞬間把對方送到喜歡的餐廳。'],
 ['couple','open','如果未來想一起完成一件有點瘋狂的小事，你會選什麼？','',[],0,'可以盡情腦洞，不用立刻實現。'],
 ['why','choice','天空大多時候呈現藍色，最主要是因為？','',['海洋反射到天空','空氣分子更容易散射短波長光','太陽本來就是藍色','雲把藍色留住'],1,'陽光中的較短波長光在大氣中更容易被散射，這稱為瑞利散射。'],
 ['why','choice','海水為什麼通常有鹹味？','',['海裡的魚製造鹽','河流與海底作用帶來溶解的礦物鹽','海水吸收月光變鹹','大海在蒸發糖'],1,'岩石風化、河流輸送和海底地質作用提供溶解離子，海水長期循環形成鹽度。'],
 ['why','choice','熱氣球受熱後為什麼能升空？','',['熱空氣密度比周圍冷空氣低','火焰會直接向上推氣球','布料會變得比空氣輕','雲會吸住它'],0,'氣球內熱空氣密度較低，排開較重的外界空氣產生向上的浮力。'],
 ['why','choice','為什麼在炎熱天氣吹風常會覺得更涼爽？','',['風產生冷氣','風促進汗液蒸發並帶走熱量','空氣變成冰','體溫會立刻歸零'],1,'風吹走皮膚附近的濕空氣，通常能促進汗液蒸發；環境條件也會影響效果。'],
 ['why','choice','蜜蜂跳「搖擺舞」主要是要傳遞什麼？','',['自己有多開心','食物來源的大致方向和距離','明天的天氣','蜂后的生日'],1,'蜜蜂可利用搖擺舞向同伴傳遞蜜源方向與距離等資訊。'],
 ['why','choice','為什麼閃電通常比雷聲先被看到？','',['雷聲晚幾分鐘才發生','光傳播速度遠快於聲音','眼睛先聽見閃電','雲層藏住聲音'],1,'光速遠大於聲速，因此同一次放電事件中光先抵達觀察者。'],
 ['science','choice','章魚通常有幾顆心臟？','',['1 顆','2 顆','3 顆','8 顆'],2,'章魚有兩顆鰓心臟，另有一顆全身循環心臟。'],
 ['science','choice','下列哪個是人體面積最大的器官？','',['心臟','皮膚','肝臟','肺'],1,'皮膚覆蓋人體表面，是人體面積最大的器官。'],
 ['science','choice','地球大氣中比例最高的氣體是？','',['氧氣','二氧化碳','氮氣','氫氣'],2,'乾燥空氣中氮氣約佔 78%，氧氣約佔 21%。'],
 ['science','choice','金星比水星的平均表面溫度更高，主要因為？','',['更靠近太陽','厚重大氣造成強烈溫室效應','金星沒有自轉','金星有更多海洋'],1,'金星有極厚的二氧化碳大氣，造成強烈溫室效應。'],
 ['science','choice','我們看到的月光主要來自？','',['月球自己發光','太陽光被月面反射','地球核心放光','恆星在月球內燃燒'],1,'月球本身不發出可見光，明亮的月面主要反射太陽光。'],
 ['science','choice','下列哪種動物屬於哺乳類？','',['企鵝','鯨魚','章魚','海馬'],1,'鯨魚會用肺呼吸、哺育幼崽，屬於哺乳類。'],
 ['history','choice','秦始皇完成統一六國，建立秦朝是在？','',['公元前 221 年','公元 221 年','公元前 618 年','公元 960 年'],0,'秦朝在公元前 221 年完成統一，建立中央集權的帝國體制。'],
 ['history','choice','人類首次成功登上月球是在？','',['1959 年','1969 年','1979 年','1989 年'],1,'1969 年阿波羅 11 號完成首次載人登月。'],
 ['history','choice','下列哪位是唐代詩人？','',['蘇軾','李白','曹雪芹','關漢卿'],1,'李白是盛唐代表詩人；蘇軾屬宋代，曹雪芹屬清代，關漢卿屬元代。'],
 ['history','choice','古埃及金字塔最主要與什麼用途有關？','',['天文台','法老的陵墓','戲院','糧食交易所'],1,'許多著名金字塔是古埃及王室墓葬建築。'],
 ['history','choice','印刷術中的活字印刷早期重要發展者是？','',['畢昇','蔡倫','張衡','祖沖之'],0,'北宋畢昇以泥活字印刷著稱，記載見於《夢溪筆談》。'],
 ['history','choice','下列哪座城市曾是東羅馬帝國的首都？','',['君士坦丁堡','巴黎','馬德里','倫敦'],0,'君士坦丁堡在公元 330 年成為羅馬帝國重要都城，後為東羅馬帝國首都。'],
 ['riddle','choice','一年當中，哪個月份有 28 天？','',['只有 2 月','只有 4 月','每一個月份','只有閏年 2 月'],2,'所有月份都有至少 28 天。'],
 ['riddle','choice','桌上有三個蘋果，你拿走兩個，現在你有幾個？','',['1 個','2 個','3 個','0 個'],1,'你拿走了兩個，所以你有兩個。'],
 ['riddle','choice','一公斤棉花和一公斤鐵，哪個比較重？','',['棉花','鐵','一樣重','看天氣'],2,'兩者都是一公斤，質量相同。'],
 ['riddle','choice','電動火車向北行駛，煙往哪裡飄？','',['北方','南方','西方','沒有煙'],3,'一般電動火車沒有靠燃燒煤炭產生的排煙。'],
 ['riddle','choice','什麼東西越洗，自己反而越髒？','',['清潔用的水','冰塊','鏡子','空氣'],0,'清洗髒東西時，水會帶走污垢而變髒。'],
 ['riddle','choice','小明的爸爸有三個孩子：大寶、二寶，第三個是誰？','',['三寶','小明','寶寶','無法知道'],1,'題目第一句就說「小明的爸爸」。'],
];
const bank=BANK.map((r,i)=>({id:'q'+i,topic:r[0],type:r[1],question:r[2],tag:r[3],options:r[4],answerIndex:r[5],explanation:r[6],source_url:'',source_title:''}));
const localDefault=()=>({players:[{id:'a',name:'我',score:0},{id:'b',name:'TA',score:0}],current:null,history:[],round:1,updatedAt:Date.now()});
function safeJson(k,fallback){try{return JSON.parse(localStorage.getItem(k))||fallback}catch{return fallback}}
let demo=safeJson(SAVE_KEY,localDefault()),session=safeJson(SESSION_KEY,null),online=null,mode=session?'online':'demo',viewer=storeGet('whyus-viewer')||'a';
let tab='play',topic='couple',editorMode='bank',draft=null,difficulty='light',aiBusy=false,aiLive=false,connected=false,poll=null,modalKind=null;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
function setTab(next){tab=next;$$('.tab').forEach(b=>{const a=b.dataset.tab===tab;b.classList.toggle('active',a);b.setAttribute('aria-selected',String(a))});$$('.pane').forEach(p=>p.classList.toggle('active',p.id===tab+'-pane'));if(tab==='create')renderEditor();if(tab==='diary')renderDiary();window.scrollTo({top:Math.min(window.scrollY,520),behavior:'smooth'})}
function renderHeader(){const r=room(),a=r.players?.[0],b=r.players?.[1];$('#name-a').textContent=a?.name||'等待加入';$('#name-b').textContent=b?.name||'等待加入';$('#avatar-a').textContent=(a?.name||'我').slice(0,2);$('#avatar-b').textContent=(b?.name||'TA').slice(0,2);$('#score-name-a').textContent=a?.name||'我';$('#score-name-b').textContent=b?.name||'TA';$('#score-a').textContent=a?.score||0;$('#score-b').textContent=b?.score||0;let total=(a?.score||0)+(b?.score||0);$('#score-progress').style.width=(total?Math.max(7,Math.round((a?.score||0)/total*100)):50)+'%';$('#score-caption').textContent=total?'繼續出題，看看還會發現什麼':'第一個挑戰即將開始';$('#pair-state').textContent=mode==='online'? (r.players?.length===2?'你們已經連線，可以輪流出題':'等待另一半加入房間…') : ('目前由 '+player(me()).name+' 操作 · 可切換角色');$('#switch-person').style.display=mode==='online'?'none':'inline-flex';$('#switch-person').textContent='切換玩家 ↔'}
function renderCats(){const wrap=$('#category-grid');wrap.innerHTML=CATS.map(c=>`<button class="category-card ${topic===c.id?'selected':''}" data-topic="${c.id}" aria-label="選擇${escape(c.name)}"><span class="cat-asterisk">✧</span><span class="cat-icon" style="--c:${c.color}">${c.emoji}</span><b>${escape(c.name)}</b><small>${escape(c.sub)}</small></button>`).join('')}
function resultContent(q){if(q.type==='open')return `<div class="result-panel"><span class="result-tag">💭 完成簡答 · +5 星</span><h3>看看彼此的答案吧 ♡</h3><p><b>${escape(player(q.answerBy).name)}的回答：</b>${escape(q.answerText||'已回覆')}</p>${q.referenceAnswer?`<p class="reference-answer"><b>出題者的參考答案：</b>${escape(q.referenceAnswer)}</p>`:''}<p>${escape(q.explanation||'答案沒有自動判對錯，先聊聊你們的想法吧。')}</p></div>`;return `<div class="result-panel ${q.isCorrect?'correct':'wrong'}"><span class="result-tag">${q.isCorrect?'✦ 回答正確 · +10 星星':'✧ 差一點點 · 下次再挑戰'}</span><h3>${q.isCorrect?'好厲害！這顆知識星星是你的。':'猜錯也沒關係，收下今天的新知識！'}</h3><p><b>正確答案：</b>${escape(q.options[q.answerIndex]||'')}</p><p>${escape(q.explanation||'')}</p>${q.source_url?`<a class="source-link" target="_blank" rel="noopener noreferrer" href="${escape(q.source_url)}">查看相關資料來源 ↗</a>`:''}</div>`}
function renderPlay(){const r=room(),q=r.current,who=me();$('#turn-tag').textContent=q?(q.answered?'已揭曉答案':q.createdBy===who?'已寄出 · 等待 TA':'輪到你回答'):'等待第一道題';const box=$('#game-content');
 if(!q){box.innerHTML=`<div class="empty-stage"><div><span class="tiny-label">HELLO, CURIOUS HEART</span><h3>第一道問題，<br>由你發射！ ✦</h3><p>可以問「如果我們交換一天的生活？」也可以出一題章魚有幾顆心的冷知識。</p><button class="button primary stage-button" data-stage="create">✎ 去出題工坊 <span>↗</span></button></div><div class="empty-stage-art">?</div></div>`;return}
 let meta=`<div class="question-head"><span class="posted-by"><span>${cat(q.topic).emoji}</span> ${escape(cat(q.topic).name)} · ${escape(player(q.createdBy).name)} 出題 · 第 ${r.round||1} 回合 ${q.origin==='ai'?'· ✨ AI 協助':''}</span></div>`;
 if(!q.answered&&q.createdBy===who){box.innerHTML=meta+`<div class="waiting-stage"><span class="waiting-symbol">💌</span><h3>問題已寄出，等待 TA 的答案。</h3><p>「${escape(q.question)}」<br>${mode==='demo'?'請切換到另一位玩家來回答。':'另一半打開同一間房間，就會收到問題。'}</p><button class="button ${mode==='demo'?'primary':'subtle'}" data-stage="${mode==='demo'?'switch':'invite'}">${mode==='demo'?'切換成 TA 來回答 ↔':'分享房間邀請 ↗'}</button></div>`;return}
 let body=`${meta}<div class="question-body"><h3>${escape(q.question)}</h3>${q.tag?`<p class="context">${escape(q.tag)}</p>`:''}</div>`;
 if(!q.answered){if(q.type==='open'){body+=`<div class="answer-open"><p>請直接輸入你的回答，不需要選擇選項。</p><textarea class="free-answer" id="open-response" maxlength="1000" placeholder="把你的答案寫在這裡……"></textarea></div><div class="answer-bar"><small>送出後，才能看到對方的參考答案 ♡</small><button class="button primary" data-stage="open-answer">送出答案 ↗</button></div>`}else{body+=`<div class="answer-choices">${q.options.map((opt,i)=>`<button class="answer-option" data-answer="${i}"><span class="letter-tag">${'ABCD'[i]}</span>${escape(opt)}</button>`).join('')}</div><div class="answer-bar"><small>偷偷想一下，再選你的答案。</small></div>`}}
 else{body+=resultContent(q)+`<div class="answer-bar"><small>${escape(player(q.answerBy).name)} 已回答</small><button class="button primary" data-stage="next">繼續下一題 ↗</button></div>`}
 box.innerHTML=body;
}
function renderDiary(){const r=room(),arr=r.history||[];$('#history-count').textContent=arr.length+' 次對話';$('#stat-questions').textContent=arr.length;$('#stat-stars').textContent=(r.players||[]).reduce((n,p)=>n+(p.score||0),0)+' ✦';const counts={};arr.forEach(q=>counts[q.topic]=(counts[q.topic]||0)+1);const fav=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];$('#stat-topic').textContent=fav?cat(fav).name:'等待發現';$('#history-items').innerHTML=arr.length?[...arr].reverse().slice(0,25).map(q=>`<div class="history-item"><span class="hicon">${cat(q.topic).emoji}</span><div><h4>${escape(q.question)}</h4><p>${escape(player(q.createdBy).name)} 問 · ${escape(player(q.answerBy).name)} 答 ${q.type==='open'?'· 💭 想法交換':q.isCorrect?'· ✦ 正確':'· ✧ 學到新知'} ${q.type==='open'?'':'· 正確答案：'+escape(q.options[q.answerIndex])}</p></div></div>`).join(''):`<div class="no-history"><div><span>☄️</span><p>你們的第一段問答，<br>還在飛來的路上。</p></div></div>`}
function newDraft(q){draft=JSON.parse(JSON.stringify(q));if(!draft.id)draft.id='draft'+Date.now();if(!draft.tag)draft.tag='';if(!draft.source_url)draft.source_url='';if(!draft.source_title)draft.source_title=''}
function selectBank(){const items=bank.filter(q=>q.topic===topic);if(!items.length){draft=null;return}const last=draft?.id;const avail=items.filter(q=>q.id!==last);newDraft(avail[Math.floor(Math.random()*avail.length)]||items[0]);}
function renderPreview(q){if(!q)return '';return `<div class="bank-question"><span class="tiny-label">${escape(cat(q.topic).name)} · ${q.type==='open'?'簡答題':'四選一'}</span><h4>${escape(q.question)}</h4>${q.type==='choice'?`<div class="preview-options">${q.options.map((o,i)=>`<span class="${i===q.answerIndex?'correct':''}">${'ABCD'[i]}. ${escape(o)} ${i===q.answerIndex?'✓':''}</span>`).join('')}</div>`:'<p class="question-source">由 TA 自由作答，不需要選項。</p>'}<p class="question-source">${escape(q.explanation||'')}</p>${q.origin==='ai'?`<p class="question-source">${q.source_url?'來源：'+escape(q.source_title||q.source_url):'AI 生成內容，請先核對事實，再寄出。'}</p>`:''}</div>`}
function renderEditor(){const body=$('#editor-content');$$('.mode-pill').forEach(b=>b.classList.toggle('active',b.dataset.mode===editorMode));if(editorMode==='bank'){
 if(!draft||draft.topic!==topic||draft.origin==='ai')selectBank();
 body.innerHTML=`<div class="studio-editor"><h3>${topic==='news'?'當下熱點，先連接 AI':'抽一張好奇心卡片'}</h3><p class="lead">${topic==='news'?'時事題目必須使用最新、可查證的來源，不提供過期的預設新聞題。':'每張卡片都可以直接發給另一半；你也可以重新抽一題。'}</p>${topic==='news'?`<div class="ai-warning">🌏 「當下熱點」需要線上 AI 與網路檢索。請切換「AI 幫我想」，不要把舊新聞當成今天的題目。</div><div class="studio-actions"><button class="button primary" data-editor="go-ai">✨ 前往 AI 出題 ↗</button></div>`:`${renderPreview(draft)}<div class="studio-actions"><button class="button subtle" data-editor="shuffle">↻ 換一題</button><button class="button primary" data-editor="send">💌 寄給 TA <span>↗</span></button></div>`}</div>`;
 }else if(editorMode==='custom'){
 body.innerHTML=`<div class="studio-editor"><h3>寫一道想問 TA 的問題。</h3><p class="lead">不用出選項。你只要寫問題，TA 就可以直接輸入答案；參考答案可留空。</p><div class="field"><label for="custom-question">你想問的問題 *</label><textarea maxlength="300" id="custom-question" placeholder="例如：我們第一次在灣仔吃飯，你點了什麼？">${escape(draft?.origin==='custom'?draft.question:'')}</textarea></div><div class="field"><label for="custom-reference">你的參考答案（可選）</label><textarea id="custom-reference" maxlength="300" placeholder="例如：冬陰功。這個答案會在 TA 回答後才公開。">${escape(draft?.origin==='custom'?(draft.referenceAnswer||''):'')}</textarea></div><div class="field"><label for="custom-explain">想對 TA 說的話（可選）</label><textarea id="custom-explain" maxlength="400" placeholder="回答完才會顯示，例如：那是我們第一次一起吃飯。">${escape(draft?.origin==='custom'?(draft.explanation||''):'')}</textarea></div><div class="studio-actions"><button class="button primary" data-editor="custom-send">把這題寄給 TA ↗</button></div><p class="custom-footnote">✦ 簡答題不自動判斷對錯。完成作答可得 5 顆星，適合情侶聊天，也可以考知識。</p></div>`;
 }else{
 body.innerHTML=`<div class="studio-editor"><h3>把出題交給 AI ✨</h3><p class="lead">選擇領域與難度，由 AI 產生可編輯的題目。涉及當下新聞時，將嘗試搜尋近期資料與來源。</p><div class="fields-2"><div class="field"><label for="ai-topic">出題領域</label><select id="ai-topic">${CATS.map(c=>`<option value="${c.id}" ${c.id===topic?'selected':''}>${escape(c.name)}</option>`).join('')}</select></div><div class="field"><label for="ai-tone">難度</label><select id="ai-tone"><option value="light" ${difficulty==='light'?'selected':''}>輕鬆 · 日常都能答</option><option value="medium" ${difficulty==='medium'?'selected':''}>普通 · 要動點腦</option><option value="hard" ${difficulty==='hard'?'selected':''}>困難 · 給高手</option></select></div></div><div class="field"><label for="ai-keywords">想融入的元素（可選）</label><input id="ai-keywords" maxlength="150" placeholder="例如：天文、香港歷史、貓咪、搞笑情侶日常" /></div><div class="ai-warning">${mode==='online'?(aiLive?'✨ 這間房間已連接 AI 服務。':'⚠️ 此伺服器尚未設定 API 金鑰，會以精選題庫示範出題。'):'🪐 未連接線上房間時使用題庫示範；AI 需在 Netlify 伺服器設定 API 金鑰。'}當下新聞必須使用有來源的線上搜尋。</div><div class="studio-actions"><button class="button primary" data-editor="ai-generate" ${aiBusy?'disabled':''}>${aiBusy?'<span class="ai-spinner"></span> 正在準備題目':'✨ 幫我生成一題 ↗'}</button></div>${draft?.origin==='ai'||draft?.origin==='demo-ai'?renderPreview(draft)+`<div class="studio-actions"><button class="button primary" data-editor="send">確認後寄給 TA ↗</button></div>`:''}</div>`;
 }
}
async function createQuestion(q){if(room().current){notify('先完成現在這一道題，再寄出下一題喔。');setTab('play');return}if(mode==='online'&&room().players.length<2){notify('請先邀請另一半加入，才能開始雙人出題。');showConnection();return}try{if(mode==='online'){await callApi(`/api/rooms/${encodeURIComponent(session.room)}/question`,{method:'POST',body:q,auth:true});await refreshOnline()}else{demo.current={...q,id:'sent'+Date.now(),createdBy:viewer,answered:false,answerBy:null,answerText:null,createdAt:Date.now()};demo.updatedAt=Date.now();saveDemo()}beep('send');notify('問題寄出成功！✉');setTab('play');renderAll()}catch(e){notify(e.message||'寄題失敗')}}
function grabCustom(){const question=$('#custom-question')?.value.trim();if(!question||question.length<2){notify('請先寫一道問題（至少 2 個字）。');$('#custom-question')?.focus();return null}return {topic,type:'open',question,options:[],answerIndex:0,referenceAnswer:$('#custom-reference')?.value.trim()||'',explanation:$('#custom-explain')?.value.trim()||'',source_url:'',source_title:'',tag:'',origin:'custom'}}
async function answerCurrent(value){const q=room().current;if(!q||q.answered||q.createdBy===me())return;try{if(mode==='online'){await callApi(`/api/rooms/${encodeURIComponent(session.room)}/answer`,{method:'POST',body:q.type==='open'?{text:String(value)}:{answerIndex:Number(value)},auth:true});await refreshOnline()}else{q.answered=true;q.answerBy=viewer;if(q.type==='open'){q.answerText=String(value);player(viewer).score+=5;q.isCorrect=null}else{q.selectedIndex=Number(value);q.isCorrect=q.selectedIndex===q.answerIndex;if(q.isCorrect)player(viewer).score+=10}demo.updatedAt=Date.now();saveDemo()}beep(room().current?.isCorrect===false?'wrong':'win');if(room().current?.isCorrect)burst();renderAll()}catch(e){notify(e.message||'提交失敗')}}
async function nextRound(){if(!room().current?.answered)return;try{if(mode==='online'){await callApi(`/api/rooms/${encodeURIComponent(session.room)}/next`,{method:'POST',body:{},auth:true});await refreshOnline()}else{demo.history.push({...demo.current});demo.current=null;demo.round++;demo.updatedAt=Date.now();saveDemo()}beep('tap');renderAll()}catch(e){notify(e.message||'無法繼續')}}
async function callApi(url,{method='GET',body,auth=false}={}){
 if(location.protocol==='file:')throw Error('單檔 HTML 不支援異地連線。請在已部署的 HTTPS 網址建立房間。');
 const opts={method,headers:{'Accept':'application/json','Content-Type':'application/json'}};
 if(auth&&session?.token)opts.headers.Authorization='Bearer '+session.token;
 if(body!==undefined)opts.body=JSON.stringify(body);
 const ctl=new AbortController();opts.signal=ctl.signal;const id=setTimeout(()=>ctl.abort(),22000);
 try{
  const r=await fetch(url,opts);
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

async function refreshOnline(){if(!session)return;try{const result=await callApi(`/api/rooms/${encodeURIComponent(session.room)}`,{auth:true});online=result.room;connected=true;aiLive=!!result.aiEnabled;renderAll()}catch(e){connected=false;renderHeader();if(/不存在|權限|token|有效/i.test(e.message)){notify('房間驗證失效，已切回本機模式。');leaveOnline()}}}
function startPolling(){clearInterval(poll);poll=setInterval(()=>{if(mode==='online'&&session)refreshOnline()},2200)}
function leaveOnline(){clearInterval(poll);mode='demo';session=null;online=null;connected=false;aiLive=false;saveSession();renderAll()}
function connectRoom(s,data){session={room:data.code,playerId:data.playerId,token:data.token};saveSession();mode='online';connected=true;online=data.room;aiLive=!!data.aiEnabled;startPolling();hideDialog();beep('win');renderAll()}
function dialog(html){$('#dialog').innerHTML=`<button class="x" id="close-dialog" aria-label="關閉">×</button>${html}`;$('#modal-backdrop').classList.remove('hidden');$('#close-dialog').onclick=hideDialog}
function hideDialog(){$('#modal-backdrop').classList.add('hidden');modalKind=null}
function showConnection(){modalKind='connect';const r=room();const params=new URLSearchParams(location.search);const link=mode==='online'?location.origin+location.pathname+'?room='+encodeURIComponent(session.room):'';dialog(`<div class="modal-icon">🪐</div><span class="eyebrow dark">DISTANCE? NO PROBLEM.</span><h2>邀請 TA，來你的星球玩。</h2><p>部署完成後，建立專屬房間，複製邀請連結給 TA；兩部手機就能跨城市互相出題。</p>${mode==='online'?`<div class="room-code">${escape(session.room)}</div><div class="invite-box">房間邀請網址：<br>${escape(link)}</div><div class="dialog-buttons"><button class="button primary" data-dialog="copy">複製邀請連結 ↗</button><button class="button subtle" data-dialog="leave">離開線上房間</button></div><p class="tip">已連線：${escape(r.players.map(x=>x.name).join('、'))}。房間碼相當於入場券，請只分享給信任的人。</p>`:`<div class="field"><label for="local-a">玩家 1</label><input id="local-a" maxlength="16" value="${escape(demo.players[0].name)}" /></div><div class="field"><label for="local-b">玩家 2</label><input id="local-b" maxlength="16" value="${escape(demo.players[1].name)}" /></div><button class="button subtle full-width" data-dialog="save-names">儲存暱稱</button><div class="separator">或使用雙人連線</div><p id="connect-status" class="tip" role="status">檢查中…</p><div class="field"><label for="room-name">你的暱稱</label><input id="room-name" maxlength="16" placeholder="例如：豆包" /></div><div class="dialog-buttons"><button class="button primary" data-dialog="create">建立雙人房間</button><button class="button ghost" data-dialog="join-form">輸入房間碼加入</button></div><p class="tip">線上房間由 Netlify Functions 與 Supabase 儲存。若顯示未連線，請確認已部署網站並設定環境變數。</p>`}`);if(mode!=='online')checkRoomService()}
function showJoin(){modalKind='join';const code=new URLSearchParams(location.search).get('room')||'';dialog(`<div class="modal-icon">💌</div><span class="eyebrow dark">JOIN THE UNIVERSE</span><h2>收到 TA 的邀請了嗎？</h2><p>輸入房間碼和暱稱，就能在兩部手機同步問答。</p><div class="field"><label for="join-code">房間碼</label><input id="join-code" maxlength="12" autocapitalize="characters" value="${escape(code)}" placeholder="例如：7KQ4M2TY" /></div><div class="field"><label for="join-name">你的暱稱</label><input id="join-name" maxlength="16" placeholder="例如：原寶" /></div><p id="connect-status" class="tip" role="status">檢查中…</p><div class="dialog-buttons"><button class="button primary full-width" data-dialog="join">加入房間 ↗</button></div><div class="tip">請使用 Netlify 正式網站網址。房間邀請碼請只分享給另一半。</div>`);checkRoomService()}
function showInfo(){modalKind='info';dialog(`<div class="modal-icon">✳</div><h2>怎樣一起玩？</h2><p>① 一方出題，另一方作答。答對知識題獲得 10 顆星；開放題分享想法得到 5 顆星。<br>② 選擇「關於我們、科普、歷史、十萬個為什麼、腦筋急轉彎」等領域。<br>③ 同一台手機可切換玩家；兩部手機互動時，請建立並分享線上房間。<br>④ AI 出題需要在伺服器設定金鑰；「當下熱點」會使用網路檢索，不會拿舊資訊冒充今日新聞。<br>⑤ 答案、解說與戰績會留在你們的房間；這是原型版本，正式部署前需要更完善的帳號和隱私控制。</p><div class="dialog-buttons"><button class="button primary full-width" data-dialog="close">我知道啦 ♡</button></div>`)}
async function copyLink(){const url=location.origin+location.pathname+'?room='+encodeURIComponent(session.room);try{await navigator.clipboard.writeText(url);notify('邀請連結已複製！')}catch{window.prompt('請複製這個邀請連結：',url)}}
function renderAll(){renderHeader();renderCats();renderPlay();renderDiary();$('#today-date').textContent=new Date().toLocaleDateString('zh-Hant',{month:'short',day:'numeric'})+' · TODAY';$('#daily-question').textContent=todayQuestion().question}
function setMode(m){editorMode=m;draft=null;renderEditor()}
function setTopic(t){topic=t;draft=null;renderCats();if(editorMode==='ai'||editorMode==='bank')renderEditor();beep()}
function init(){renderAll();setTab('play');$$('.tab').forEach(b=>b.addEventListener('click',()=>{beep();setTab(b.dataset.tab)}));$('#hero-start').onclick=()=>setTab('create');$('#hero-join').onclick=showConnection;$('#info-btn').onclick=showInfo;$('#switch-person').onclick=()=>{viewer=viewer==='a'?'b':'a';storeSet('whyus-viewer',viewer);beep();renderAll()};$('#category-grid').addEventListener('click',e=>{const b=e.target.closest('[data-topic]');if(!b)return;setTopic(b.dataset.topic);setTab('create')});$('#use-daily').onclick=()=>{topic='couple';setTab('create');editorMode='bank';newDraft(todayQuestion());renderEditor()};$('#new-round').onclick=()=>setTab('create');$('.mode-pills').onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;beep();setMode(b.dataset.mode)};
 $('#game-content').addEventListener('click',async e=>{const answer=e.target.closest('[data-answer]');if(answer){await answerCurrent(Number(answer.dataset.answer));return}const a=e.target.closest('[data-stage]');if(!a)return;switch(a.dataset.stage){case 'create':setTab('create');break;case 'switch':$('#switch-person').click();break;case 'invite':showConnection();break;case 'open-answer':{const text=$('#open-response')?.value.trim();if(!text)return notify('請先輸入你的答案。');await answerCurrent(text);break}case 'next':await nextRound();break}});
 $('#editor-content').addEventListener('change',e=>{if(e.target.id==='ai-topic'){setTopic(e.target.value)}if(e.target.id==='ai-tone'){difficulty=e.target.value}});
 $('#editor-content').addEventListener('click',async e=>{const a=e.target.closest('[data-editor]');if(!a)return;const action=a.dataset.editor;if(action==='shuffle'){selectBank();renderEditor();beep();return}if(action==='send'){if(!draft){notify('請先抽一道題或生成題目。');return;}await createQuestion({...draft,origin:draft.origin||'bank'});return}if(action==='custom-send'){const q=grabCustom();if(q){newDraft(q);await createQuestion(q)}return}if(action==='go-ai'){setMode('ai');return}if(action==='ai-generate'){await generateAI();return}});
 $('#modal-backdrop').addEventListener('click',e=>{if(e.target.id==='modal-backdrop')hideDialog()});$('#dialog').addEventListener('click',async e=>{const a=e.target.closest('[data-dialog]');if(!a)return;const action=a.dataset.dialog;try{if(action==='close'){hideDialog();return}if(action==='save-names'){demo.players[0].name=$('#local-a').value.trim().slice(0,16)||'我';demo.players[1].name=$('#local-b').value.trim().slice(0,16)||'TA';saveDemo();renderAll();hideDialog();notify('暱稱已更新');return}if(action==='create'){const health=await callApi('/api/health');if(!health.onlineReady)throw Error('Supabase 尚未準備好，請先完成環境變數設定');const name=$('#room-name').value.trim()||'我';const v=await callApi('/api/rooms',{method:'POST',body:{name}});connectRoom(null,v);showConnection();return}if(action==='join-form'){showJoin();return}if(action==='join'){const code=$('#join-code').value.trim().toUpperCase(),name=$('#join-name').value.trim()||'TA';if(!code)return notify('請填入房間碼');const v=await callApi('/api/rooms/'+encodeURIComponent(code)+'/join',{method:'POST',body:{name}});connectRoom(null,v);showConnection();return}if(action==='copy'){await copyLink();return}if(action==='leave'){leaveOnline();hideDialog();notify('已切回單機輪流模式');return}}catch(err){notify(err.message||'連線失敗，請確認伺服器正在運行')}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal-backdrop').classList.contains('hidden'))hideDialog()});
 if(session&&location.protocol==='file:'){leaveOnline();notify('單檔網頁無法連上原來的房間，已改為單機輪流模式。')}else if(session){refreshOnline().then(()=>startPolling())}else if(new URLSearchParams(location.search).has('room')){showJoin()}
}
async function generateAI(){if(aiBusy)return;const t=$('#ai-topic')?.value||topic,level=$('#ai-tone')?.value||difficulty,keywords=$('#ai-keywords')?.value.trim()||'';topic=t;difficulty=level;if(mode!=='online'||!aiLive){if(t==='news'){notify('最新時事需要連接已設定 AI 的伺服器。請先用其他領域抽題，或部署雙人服務。');return}const list=bank.filter(q=>q.topic===t);if(!list.length){notify('這個類別暫時沒有離線示例題');return}newDraft({...list[Math.floor(Math.random()*list.length)],origin:'demo-ai'});renderEditor();notify('目前顯示題庫示範，尚未連接 AI');return}aiBusy=true;renderEditor();try{const response=await callApi('/api/ai',{method:'POST',body:{room:session.room,topic:t,level,keywords},auth:true});newDraft({...response.question,topic:t,origin:'ai'});beep('win');notify('AI 題目準備好了！請先核對，再寄給 TA。')}catch(e){notify(e.message||'AI 出題失敗')}finally{aiBusy=false;renderEditor()}}
init();
})();
