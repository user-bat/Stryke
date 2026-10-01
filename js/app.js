/* Stryke — логика приложения */
(() => {
"use strict";

const {P,BY,REASONS,RN,SECTORS,STAGES,FEEDS,VIEWS,DTABS} = window.STRYKE;

/* ================= STATE ================= */
const LS = {
  get(k,d){try{const v=localStorage.getItem("stryke:"+k);return v?JSON.parse(v):d}catch(e){return d}},
  set(k,v){try{localStorage.setItem("stryke:"+k,JSON.stringify(v))}catch(e){}}
};
let me = normMe(LS.get("me",null));
let uid = null, ref = null, mode = "local"; // local | live | mine-local
let people = new Map(); // uid -> doc (others)
let names = {}; let userCap = null; let myName = "";
let touched = false;
const saved = new Set(LS.get("saved",[]));
const ui = Object.assign({view:"feed",feed:"foryou",sector:"all",stage:"all"}, LS.get("ui",{}));
const open = {};      // pid -> details tab
const whyOpen = {};   // pid -> bool
const draft = {};     // pid -> reasons set while editing
const discOpen = {};  // pid -> bool
let agg = {};

function normMe(d){d=d&&typeof d==="object"?d:{};return {preds:Object.assign({},d.preds||{}),cm:Object.assign({},d.cm||{})}}
const clone = o => JSON.parse(JSON.stringify(o));

function recompute(){
  agg = {};
  P.forEach(p=>agg[p.id]={y:0,n:0,ry:{},rn:{},c:[]});
  const all = new Map(people); all.set(uid||"me", me);
  for (const [id,d] of all){
    const preds = d&&d.preds||{};
    for (const pid in preds){
      const a=agg[pid]; const pr=preds[pid]; if(!a||!pr) continue;
      if(pr.v==="y") a.y++; else if(pr.v==="n") a.n++; else continue;
      const bucket = pr.v==="y"?a.ry:a.rn;
      (Array.isArray(pr.r)?pr.r:[]).forEach(r=>{if(RN[r]) bucket[r]=(bucket[r]||0)+1});
    }
    const cm = d&&d.cm||{};
    for (const pid in cm){
      const a=agg[pid]; if(!a||!Array.isArray(cm[pid])) continue;
      cm[pid].forEach(c=>{ if(c&&typeof c.text==="string") a.c.push({uid:id,id:c.id,text:c.text.slice(0,1000),t:+c.t||0,v:preds[pid]&&preds[pid].v,r:preds[pid]&&preds[pid].r||[]}) });
    }
  }
  P.forEach(p=>agg[p.id].c.sort((a,b)=>b.t-a.t));
}

/* ================= HELPERS ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function plural(n,f){const a=Math.abs(n)%100,b=a%10;return n+" "+(a>10&&a<20?f[2]:b>1&&b<5?f[1]:b===1?f[0]:f[2])}
const VOTES_F=["голос","голоса","голосов"], CM_F=["комментарий","комментария","комментариев"], PR_F=["прогноз","прогноза","прогнозов"];
function ago(t){const s=(Date.now()-t)/1000;if(s<60)return"только что";if(s<3600)return Math.floor(s/60)+" мин назад";if(s<86400)return Math.floor(s/3600)+" ч назад";if(s<86400*30)return Math.floor(s/86400)+" дн назад";return new Date(t).toLocaleDateString("ru-RU",{day:"numeric",month:"short"})}
function pct(a,b){const t=a+b;return t?Math.round(a/t*100):0}
function initials(n){return (n||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase()||"?"}
function nameOf(id){if(id===uid||id==="me")return"Ты";return names[id]||"Участник"}
let toastT; function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,2600)}
function hash(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0}

/* ================= PERSISTENCE ================= */
let saving=false, dirty=false, saveT;
function persist(){
  touched = true;
  if (mode!=="live"){ LS.set("me",me); recompute(); return; }
  LS.set("me",me);
  recompute();
  clearTimeout(saveT); saveT=setTimeout(flush,300);
}
async function flush(){
  dirty=true; if(saving) return; saving=true;
  while(dirty){
    dirty=false;
    try{ await ref.set(clone(me)); }
    catch(e){
      const code=e&&e.code;
      if(code==="invalid_argument"||code==="not_granted"||code==="revoked"){ setMode("mine-local"); break; }
      if(code==="unavailable"){ await new Promise(r=>setTimeout(r,600+Math.random()*900)); dirty=true; continue; }
      if(code==="quota_exceeded"){ toast("Хранилище заполнено, сохранить не удалось"); break; }
      toast("Не удалось сохранить, попробуй ещё раз"); break;
    }
  }
  saving=false;
}
function setMode(m){
  mode=m;
  const el=$("#mode");
  el.className="mode"+(m==="live"?" live":"");
  el.innerHTML="<b></b>"+(m==="live"?"Онлайн":"Локально");
  const b=$("#banner");
  if(m==="mine-local") b.innerHTML='<div class="banner">Ты видишь голоса сообщества, но твои прогнозы сохраняются только на этом устройстве. <strong>Чтобы голосовать вместе со всеми, попроси владельца дать доступ «Участник».</strong></div>';
  else b.innerHTML="";
}

/* ================= RENDER: CHROME ================= */
function renderChrome(){
  $("#tabs").innerHTML = FEEDS.map(([k,l])=>`<button class="tab" data-act="feed" data-k="${k}" aria-pressed="${ui.feed===k}">${l}</button>`).join("");
  $("#sectors").innerHTML = SECTORS.map(s=>`<button class="chip" data-act="sector" data-k="${esc(s)}" aria-pressed="${ui.sector===s}">${s==="all"?"Все":esc(s)}</button>`).join("");
  $("#stages").innerHTML = STAGES.map(s=>`<button class="chip" data-act="stage" data-k="${s}" aria-pressed="${ui.stage===s}">${s==="all"?"Любая стадия":s}</button>`).join("");
  const nav = VIEWS.map(([k,l,i])=>`<button data-act="view" data-k="${k}" ${ui.view===k?'aria-current="page"':""}><svg><use href="#${i}"/></svg>${l}</button>`).join("");
  $("#bnav").innerHTML=nav; $("#snav").innerHTML=nav;
  $("#filters").hidden = ui.view==="profile";
  $("#tabs").hidden = ui.view!=="feed";
}

/* ================= FEED ORDER ================= */
function list(){
  let arr = P.filter(p=>(ui.sector==="all"||p.tags.includes(ui.sector))&&(ui.stage==="all"||p.stage===ui.stage));
  if (ui.view==="saved") return arr.filter(p=>saved.has(p.id));
  const tot = p=>agg[p.id].y+agg[p.id].n;
  if (ui.feed==="foryou"){
    const aff={}; for(const pid in me.preds){BY[pid]&&BY[pid].tags.forEach(t=>aff[t]=(aff[t]||0)+1)}
    const seed = uid||"anon";
    arr.sort((a,b)=>{
      const va=!!me.preds[a.id], vb=!!me.preds[b.id]; if(va!==vb) return va-vb;
      const fa=a.tags.reduce((s,t)=>s+(aff[t]||0),0), fb=b.tags.reduce((s,t)=>s+(aff[t]||0),0);
      if(fa!==fb) return fb-fa;
      return hash(seed+a.id)-hash(seed+b.id);
    });
  } else if (ui.feed==="hot"){
    arr.sort((a,b)=>tot(b)-tot(a)||(agg[b.id].c.length-agg[a.id].c.length)||b.growth-a.growth);
  } else if (ui.feed==="split"){
    const sc=p=>{const t=tot(p);return t?Math.abs(agg[p.id].y-agg[p.id].n)/t - Math.min(t,20)/1000:2};
    arr.sort((a,b)=>sc(a)-sc(b)||b.growth-a.growth);
  } else {
    arr.sort((a,b)=>b.growth-a.growth);
  }
  return arr;
}

/* ================= CARD ================= */
function cardHTML(p){
  return `<article class="card" id="c-${p.id}" data-pid="${p.id}">
    <div class="hero"><img src="${p.img}" alt="" loading="lazy" decoding="async" width="460" height="168">
      <div class="hero-top"><div class="tags">${p.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}<span class="tag">${p.stage}</span></div>
      <button class="save" data-act="save" aria-pressed="${saved.has(p.id)}" aria-label="Сохранить"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 3h12v18l-6-4.5L6 21z"/></svg></button></div>
    </div>
    <div class="body">
      <h2 class="title">${esc(p.name)}</h2>
      <p class="short">${esc(p.short)}</p>
      <div class="metrics num">${p.m.map((x,i)=>`<div class="metric${i===2?" up":""}"><b>${x[0]}</b><span>${x[1]}</span></div>`).join("")}</div>
      <div data-zone="details">${detailsHTML(p)}</div>
      <div data-zone="vote">${voteHTML(p)}</div>
      <div data-zone="disc">${discHTML(p)}</div>
    </div>
  </article>`;
}
function detailsHTML(p){
  const tab = open[p.id];
  if(!tab) return `<button class="more" data-act="more">Посмотреть подробнее ↓</button>`;
  let pane="";
  if(tab==="product") pane=`<p class="lbl">Что делает</p><p>${esc(p.what)}</p>`;
  else if(tab==="model") pane=`<p class="lbl">Как зарабатывает</p><p>${esc(p.money)}</p>`;
  else if(tab==="metrics") pane=p.facts.map(([k,v])=>`<div class="kv"><span>${esc(k)}</span><b class="num">${esc(v)}</b></div>`).join("");
  else pane=`<div class="note"><p class="lbl">${esc(p.note[0])}</p><p style="margin:0">${esc(p.note[1])}</p></div>`;
  return `<div class="details">
    <div class="dhead"><h4>${esc(p.name)} · детали</h4><button class="x" data-act="close" aria-label="Свернуть"><svg width="18" height="18"><use href="#i-x"/></svg></button></div>
    <div class="dtabs" role="tablist">${DTABS.map(([k,l])=>`<button class="dtab" role="tab" data-act="dtab" data-k="${k}" aria-selected="${tab===k}">${l}</button>`).join("")}</div>
    <div class="dpane">${pane}</div>
  </div>`;
}
function voteHTML(p){
  const a=agg[p.id], mine=me.preds[p.id], v=mine&&mine.v;
  let h=`<p class="ask">Как думаешь, проект стрельнет?</p>
  <div class="votes${v?" voted":""}">
    <button class="vbtn yes" data-act="vote" data-k="y" aria-pressed="${v==="y"}">Стрельнет<small class="num">${plural(a.y,VOTES_F)}</small></button>
    <button class="vbtn no" data-act="vote" data-k="n" aria-pressed="${v==="n"}">Не стрельнет<small class="num">${plural(a.n,VOTES_F)}</small></button>
  </div>`;
  if(!v) return h;
  const py=pct(a.y,a.n);
  h+=`<div class="split" style="margin-top:12px"><div class="bar"><i style="width:${py}%"></i><i style="width:${100-py}%"></i></div>
     <div class="split-l num"><span><b>${py}%</b> стрельнет</span><span>${plural(a.y+a.n,VOTES_F)}</span><span><b>${100-py}%</b> нет</span></div></div>`;
  if(whyOpen[p.id]){
    const sel = draft[p.id] || new Set(mine.r||[]);
    draft[p.id]=sel;
    h+=`<div class="saved-msg${v==="n"?" no":""}" style="margin-top:12px">Прогноз сохранён: ${v==="y"?"СТРЕЛЬНЕТ":"НЕ СТРЕЛЬНЕТ"}. Теперь можно указать, почему.</div>
    <div class="why" style="margin-top:10px">
      <h5>Почему ты так считаешь?</h5><p>Выбери одну или несколько причин.</p>
      <div class="rlist">${REASONS.map(([k,l])=>`<button class="rbtn" data-act="reason" data-k="${k}" aria-pressed="${sel.has(k)}">${l}<i></i></button>`).join("")}</div>
      <label class="muted" for="why-${p.id}">Комментарий для обсуждения (необязательно)</label>
      <textarea id="why-${p.id}" maxlength="1000" placeholder="Например: сильная команда, но рынок маленький"></textarea>
      <div class="row"><button class="btn ghost" data-act="why-skip">Пропустить</button><button class="btn pri" data-act="why-done">Готово</button></div>
    </div>`;
  } else {
    const r=(mine.r||[]).filter(x=>RN[x]);
    h+=`<div class="mine" style="margin-top:10px">Твой прогноз: <span class="pill ${v}">${v==="y"?"Стрельнет":"Не стрельнет"}</span>
      ${r.length?`<span class="rtags">${r.map(x=>`<span class="rtag">${RN[x]}</span>`).join("")}</span>`:""}
      <button class="lk" data-act="why-open">${r.length?"Изменить причины":"Указать почему"}</button></div>`;
    const top=o=>Object.entries(o).sort((x,y)=>y[1]-x[1]).slice(0,3);
    const ty=top(a.ry), tn=top(a.rn);
    if(ty.length||tn.length){
      const col=(t,arr,cnt)=>`<div><h6>${t}</h6>${arr.length?`<ol>${arr.map(([k,c])=>`<li>${RN[k]}<span class="num">${pct(c,cnt-c)}%</span></li>`).join("")}</ol>`:`<p class="muted">Пока без причин</p>`}</div>`;
      h+=`<p class="lbl" style="margin:14px 0 6px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Почему так думает сообщество</p>
      <div class="crowd">${col("Стрельнет",ty,a.y)}${col("Не стрельнет",tn,a.n)}</div>`;
    }
  }
  return h;
}
function discHTML(p){
  const a=agg[p.id], n=a.c.length;
  let h=`<button class="disc-t" data-act="disc" aria-expanded="${!!discOpen[p.id]}">Обсуждение <span>${n?plural(n,CM_F):"пока пусто"} ${discOpen[p.id]?"↑":"↓"}</span></button>`;
  if(!discOpen[p.id]) return h;
  h+=`<div class="comments" style="margin-top:12px">`;
  if(!n) h+=`<p class="muted">Комментариев ещё нет. Сделай прогноз и объясни, почему.</p>`;
  a.c.slice(0,50).forEach(c=>{
    const own = c.uid===(uid||"me");
    h+=`<div class="cm"><div class="av">${esc(initials(nameOf(c.uid)))}</div><div style="min-width:0">
      <div class="cm-h"><b>${esc(nameOf(c.uid))}</b>${c.v?`<span class="pill ${c.v}">${c.v==="y"?"Стрельнет":"Не стрельнет"}</span>`:""}<time>${ago(c.t)}</time></div>
      <p>${esc(c.text)}</p>${own?`<button class="del" data-act="cdel" data-k="${esc(c.id)}">Удалить</button>`:""}</div></div>`;
  });
  h+=`<div class="cform"><label class="muted" for="cm-${p.id}">Твой комментарий</label><textarea id="cm-${p.id}" maxlength="1000" placeholder="Что думаешь о проекте?"></textarea>
     <div class="row"><button class="btn pri" data-act="csend">Отправить</button></div></div></div>`;
  return h;
}
function refreshCard(pid, zones=["vote","disc"]){
  const card=document.getElementById("c-"+pid); if(!card) return;
  const p=BY[pid];
  zones.forEach(z=>{
    const el=card.querySelector(`[data-zone="${z}"]`); if(!el) return;
    // keep unsent text when re-rendering
    const ta=el.querySelector("textarea"); const keep=ta?ta.value:null; const focused=ta&&document.activeElement===ta;
    el.innerHTML = z==="vote"?voteHTML(p):z==="disc"?discHTML(p):detailsHTML(p);
    const nt=el.querySelector("textarea"); if(nt&&keep){nt.value=keep; if(focused) nt.focus();}
  });
  const sv=card.querySelector(".save"); if(sv) sv.setAttribute("aria-pressed",saved.has(pid));
}

/* ================= VIEWS ================= */
function renderView(){
  renderChrome();
  const v=$("#view");
  if(ui.view==="profile"){ v.innerHTML=profileHTML(); renderSide(); return; }
  const arr=list();
  if(!arr.length){
    v.innerHTML = ui.view==="saved"
      ? `<div class="feed"><div class="empty"><h3>Здесь пока пусто</h3><p>Нажми на закладку на карточке проекта, чтобы вернуться к нему позже.</p></div></div>`
      : `<div class="feed"><div class="empty"><h3>Нет проектов</h3><p>Под эти фильтры ничего не подходит. Попробуй другую отрасль или стадию.</p></div></div>`;
  } else v.innerHTML=`<div class="feed">${arr.map(cardHTML).join("")}</div>`;
  renderSide();
}
function myStats(){
  const ids=Object.keys(me.preds).filter(id=>BY[id]&&me.preds[id].v);
  const yes=ids.filter(id=>me.preds[id].v==="y").length;
  const cms=Object.values(me.cm).reduce((s,a)=>s+(Array.isArray(a)?a.length:0),0);
  let agreeSum=0,agreeN=0;
  ids.forEach(id=>{const a=agg[id],t=a.y+a.n;if(t>1){const same=me.preds[id].v==="y"?a.y:a.n;agreeSum+=(same-1)/(t-1);agreeN++}});
  return {ids,yes,cms,agree:agreeN?Math.round(agreeSum/agreeN*100):null};
}
function profileHTML(){
  const s=myStats();
  const nm = myName || "Мой профиль";
  const sect={}; s.ids.forEach(id=>BY[id].tags.forEach(t=>{sect[t]=sect[t]||{n:0,y:0};sect[t].n++;if(me.preds[id].v==="y")sect[t].y++}));
  const reas={}; s.ids.forEach(id=>(me.preds[id].r||[]).forEach(r=>{if(RN[r])reas[r]=(reas[r]||0)+1}));
  const sects=Object.entries(sect).sort((a,b)=>b[1].n-a[1].n).slice(0,6);
  const reasL=Object.entries(reas).sort((a,b)=>b[1]-a[1]);
  const hist=s.ids.slice().sort((a,b)=>(me.preds[b].t||0)-(me.preds[a].t||0));
  return `<div class="prof">
    <div class="ph"><div class="av">${esc(initials(myName||"Я"))}</div><div><h2>${esc(nm)}</h2><p>${s.ids.length?`${plural(s.ids.length,PR_F)} из ${P.length} проектов`:"Ещё нет прогнозов"}</p></div></div>
    <div class="stats num">
      <div class="stat"><b>${s.ids.length}</b><span>прогнозов</span></div>
      <div class="stat"><b>${s.ids.length?pct(s.yes,s.ids.length-s.yes)+"%":"—"}</b><span>«стрельнет»</span></div>
      <div class="stat"><b>${s.agree===null?"—":s.agree+"%"}</b><span>согласие</span></div>
      <div class="stat"><b>${s.cms}</b><span>комментариев</span></div>
    </div>
    <p class="muted">Согласие — доля других участников, которые проголосовали так же, как ты. Точность прогнозов появится, когда у проектов будут результаты.</p>
    ${sects.length?`<div class="panel"><h3>По отраслям</h3>${sects.map(([t,o])=>`<div class="srow"><b>${esc(t)}</b><span class="num">${o.n} · ${pct(o.y,o.n-o.y)}% стрельнет</span><div class="bar"><i style="width:${pct(o.y,o.n-o.y)}%"></i><i style="width:${100-pct(o.y,o.n-o.y)}%"></i></div></div>`).join("")}</div>`:""}
    ${reasL.length?`<div class="panel"><h3>Чаще всего опираешься на</h3><div class="rtags">${reasL.map(([k,c])=>`<span class="rtag">${RN[k]} · ${c}</span>`).join("")}</div></div>`:""}
    <div class="panel"><h3>История прогнозов</h3>${hist.length?`<div class="hist">${hist.map(id=>{const p=BY[id],pr=me.preds[id],a=agg[id],same=pr.v==="y"?a.y:a.n;return `<button class="h-it" data-act="goto" data-k="${id}"><img src="${p.img}" alt="" loading="lazy"><div style="min-width:0"><b>${esc(p.name)}</b><small><span class="pill ${pr.v}">${pr.v==="y"?"Стрельнет":"Не стрельнет"}</span> · ${pr.t?ago(pr.t):""}</small></div><div class="h-agree num"><b>${pct(same,a.y+a.n-same)}%</b><br>с тобой</div></button>`}).join("")}</div>`:`<p class="muted">Открой ленту и сделай первый прогноз: стрельнет проект или нет.</p><div class="row" style="justify-content:flex-start;margin-top:10px"><button class="btn pri" data-act="view" data-k="feed">Перейти в ленту</button></div>`}</div>
  </div>`;
}
function renderSide(){
  const s=myStats();
  const hot=P.slice().sort((a,b)=>(agg[b.id].y+agg[b.id].n)-(agg[a.id].y+agg[a.id].n)||b.growth-a.growth).slice(0,6);
  $("#side-r").innerHTML=`<div class="panel"><h3>Моя статистика</h3><div class="stats num" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div class="stat"><b>${s.ids.length}</b><span>прогнозов</span></div><div class="stat"><b>${s.agree===null?"—":s.agree+"%"}</b><span>согласие</span></div></div></div>
    <div class="panel"><h3>Горячее сейчас</h3><div class="hot">${hot.map((p,i)=>{const a=agg[p.id],t=a.y+a.n;return `<button data-act="goto" data-k="${p.id}"><em class="num">${i+1}</em><b>${esc(p.name)}</b><span class="num">${t?pct(a.y,a.n)+"% · "+t:p.m[2][0]}</span></button>`}).join("")}</div></div>`;
}
function refreshAllCards(){ document.querySelectorAll(".card").forEach(c=>refreshCard(c.dataset.pid)); renderSide(); if(ui.view==="profile") $("#view").innerHTML=profileHTML(); }

/* ================= ACTIONS ================= */
document.addEventListener("click", e=>{
  const b=e.target.closest("[data-act]"); if(!b) return;
  const act=b.dataset.act, k=b.dataset.k, card=b.closest(".card"), pid=card&&card.dataset.pid;
  switch(act){
    case "view": ui.view=k; LS.set("ui",ui); renderView(); window.scrollTo({top:0}); break;
    case "feed": ui.feed=k; LS.set("ui",ui); renderView(); window.scrollTo({top:0}); break;
    case "sector": ui.sector=k; LS.set("ui",ui); renderView(); break;
    case "stage": ui.stage=k; LS.set("ui",ui); renderView(); break;
    case "more": open[pid]="product"; refreshCard(pid,["details"]); break;
    case "close": delete open[pid]; refreshCard(pid,["details"]); break;
    case "dtab": open[pid]=k; refreshCard(pid,["details"]); break;
    case "save":
      saved.has(pid)?saved.delete(pid):saved.add(pid); LS.set("saved",[...saved]);
      toast(saved.has(pid)?"Сохранено":"Убрано из сохранённого");
      if(ui.view==="saved") renderView(); else refreshCard(pid,[]); break;
    case "vote": {
      const cur=me.preds[pid];
      if(cur&&cur.v===k){ whyOpen[pid]=!whyOpen[pid]; refreshCard(pid,["vote"]); break; }
      me.preds[pid]={v:k,r:[],t:Date.now()}; delete draft[pid]; whyOpen[pid]=true;
      persist(); refreshCard(pid); renderSide(); break;
    }
    case "reason": { const s=draft[pid]||(draft[pid]=new Set()); s.has(k)?s.delete(k):s.add(k); b.setAttribute("aria-pressed",s.has(k)); break; }
    case "why-open": whyOpen[pid]=true; delete draft[pid]; refreshCard(pid,["vote"]); break;
    case "why-skip": whyOpen[pid]=false; delete draft[pid]; refreshCard(pid,["vote"]); break;
    case "why-done": {
      const pr=me.preds[pid]; if(!pr) break;
      pr.r=[...(draft[pid]||[])]; const ta=card.querySelector(`#why-${pid}`); const txt=ta?ta.value.trim():"";
      if(txt) addComment(pid,txt);
      whyOpen[pid]=false; delete draft[pid]; persist();
      if(txt) discOpen[pid]=true;
      refreshCard(pid); renderSide(); toast(txt?"Причины и комментарий сохранены":"Причины сохранены"); break;
    }
    case "disc": discOpen[pid]=!discOpen[pid]; refreshCard(pid,["disc"]); break;
    case "csend": {
      const ta=card.querySelector(`#cm-${pid}`); const txt=ta?ta.value.trim():""; if(!txt){ta&&ta.focus();break}
      ta.value=""; addComment(pid,txt); persist(); refreshCard(pid,["disc"]); break;
    }
    case "cdel": {
      const arr=me.cm[pid]||[]; me.cm[pid]=arr.filter(c=>c.id!==k); if(!me.cm[pid].length) delete me.cm[pid];
      persist(); refreshCard(pid,["disc"]); break;
    }
    case "goto": {
      ui.view="feed"; ui.sector="all"; ui.stage="all"; LS.set("ui",ui); renderView();
      const el=document.getElementById("c-"+k); if(el){ el.scrollIntoView({behavior:"smooth",block:"start"}); }
      break;
    }
  }
});
function addComment(pid,text){
  const arr=me.cm[pid]||(me.cm[pid]=[]);
  arr.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),text:text.slice(0,1000),t:Date.now()});
  if(arr.length>30) arr.splice(0,arr.length-30);
}

/* hide header while scrolling down on phones */
let lastY=0; addEventListener("scroll",()=>{const y=scrollY,t=$(".top");if(innerWidth>=1024){t.classList.remove("hide");lastY=y;return}
  if(y>160&&y>lastY+6) t.classList.add("hide"); else if(y<lastY-6||y<160) t.classList.remove("hide"); lastY=y;},{passive:true});
/* ================= BOOT ================= */
recompute(); setMode("local"); renderView();

async function resolveNames(){
  if(!userCap||!userCap.profiles) return;
  const ids=[...people.keys()].filter(id=>!(id in names));
  if(!ids.length) return;
  try{ const ps=await userCap.profiles(ids); let changed=false;
    ids.forEach(id=>{const n=ps&&ps[id]&&ps[id].name; names[id]=n||"Участник"; changed=true});
    if(changed) document.querySelectorAll(".card").forEach(c=>{ if(discOpen[c.dataset.pid]) refreshCard(c.dataset.pid,["disc"]) });
  }catch(e){}
}

(async()=>{
  if(!window.claude||!window.claude.use) return;
  let db=null;
  try{ [db,userCap]=await Promise.all([window.claude.use("db"),window.claude.use("user")]); }catch(e){}
  if(!db||!userCap) return;
  try{ uid=await userCap.id(); }catch(e){}
  if(!uid) return;
  try{ const p=await userCap.me(); myName=(p&&p.name)||""; }catch(e){}
  ref=db.doc("people/"+uid);
  let canWrite=null; try{ canWrite=await userCap.can("data.write"); }catch(e){}
  const local=me;
  let first=true;
  db.collection("people").onSnapshot(snap=>{
    people.clear();
    snap.docs.forEach(d=>{ if(!d.exists) return; if(d.id===uid){ if(first&&mode!=="mine-local"){ const remote=normMe(d.data()); if(!touched||!Object.keys(local.preds).length) me=remote; else me=mergeMe(remote,local);} return;} people.set(d.id,d.data()) });
    if(first){
      first=false;
      if(canWrite===false){ setMode("mine-local"); }
      else { setMode("live"); if(Object.keys(me.preds).length||Object.keys(me.cm).length) flush(); }
    }
    recompute(); refreshAllCards(); resolveNames();
  }, err=>{ setMode("local"); });
})();
function mergeMe(a,b){ const m=normMe(clone(a)); for(const k in b.preds){ if(!m.preds[k]||(b.preds[k].t||0)>(m.preds[k].t||0)) m.preds[k]=b.preds[k]; } for(const k in b.cm){ const ids=new Set((m.cm[k]||[]).map(c=>c.id)); m.cm[k]=(m.cm[k]||[]).concat(b.cm[k].filter(c=>!ids.has(c.id))); } return m; }
})();
