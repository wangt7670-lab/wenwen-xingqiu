import { escape } from './studio.js';
import { abilities, formats } from './v5-fields.js';

const statusLabel={new:'新增',duplicate:'重複',error:'錯誤'};
const counts=result=>`新增 ${result.added} 筆 · 重複 ${result.duplicates} 筆 · 錯誤 ${result.errors} 筆`;

export function saveDownload(blob,filename) {
  const url=URL.createObjectURL(blob);
  const link=Object.assign(document.createElement('a'),{href:url,download:filename});
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export async function openAdmin(root,kind,call,refresh) {
  const endpoint=`/${kind}`;
  const {fields,required}=formats[kind];
  let preview=null,file=null;
  root.innerHTML=`<h2>Excel 題庫</h2><div class="v5-tools">
    <a class="button ghost" href="./templates/v5-${kind}.xlsx" download>下載 Excel 模板</a>
    <button class="button ghost" type="button" data-export>匯出 Excel 備份</button></div>
    <form data-preview><div class="field"><label for="v5-workbook">Excel 題庫（.xlsx，最多 500 筆）</label><input id="v5-workbook" accept=".xlsx" type="file" required></div><button class="button primary">預覽導入</button></form>
    <p data-admin-status role="status"></p><div data-preview-result></div><h3>已發布題庫</h3><div data-current></div>`;
  const status=root.querySelector('[data-admin-status]');
  const result=root.querySelector('[data-preview-result]');
  const input=root.querySelector('#v5-workbook');
  const current=root.querySelector('[data-current]');
  const stillOpen=()=>root.contains(input);
  function report(message){if(stillOpen())status.textContent=message;}
  function bindAction(element,handler,eventName='click') {
    element.addEventListener(eventName,async event=>{
      event.preventDefault();
      if(element.dataset.busy)return;
      element.dataset.busy='1';
      if(element instanceof HTMLButtonElement)element.disabled=true;
      try{await handler(event);}catch(error){report(error.message);}
      finally{delete element.dataset.busy;if(element instanceof HTMLButtonElement)element.disabled=false;}
    });
  }
  async function loadCatalog() {
    const catalog=await call(`${endpoint}/catalog`);
    if(!stillOpen())return;
    current.innerHTML=catalog.length?catalog.map(item=>`<details class="v5-edit"><summary>${escape(item.content.prompt)} · ${item.status==='active'?'啟用':'停用'}</summary>
      <form data-id="${escape(item.id)}">${Object.entries(fields).map(([name,label])=>{
        const value=item.content[name]??'';
        const must=required.includes(name)?'required':'';
        let control;
        if(name==='ability')control=`<select name="ability" required>${abilities.map(ability=>`<option ${ability===value?'selected':''}>${ability}</option>`).join('')}</select>`;
        else if(['sequence','seconds'].includes(name))control=`<input name="${name}" type="number" min="1" max="${name==='sequence'?999999:3600}" value="${escape(value)}">`;
        else control=`<textarea name="${name}" rows="2" ${must}>${escape(value)}</textarea>`;
        return `<label class="field">${escape(label)}${control}</label>`;
      }).join('')}<div class="v5-tools"><button class="button primary">儲存</button><button type="button" class="button subtle" data-state="${item.status==='active'?'disabled':'active'}">${item.status==='active'?'停用':'啟用'}</button><button type="button" class="button danger" data-state="deleted">刪除</button></div></form></details>`).join(''):'<p>先上傳 Excel，就可以在這裡管理題目。</p>';
    for(const form of current.querySelectorAll('form')) {
      const item=catalog.find(entry=>entry.id===form.dataset.id);
      const edit=async (action,content)=>{
        if(!stillOpen())return;
        await call('/edit',{json:{id:item.id,version:item.version,action,content}});
        report('題庫已更新。');
        await Promise.all([loadCatalog(),refresh()]);
      };
      bindAction(form,()=>edit('edit',Object.fromEntries(new FormData(form))),'submit');
      for(const button of form.querySelectorAll('[data-state]')) bindAction(button,async()=>{
        const state=button.dataset.state;
        if(state==='deleted'&&!window.confirm('從題庫移除這道題嗎？已送出的互動會保存在紀錄。'))return;
        await edit(state);
      });
    }
  }
  function showPreview(data,unpublished) {
    result.innerHTML=`<p><strong>${counts(data)}</strong></p><div class="v5-scroll"><table class="v5-table"><thead><tr><th>列</th>${Object.values(fields).map(field=>`<th>${escape(field)}</th>`).join('')}<th>結果</th></tr></thead>
      <tbody>${data.rows.map(row=>`<tr><td>${escape(row.row)}</td>${Object.keys(fields).map(field=>`<td>${escape(row.content?.[field]??'')}</td>`).join('')}<td>${statusLabel[row.status]}${row.note?` · ${escape(row.note)}`:''}</td></tr>`).join('')}</tbody></table></div>
      ${unpublished&&data.added?`<p><button class="button primary" data-publish type="button">發布 ${data.added} 筆新增</button></p>`:''}`;
  }
  const upload=(action,selected,digest)=>call(`${endpoint}/${action}`,{body:selected,headers:{
    'content-type':'application/octet-stream','x-v5-filename':encodeURIComponent(selected.name.replace(/[^.]+(?=\.xlsx$)/i,'workbook')),
    ...(digest?{'x-v5-preview':digest}:{})}});
  input.addEventListener('change',()=>{preview=null;file=null;result.replaceChildren();report('');});
  bindAction(root.querySelector('[data-preview]'),async()=>{
    const selected=input.files[0];
    if(!selected||!selected.name.toLowerCase().endsWith('.xlsx')||selected.size>2*1024*1024)throw Error('請選擇 2 MiB 以內的 .xlsx。');
    const data=await upload('preview',selected);
    if(!stillOpen()||input.files[0]!==selected)return;
    preview=data;file=selected;
    showPreview(data,true);
    report(data.rows.length?'請確認預覽後再發布。':'工作表目前沒有題目。');
    const publish=result.querySelector('[data-publish]');
    if(publish)bindAction(publish,async()=>{
      if(!preview||input.files[0]!==file)throw Error('檔案已更換，請重新預覽。');
      const published=await upload('publish',file,preview.digest);
      if(!stillOpen())return;
      preview=null;
      showPreview(published,false);
      report('題庫已同步。'+counts(published));
      await Promise.all([loadCatalog(),refresh()]);
    });
  },'submit');
  bindAction(root.querySelector('[data-export]'),async()=>saveDownload(await call(`${endpoint}/export`,{blob:true}),`wenwen-${kind}-backup.xlsx`));
  try{await loadCatalog();}catch(error){report(error.message);}
}
