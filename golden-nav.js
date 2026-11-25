// Golden-Quran-style navigation for the mushaf: pull-down search sheet, tappable surah title, hizb/page indicator.
// Behavior and layout follow what the app shows publicly; all artwork, icons and text are Rattil's own.
export function initGoldenNav(api){
const {showView,setPage,getPage,toArabic,readStore,writeStore,announce,setImmersive,normalize,indexData,loadIndexData,pageForReference,juzForReference,shortSurahName,quranApi,mushafIndex}=api;
const $=id=>document.getElementById(id),body=document.body,view=$('view-quran');
const digits=s=>String(s).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const reciters=[{id:'7',name:'مشاري راشد العفاسي'},{id:'6',name:'محمود خليل الحصري'},{id:'9',name:'محمد صديق المنشاوي'},{id:'mp3-yasser',name:'ياسر الدوسري'}];
const store={get:(k,d)=>readStore(k,d),set:(k,v)=>writeStore(k,v)};
// ---- title strip + hizb indicator
const progress=document.createElement('div');progress.id='gqProgress';progress.hidden=true;progress.innerHTML='<i id="gqBarFill"></i><span id="gqHizb"></span><b id="gqPageNum"></b>';view.append(progress);
function updateStrip(){
  const page=getPage();$('gqPageNum').textContent=toArabic(page);$('gqBarFill').style.width=`${page/604*100}%`;
  const meta=indexData.meta;if(!meta){$('readerTitle').textContent='المصحف الشريف';$('readerSub').textContent='';$('gqHizb').textContent='';return}
  const ref=meta.pages.references[page-1];if(!ref)return;
  const surah=indexData.surahs?.find(s=>s.number===ref.surah);
  $('readerTitle').textContent=surah?shortSurahName(surah.name):'المصحف الشريف';
  $('readerSub').textContent=`الجزء ${toArabic(juzForReference(ref.surah,ref.ayah))}`;
  const quarters=meta.hizbQuarters?.references||[];let q=0;quarters.forEach((r,i)=>{if(r.surah<ref.surah||(r.surah===ref.surah&&r.ayah<=ref.ayah))q=i+1});
  if(q){const hizb=Math.ceil(q/4),part=(q-1)%4+1;$('gqHizb').textContent=`${toArabic(part)}/٤ الحزب ${toArabic(hizb)}`}
}
for(const ev of ['rattil-page','rattil-page-changing'])window.addEventListener(ev,()=>updateStrip());
loadIndexData().then(updateStrip).catch(()=>{});updateStrip();
window.addEventListener('rattil-view',e=>{if(e.detail.name==='quran'){loadIndexData().then(updateStrip).catch(()=>{});updateStrip()}});
$('gqTitle').addEventListener('click',()=>$('indexButton').click());
$('paperPageNumber').addEventListener('click',()=>$('pagePickerButton').click());
$('gqBookmark').addEventListener('click',()=>$('bookmarkButton').click());
const bm=$('bookmarkButton');new MutationObserver(()=>{const on=bm.getAttribute('aria-pressed')==='true';$('gqBookmark').setAttribute('aria-pressed',String(on));$('gqBookmark').classList.toggle('saved',on)}).observe(bm,{attributes:true,attributeFilter:['aria-pressed']});
$('gqBookmark').setAttribute('aria-pressed',bm.getAttribute('aria-pressed')||'false');
// ---- index sheet extras
$('gqEditionChange').addEventListener('click',()=>announce?.('مصحف المدينة برواية حفص هو المتاح حاليًا'));
document.querySelectorAll('[data-gq-action]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.gqAction;mushafIndex.close();
  if(a==='home'){setImmersive(false);showView('home')}
  if(a==='page')$('pagePickerButton').click();
  if(a==='practice')$('practiceFromPage').click();
  if(a==='focus'){setImmersive(true);$('restoreReaderTools').hidden=false}}));
mushafIndex.addEventListener('click',e=>{if(e.target===mushafIndex)mushafIndex.close()});
// ---- search sheet
const dlg=document.createElement('dialog');dlg.id='gqSearch';dlg.className='gq-search';dlg.setAttribute('aria-label','بحث في المصحف');
dlg.innerHTML=`<div class="gq-search-top"><button type="button" class="gq-x" id="gqSearchClose" aria-label="إغلاق">×</button><label class="gq-field"><span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg></span><input id="gqQuery" type="search" enterkeyhint="search" autocomplete="off" placeholder="بحث: الصفحة، السورة، القارئ.. إلخ" aria-label="بحث"></label></div>
<div class="gq-chips" id="gqChips" role="tablist"></div>
<div class="gq-search-body" id="gqBody"></div>`;
document.body.append(dlg);
const filters=[['all','الكل'],['surah','السورة'],['text','النص القرآني'],['page','الصفحة'],['juz','الجزء'],['reciter','القارئ']];
let filter='all',seq=0,timer=0,ctrl=null;
const chips=$('gqChips');for(const [id,label] of filters){const b=document.createElement('button');b.type='button';b.dataset.f=id;b.textContent=label;b.setAttribute('role','tab');b.addEventListener('click',()=>{filter=id;paint();run()});chips.append(b)}
function paint(){chips.querySelectorAll('button').forEach(b=>{const on=b.dataset.f===filter;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on))})}
const recents=()=>{try{const r=JSON.parse(store.get('rattil-recent-searches','[]'));return Array.isArray(r)?r.filter(x=>typeof x==='string').slice(0,8):[]}catch{return []}};
const saveRecent=q=>{q=q.trim();if(!q)return;store.set('rattil-recent-searches',JSON.stringify([q,...recents().filter(x=>x!==q)].slice(0,8)))};
function go(page,q){if(q)saveRecent(q);dlg.close();mushafIndex.open&&mushafIndex.close();showView('quran');setPage(page)}
function head(text,extra){const h=document.createElement('h3');h.className='gq-h';const t=document.createElement('span');t.textContent=text;h.append(t);if(extra)h.append(extra);return h}
function row(title,detail,page,q,badge){const b=document.createElement('button');b.type='button';b.className='gq-row';const c=document.createElement('span');const t=document.createElement('strong');t.textContent=title;c.append(t);if(detail){const s=document.createElement('small');s.textContent=detail;c.append(s)}b.append(c);if(badge){const p=document.createElement('em');p.textContent=badge;b.append(p)}b.addEventListener('click',()=>go(page,q));return b}
function reciterEl(r){const b=document.createElement('button');b.type='button';b.className='gq-reciter';const av=document.createElement('span');av.textContent=r.name.replace(/^(الشيخ|محمد|محمود|مشاري|ياسر)\s+/,'').trim().charAt(0)||'ق';const n=document.createElement('small');n.textContent=r.name;b.append(av,n);b.addEventListener('click',()=>{const sel=$('defaultReciter');if(sel){sel.value=r.id;sel.dispatchEvent(new Event('change'))}else{store.set('rattil-default-reciter',r.id)}announce?.(`القارئ الافتراضي: ${r.name}`)});return b}
function home(){
  const b=$('gqBody');b.replaceChildren();const list=recents();
  if(list.length){const clear=document.createElement('button');clear.type='button';clear.className='gq-clear';clear.textContent='مسح';clear.addEventListener('click',()=>{store.set('rattil-recent-searches','[]');home()});b.append(head('عمليات البحث الأخيرة',clear));const wrap=document.createElement('div');wrap.className='gq-recents';for(const q of list){const r=document.createElement('button');r.type='button';r.className='gq-recent';r.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v4.2h4.2M12 7.5V12l3 2"/></svg>';const s=document.createElement('span');s.textContent=q;r.append(s);r.addEventListener('click',()=>{$('gqQuery').value=q;run()});wrap.append(r)}b.append(wrap)}
  b.append(head('أسماء القُرّاء'));const rs=document.createElement('div');rs.className='gq-scroller';reciters.forEach(r=>rs.append(reciterEl(r)));b.append(rs);
  b.append(head('الجزء'));const js=document.createElement('div');js.className='gq-scroller gq-juzs';for(let n=1;n<=30;n++){const j=document.createElement('button');j.type='button';j.textContent=`الجزء ${toArabic(n)}`;j.addEventListener('click',()=>{const ref=indexData.meta?.juzs?.references?.[n-1];if(ref)go(pageForReference(ref.surah,ref.ayah))});js.append(j)}b.append(js);
}
function note(text){const p=document.createElement('p');p.className='gq-note';p.textContent=text;return p}
async function run(){
  const q=$('gqQuery').value.trim();const mine=++seq;clearTimeout(timer);ctrl?.abort();
  if(!q){home();return}
  const b=$('gqBody');b.replaceChildren();const nq=normalize(digits(q)).toLocaleLowerCase('ar'),num=/^\d+$/.test(digits(q))?Number(digits(q)):0;const all=filter==='all';let any=false;
  const add=(title,nodes)=>{if(!nodes.length)return;any=true;b.append(head(title));nodes.forEach(n=>b.append(n))};
  const surahs=indexData.surahs||[];
  if(all||filter==='page'){const nodes=[];if(num>=1&&num<=604)nodes.push(row(`صفحة ${toArabic(num)}`,'اذهب مباشرة',num,q));const m=/^(\d+)\s*[:：]\s*(\d+)$/.exec(digits(q));if(m&&surahs.length)nodes.push(row(`${shortSurahName(surahs[Number(m[1])-1]?.name||'')} · الآية ${toArabic(Number(m[2]))}`,'اذهب للآية',pageForReference(Number(m[1]),Number(m[2])),q));add('الصفحة',nodes)}
  if(all||filter==='juz'){const nodes=[];if(num>=1&&num<=30){const ref=indexData.meta?.juzs?.references?.[num-1];if(ref)nodes.push(row(`الجزء ${toArabic(num)}`,'اذهب لبداية الجزء',pageForReference(ref.surah,ref.ayah),q))}add('الجزء',nodes)}
  if(all||filter==='surah'){const nodes=surahs.filter(s=>(nq&&normalize(s.name).toLocaleLowerCase('ar').includes(nq))||(num&&s.number===num)).slice(0,12).map(s=>row(shortSurahName(s.name),`رقمها ${toArabic(s.number)} · آياتها ${toArabic(s.numberOfAyahs)}`,pageForReference(s.number,1),q,toArabic(pageForReference(s.number,1))));add('السور',nodes)}
  if(all||filter==='reciter'){const nodes=reciters.filter(r=>nq&&normalize(r.name).toLocaleLowerCase('ar').includes(nq)).map(reciterEl);if(nodes.length){any=true;b.append(head('القرّاء'));const rs=document.createElement('div');rs.className='gq-scroller';nodes.forEach(n=>rs.append(n));b.append(rs)}}
  if((all||filter==='text')&&nq.length>=2&&!num){
    const slot=document.createElement('div');slot.className='gq-text-slot';slot.append(note('جارٍ البحث في نص القرآن…'));b.append(head('النص القرآني'),slot);any=true;
    timer=setTimeout(async()=>{
      ctrl=new AbortController();
      try{const r=await fetch(`${quranApi}/search/${encodeURIComponent(q)}/all/quran-uthmani`,{signal:ctrl.signal});if(mine!==seq)return;if(r.status===404){slot.replaceChildren(note('مفيش آيات بالنص ده.'));return}if(!r.ok)throw new Error();const data=await r.json();const items=(data.data?.matches||[]).slice(0,40);if(!items.length){slot.replaceChildren(note('مفيش آيات بالنص ده.'));return}slot.replaceChildren(...items.map(m=>{const name=shortSurahName(m.surah?.name||'');return row(m.text,`${name} · الآية ${toArabic(m.numberInSurah)}`,pageForReference(m.surah.number,m.numberInSurah),q,toArabic(pageForReference(m.surah.number,m.numberInSurah)))}))}
      catch(err){if(mine===seq&&err.name!=='AbortError')slot.replaceChildren(note('البحث في النص محتاج إنترنت.'))}
    },350);
  }
  if(!any)b.append(note('مفيش نتائج.'));
}
let openedAt=0;
function openSearch(){if(dlg.open||document.querySelector('dialog[open]'))return;openedAt=Date.now();$('gqQuery').value='';filter='all';paint();home();dlg.showModal();loadIndexData().then(()=>{if(dlg.open&&!$('gqQuery').value)home()}).catch(()=>{})}
$('gqQuery').addEventListener('input',run);
$('gqQuery').addEventListener('keydown',e=>{if(e.key==='Enter'){saveRecent($('gqQuery').value);$('gqQuery').blur()}});
$('gqSearchClose').addEventListener('click',()=>dlg.close());
dlg.addEventListener('close',()=>{seq++;ctrl?.abort();clearTimeout(timer)});
document.addEventListener('keydown',e=>{if(e.key==='/'&&body.classList.contains('reader-view')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();openSearch()}});
// ---- pull down from the top
let g=null;const paper=view.querySelector('.mushaf-paper');
const reset=()=>{paper.style.transition='transform .2s ease';view.style.setProperty('--gq-pull','0px');view.classList.remove('gq-pulling');setTimeout(()=>{paper.style.transition=''},220)};
view.addEventListener('touchstart',e=>{if(e.touches.length!==1||!body.classList.contains('reader-view')||document.querySelector('dialog[open]')){g=null;return}const t=e.touches[0];g={x:t.clientX,y:t.clientY,on:false}},{passive:true});
view.addEventListener('touchmove',e=>{if(!g)return;if(e.touches.length!==1){g=null;reset();return}const t=e.touches[0],dx=t.clientX-g.x,dy=t.clientY-g.y;
  if(!g.on){if(dy>16&&dy>Math.abs(dx)*1.6){g.on=true;view.classList.add('gq-pulling')}else if(Math.abs(dx)>16||dy<-16){g=null;return}}
  if(g.on){paper.style.transition='none';const pull=Math.min(96,dy*.5);view.style.setProperty('--gq-pull',`${pull}px`);view.classList.toggle('gq-ready',dy>120)}},{passive:true});
const end=e=>{if(!g)return;const t=e.changedTouches[0],dy=t?t.clientY-g.y:0,fire=g.on&&dy>120;g=null;view.classList.remove('gq-ready');reset();if(fire)openSearch()};
view.addEventListener('touchend',end,{passive:true});view.addEventListener('touchcancel',()=>{g=null;view.classList.remove('gq-ready');reset()},{passive:true});
window.rattilOpenSearch=openSearch;
// ---- browse mode (tap blank page area or the grid icon): dims the page, shows top bar, chips and tab bar
const top=document.createElement('div');top.id='gqBrowseTop';top.innerHTML='<div class="gq-pill2"><button type="button" id="gqBGear" aria-label="الإعدادات"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button><button type="button" id="gqBSearch" aria-label="بحث"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg></button></div><strong id="gqBTitle">وضع التصفح</strong><button type="button" id="gqBMenu" class="gq-round" aria-label="العودة إلى المصحف"><svg viewBox="0 0 24 24"><path d="M3 5.5c3-.7 6 0 9 1.800v12c-3-1.800-6-2.500-9-1.800zM21 5.500c-3-.7-6 0-9 1.800v12c3-1.800 6-2.500 9-1.800z"/><path d="M14 3l3 2-3 2"/></svg></button>';
const bottom=document.createElement('div');bottom.id='gqBrowseBottom';bottom.innerHTML='<button type="button" id="gqBSurah" class="gq-chip"><span id="gqBSurahName"></span><svg viewBox="0 0 24 24"><path d="M12 6v14M12 6c-2-1.5-5-2-8-1.5V18c3-.5 6 0 8 2 2-2 5-2.500 8-2V4.500c-3-.5-6 0-8 1.500z"/></svg></button><button type="button" id="gqBPage" class="gq-chip gq-chip-page">الصفحة <b id="gqBPageNum"></b></button><button type="button" id="gqBMore" class="gq-chip gq-round" aria-label="أدوات القراءة">···</button>';
view.append(top,bottom);
const setBrowse=on=>{body.classList.toggle('gq-browse',on);if(on){$('gqBTitle').textContent=$('readerTitle').textContent;shrink();$('gqBSurahName').textContent=$('readerTitle').textContent;$('gqBPageNum').textContent=toArabic(getPage())}};
const shrink=()=>{const y=paper.scrollTop||0;top.classList.toggle('gq-small',y>40)};paper.addEventListener('scroll',shrink,{passive:true});
const isBrowse=()=>body.classList.contains('gq-browse');
$('gqGrid').addEventListener('click',()=>setBrowse(!isBrowse()));
view.addEventListener('click',e=>{if(!isBrowse())return;if(e.target.closest('#gqBrowseTop,#gqBrowseBottom,#gqFontSize,.tabbar'))return;e.stopPropagation();e.preventDefault();setBrowse(false)},true);
paper.addEventListener('click',e=>{if(isBrowse()||e.target.closest('.un-ayah-hit,.ayah-note-marker,#paperPageNumber'))return;setBrowse(true)});
$('gqBGear').addEventListener('click',()=>{setBrowse(false);showView('settings')});
$('gqBSearch').addEventListener('click',()=>{setBrowse(false);openSearch()});
$('gqBMenu').addEventListener('click',()=>setBrowse(false));
$('gqBSurah').addEventListener('click',()=>{setBrowse(false);$('indexButton').click()});
$('gqBPage').addEventListener('click',()=>{setBrowse(false);$('pagePickerButton').click()});
$('gqBMore').addEventListener('click',()=>{setBrowse(false);$('readerMore').click()});
window.addEventListener('rattil-view',()=>setBrowse(false));
window.addEventListener('rattil-page',()=>{if(isBrowse()){$('gqBTitle').textContent=$('readerTitle').textContent;$('gqBSurahName').textContent=$('readerTitle').textContent;$('gqBPageNum').textContent=toArabic(getPage())}});

// ---- "ع" mushaf text size: tap upper half = bigger, lower half = smaller (5 steps), saved
const sizes=[1,1.12,1.25,1.4,1.6];let sz=Math.max(0,Math.min(4,+localStorage.getItem('rattil-mushaf-size')||0));
const applySize=()=>{view.style.setProperty('--gq-zoom',sizes[sz]);body.classList.toggle('gq-zoomed',sz>0);localStorage.setItem('rattil-mushaf-size',sz)};
const fs=document.createElement('button');fs.type='button';fs.id='gqFontSize';fs.setAttribute('aria-label','حجم الخط');fs.innerHTML='<i>⌃</i><b>ع</b><i>⌄</i>';view.append(fs);
fs.addEventListener('click',e=>{const r=fs.getBoundingClientRect();sz=Math.max(0,Math.min(4,sz+(e.clientY<r.top+r.height/2?1:-1)));applySize();e.stopPropagation()});
applySize();

// ---- verse sheet (Golden-style): verse text, copy and share in the sheet header
const vt=$('verseTools');
if(vt){const head=vt.querySelector('.un-sheet-head'),vtxt=document.createElement('p');vtxt.id='gqVerseText';vtxt.dir='rtl';vtxt.lang='ar';head.after(vtxt);
 const mk=(id,label,svg)=>{const b=document.createElement('button');b.type='button';b.id=id;b.setAttribute('aria-label',label);b.innerHTML=svg;return b};
 const cp=mk('gqVerseCopy','نسخ الآية','<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>'),sh=mk('gqVerseShare','مشاركة الآية','<svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>');
 head.append(cp,sh);let cur='',curRef='';
 const label=()=>vt.querySelector('#verseTitle')?.textContent||'';
 const load=async()=>{const m=label();const t=vt.querySelector('#verseTitle');const key=m;if(key===curRef)return;curRef=key;cur='';vtxt.textContent='…';
  // find the selected ayah from the highlighted polygon
  const p=document.querySelector('.mushaf-svg .un-selected-ayah');if(!p){vtxt.textContent='';return}
  const s=p.getAttribute('surah'),a=p.getAttribute('ayah');
  try{const r=await fetch(`https://api.alquran.cloud/v1/ayah/${s}:${a}/quran-uthmani`,{cache:'force-cache'});const j=await r.json();if(curRef!==key)return;cur=j.data.text;vtxt.textContent=cur}catch{vtxt.textContent='';cur=''}};
 new MutationObserver(()=>{if(vt.open)load();else curRef=''}).observe(vt,{attributes:true,attributeFilter:['open']});
 const full=()=>`${cur}\n﴿${label()}﴾`;
 cp.addEventListener('click',async()=>{if(!cur)return;try{await navigator.clipboard.writeText(full());cp.classList.add('gq-done');setTimeout(()=>cp.classList.remove('gq-done'),1200)}catch{}});
 sh.addEventListener('click',async()=>{if(!cur)return;try{if(navigator.share)await navigator.share({text:full()});else await navigator.clipboard.writeText(full())}catch{}});
}
}
