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
const top=document.createElement('div');top.id='gqBrowseTop';top.innerHTML='<div class="gq-pill2"><button type="button" id="gqBGear" aria-label="الإعدادات"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button><button type="button" id="gqBSearch" aria-label="بحث"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg></button></div><strong id="gqBTitle">وضع التصفح</strong><button type="button" id="gqBMenu" class="gq-round" aria-label="الفهرس"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h11M4 17h7"/></svg></button>';
const bottom=document.createElement('div');bottom.id='gqBrowseBottom';bottom.innerHTML='<button type="button" id="gqBSurah" class="gq-chip"><span id="gqBSurahName"></span><svg viewBox="0 0 24 24"><path d="M12 6v14M12 6c-2-1.5-5-2-8-1.5V18c3-.5 6 0 8 2 2-2 5-2.500 8-2V4.500c-3-.5-6 0-8 1.500z"/></svg></button><button type="button" id="gqBPage" class="gq-chip gq-chip-page">الصفحة <b id="gqBPageNum"></b></button><button type="button" id="gqBMore" class="gq-chip gq-round" aria-label="أدوات القراءة">···</button>';
view.append(top,bottom);
const setProg=()=>$('gqBPage').style.setProperty('--gq-prog',(getPage()/604*100).toFixed(1)+'%');
const setBrowse=on=>{body.classList.toggle('gq-browse',on);if(on){$('gqBTitle').textContent=$('readerTitle').textContent;shrink();$('gqBSurahName').textContent=$('readerTitle').textContent;$('gqBPageNum').textContent=toArabic(getPage());setProg()}};
const shrink=()=>{const y=paper.scrollTop||0;top.classList.toggle('gq-small',y>40)};paper.addEventListener('scroll',shrink,{passive:true});
const isBrowse=()=>body.classList.contains('gq-browse');
$('gqGrid').addEventListener('click',()=>setBrowse(!isBrowse()));
view.addEventListener('click',e=>{if(!isBrowse())return;if(e.target.closest('#gqBrowseTop,#gqBrowseBottom,#gqMini,#gqFontSize,.tabbar'))return;e.stopPropagation();e.preventDefault();setBrowse(false)},true);
paper.addEventListener('click',e=>{if(isBrowse()||e.defaultPrevented||e.target.closest('.ayah-note-marker,#paperPageNumber'))return;setBrowse(true)});
$('gqBGear').addEventListener('click',()=>{setBrowse(false);showView('settings')});
$('gqBSearch').addEventListener('click',()=>{setBrowse(false);openSearch()});
$('gqBMenu').addEventListener('click',()=>{setBrowse(false);$('indexButton').click()});
$('gqBSurah').addEventListener('click',()=>{setBrowse(false);$('indexButton').click()});
$('gqBPage').addEventListener('click',()=>{setBrowse(false);$('pagePickerButton').click()});
$('gqBMore').addEventListener('click',()=>{setBrowse(false);$('readerMore').click()});
window.addEventListener('rattil-view',()=>setBrowse(false));
window.addEventListener('rattil-page',()=>{if(isBrowse()){$('gqBTitle').textContent=$('readerTitle').textContent;$('gqBSurahName').textContent=$('readerTitle').textContent;$('gqBPageNum').textContent=toArabic(getPage())}});

// ---- "ع" mushaf text size: tap upper half = bigger, lower half = smaller (5 steps), saved
const sizes=[1,1.12,1.25,1.4,1.6];let sz=Math.max(0,Math.min(4,+localStorage.getItem('rattil-mushaf-size')||0));
const applySize=()=>{view.style.setProperty('--gq-zoom',sizes[sz]);body.classList.toggle('gq-zoomed',sz>0);localStorage.setItem('rattil-mushaf-size',sz)};
const fs=document.createElement('button');fs.type='button';fs.id='gqFontSize';fs.setAttribute('aria-label','حجم الخط');fs.innerHTML='<i>⌃</i><b>ع</b><i>⌄</i>';bottom.append(fs);
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

// ---- browse-mode mini player (reciter, "playing from page N", play/prev/next/stop/expand)
const mini=document.createElement('div');mini.id='gqMini';mini.innerHTML='<button type="button" id="gqMiniExp" aria-label="فتح أدوات التلاوة"><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></button><div class="gq-mini-t"><b id="gqMiniName"></b><small id="gqMiniSub"></small></div><button type="button" id="gqMiniNext" aria-label="التالي"><svg viewBox="0 0 24 24"><path d="M6 6l6 6-6 6M13 6l6 6-6 6" transform="scale(-1 1) translate(-24 0)"/></svg></button><button type="button" id="gqMiniPlay" aria-label="تشغيل"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></button><button type="button" id="gqMiniPrev" aria-label="السابق"><svg viewBox="0 0 24 24"><path d="M6 6l6 6-6 6M13 6l6 6-6 6"/></svg></button><button type="button" id="gqMiniStop" aria-label="إيقاف"><i></i></button>';view.append(mini);
const reciterName=()=>{const r=$('reciterChoice');return r?r.options[r.selectedIndex]?.textContent||'':''};
const updMini=()=>{$('gqMiniName').textContent=reciterName();$('gqMiniSub').textContent='تشغيل من الصفحة '+toArabic(getPage())};
// ---- verse long-press: top card (text + actions) and bottom sheet (translation / tafsir)
const poly=()=>[...document.querySelectorAll('.mushaf-svg .ayahPolygon')].filter(p=>p.getAttribute('surah')&&p.getAttribute('ayah'));
const ayahs=()=>{const seen=new Set(),out=[];for(const p of poly()){const k=p.getAttribute('surah')+':'+p.getAttribute('ayah');if(!seen.has(k)){seen.add(k);out.push({k,p})}}return out};
const selKey=()=>{const p=document.querySelector('.mushaf-svg .un-selected-ayah');return p?p.getAttribute('surah')+':'+p.getAttribute('ayah'):''};
let autoplay=false,allowQuick=false;
const holdOn=(p,auto)=>{autoplay=!!auto;p.dispatchEvent(new PointerEvent('pointerdown',{isPrimary:true,button:0,bubbles:true,clientX:1,clientY:1}));setTimeout(()=>p.dispatchEvent(new PointerEvent('pointerup',{isPrimary:true,bubbles:true})),700)};
const step=(d,auto)=>{const l=ayahs();if(!l.length)return;const k=selKey();let i=l.findIndex(x=>x.k===k);i=i<0?(d>0?0:l.length-1):i+d;if(i<0||i>=l.length)return;holdOn(l[i].p,auto)};
$('gqMiniPlay').addEventListener('click',()=>{if(selKey())$('miniPlay').click();else{const l=ayahs();if(l.length)holdOn(l[0].p,true)}});
$('gqMiniStop').addEventListener('click',()=>$('miniStop').click());
$('gqMiniExp').addEventListener('click',()=>{setBrowse(false);if(!selKey()){const l=ayahs();if(l.length){holdOn(l[0].p,false)}}else $('miniOpen').click()});
$('gqMiniNext').addEventListener('click',()=>step(1,true));$('gqMiniPrev').addEventListener('click',()=>step(-1,true));
const IC={share:'<svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',copy:'<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',mark:'<svg viewBox="0 0 24 24"><path d="M7 3h10v18l-5-4-5 4z"/></svg>',note:'<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 9h8M8 13h5"/></svg>',play:'<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',book:'<svg viewBox="0 0 24 24"><path d="M12 6v14M12 6c-2-1.500-5-2-8-1.500V18c3-.5 6 0 8 2 2-2 5-2.500 8-2V4.500c-3-.5-6 0-8 1.500z"/></svg>',x:'<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',up:'<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',down:'<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',edit:'<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>'};
const card=document.createElement('div');card.id='gqVCard';card.hidden=true;card.innerHTML='<p id="gqVCText" dir="rtl" lang="ar"></p><div class="gq-vc-actions"><button type="button" data-a="share">'+IC.share+'<small>مشاركة</small></button><button type="button" data-a="copy">'+IC.copy+'<small>نسخ</small></button><button type="button" data-a="mark">'+IC.mark+'<small>علامة</small></button><button type="button" data-a="note">'+IC.note+'<small>ملاحظة</small></button><button type="button" data-a="play">'+IC.play+'<small>تلاوة</small></button></div>';
const sheet=document.createElement('div');sheet.id='gqVSheet';sheet.hidden=true;sheet.innerHTML='<i class="gq-grab"></i><header><button type="button" id="gqVClose" aria-label="إغلاق">'+IC.x+'</button><h3 id="gqVTitle"></h3><span></span></header><nav id="gqVTabs"><button type="button" data-t="ar.muyassar">التفسير الميسر</button><button type="button" data-t="ar.jalalayn">الجلالين</button><button type="button" data-t="en.sahih">English</button><button type="button" id="gqVEdit">'+IC.edit+' ملاحظتي</button></nav><div id="gqVBody" dir="auto"></div><footer><div class="gq-vf-pill"><button type="button" data-a="copy" aria-label="نسخ">'+IC.copy+'</button><button type="button" data-a="share" aria-label="مشاركة">'+IC.share+'</button></div><div class="gq-vf-pill"><button type="button" id="gqVPrev">السابق '+IC.up+'</button><button type="button" id="gqVNext">التالي '+IC.down+'</button></div><button type="button" id="gqVMushaf" class="gq-vf-round" aria-label="المصحف">'+IC.book+'</button></footer>';
view.append(card,sheet);
const cache=new Map();let tab=localStorage.getItem('rattil-verse-tab')||'ar.muyassar',curK='',vtext='';
const getEd=async(k,ed)=>{const key=k+'|'+ed;if(cache.has(key))return cache.get(key);const r=await fetch(`https://api.alquran.cloud/v1/ayah/${k}/${ed}`,{cache:'force-cache'});if(!r.ok)throw Error('x');const j=await r.json();const t=j.data.text;cache.set(key,t);return t};
const title=()=>$('verseTitle')?.textContent||'';
const fullText=()=>`${vtext}\n﴿${title()}﴾`;
const loadTab=async()=>{const k=curK;sheet.querySelectorAll('#gqVTabs [data-t]').forEach(b=>b.classList.toggle('on',b.dataset.t===tab));const b=$('gqVBody');b.textContent='…';b.lang=tab.startsWith('en')?'en':'ar';try{const t=await getEd(k,tab);if(k===curK)b.textContent=t}catch{if(k===curK)b.textContent='تعذّر التحميل. تحتاج اتصال بالإنترنت.'}};
const showV=async()=>{const k=selKey();if(!k)return;curK=k;vtext='';card.hidden=false;sheet.hidden=false;body.classList.add('gq-verse');$('gqVTitle').textContent=title();$('gqVCText').textContent='…';loadTab();try{const t=await getEd(k,'quran-uthmani');if(k===curK){vtext=t;$('gqVCText').textContent=t}}catch{if(k===curK)$('gqVCText').textContent=''}};
const hideV=()=>{if(card.hidden&&sheet.hidden)return;card.hidden=true;sheet.hidden=true;body.classList.remove('gq-verse');curK=''};
const quick=$('verseQuick');
if(quick)new MutationObserver(()=>{if(!quick.open)return;if(allowQuick){allowQuick=false;return}quick.close();if(autoplay){autoplay=false;$('quickContinue').click();updMini()}else showV()}).observe(quick,{attributes:true,attributeFilter:['open']});
const act=async a=>{if(a==='copy'){if(vtext)try{await navigator.clipboard.writeText(fullText())}catch{}}else if(a==='share'){if(vtext)try{if(navigator.share)await navigator.share({text:fullText()});else await navigator.clipboard.writeText(fullText())}catch{}}else if(a==='mark')$('verseBookmark').click();else if(a==='note'){hideV();$('verseNote').click()}else if(a==='play'){allowQuick=true;quick.showModal()}};
for(const b of [...card.querySelectorAll('[data-a]'),...sheet.querySelectorAll('[data-a]')])b.addEventListener('click',()=>act(b.dataset.a));
sheet.querySelectorAll('#gqVTabs [data-t]').forEach(b=>b.addEventListener('click',()=>{tab=b.dataset.t;localStorage.setItem('rattil-verse-tab',tab);loadTab()}));
$('gqVEdit').addEventListener('click',()=>act('note'));$('gqVClose').addEventListener('click',hideV);$('gqVMushaf').addEventListener('click',hideV);
$('gqVNext').addEventListener('click',()=>step(1,false));$('gqVPrev').addEventListener('click',()=>step(-1,false));
window.addEventListener('rattil-page',()=>{hideV();updMini()});window.addEventListener('rattil-view',hideV);
const _sb=setBrowse;
body.addEventListener('transitionend',()=>{},{once:true});
let wasB=false;new MutationObserver(()=>{const b=isBrowse();if(b===wasB)return;wasB=b;if(b){updMini();if(!sheet.hidden)hideV()}}).observe(body,{attributes:true,attributeFilter:['class']});
}
