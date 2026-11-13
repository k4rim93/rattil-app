const views=[...document.querySelectorAll('.view')];
const toast=document.getElementById('toast');
let toastTimer;
function announce(message){toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),3200)}
function readStore(key,fallback=null){try{return localStorage.getItem(key)??fallback}catch{return fallback}}
function writeStore(key,value){try{localStorage.setItem(key,String(value))}catch{announce('تعذّر الحفظ على هذا الجهاز.')}}

const viewHistory=[{name:document.querySelector('.view.active')?.id.replace('view-','')||'home',scrollY:window.scrollY}];
function renderView(name,scrollY=0){
  const target=document.getElementById(`view-${name}`);if(!target)return;
  views.forEach(view=>view.classList.toggle('active',view===target));
  document.getElementById('backButton').hidden=viewHistory.length<=1;
  document.querySelectorAll('.tabbar [data-view]').forEach(button=>{
    const active=button.dataset.view===name;button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  document.title=`رتل — ${target.dataset.title||'رفيقك مع القرآن'}`;
  document.getElementById('mainContent').focus({preventScroll:true});
  requestAnimationFrame(()=>window.scrollTo({top:scrollY,behavior:'instant'}));
  if(name==='quran'&&!pageLoaded)loadPage(page);
}
function scrollToTop(){const current=viewHistory.at(-1);if(current)current.scrollY=0;window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
function showView(name){
  if(!document.getElementById(`view-${name}`))return;
  const current=viewHistory.at(-1);
  if(current?.name===name){scrollToTop();return}
  if(current)current.scrollY=window.scrollY;
  viewHistory.push({name,scrollY:0});
  history.pushState({rattilView:name},'',window.location.href);
  renderView(name,0);
}
function navigateBack(){if(viewHistory.length>1)history.back()}
window.addEventListener('popstate',()=>{if(viewHistory.length>1)viewHistory.pop();const previous=viewHistory.at(-1)||{name:'home',scrollY:0};renderView(previous.name,previous.scrollY)});
let edgeStart=null;
document.addEventListener('touchstart',event=>{const touch=event.changedTouches[0];edgeStart=touch&&touch.clientX<=24&&!document.querySelector('dialog[open]')?{x:touch.clientX,y:touch.clientY}:null},{capture:true,passive:true});
document.addEventListener('touchend',event=>{
  if(!edgeStart)return;const touch=event.changedTouches[0],dx=touch.clientX-edgeStart.x,dy=touch.clientY-edgeStart.y;edgeStart=null;
  if(document.getElementById('view-quran').classList.contains('active'))return;
  if(dx>72&&Math.abs(dy)<100&&viewHistory.length>1){if(event.cancelable)event.preventDefault();event.stopImmediatePropagation();navigateBack()}
},{capture:true,passive:false});
document.addEventListener('touchcancel',()=>{edgeStart=null},{capture:true,passive:true});
document.getElementById('backButton').addEventListener('click',navigateBack);
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));
const backToTop=document.getElementById('backToTop');let scrollFrame=0;
window.addEventListener('scroll',()=>{if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{backToTop.hidden=window.scrollY<280;scrollFrame=0})},{passive:true});
backToTop.addEventListener('click',scrollToTop);

const modeButtons=[...document.querySelectorAll('[data-mode]')];
modeButtons.forEach(button=>button.addEventListener('click',()=>{
  const review=button.dataset.mode==='review';
  modeButtons.forEach(tab=>{const active=tab===button;tab.classList.toggle('selected',active);tab.setAttribute('aria-selected',String(active))});
  document.getElementById('followPanel').hidden=review;document.getElementById('reviewPanel').hidden=!review;
}));
document.getElementById('startFollow').addEventListener('click',()=>announce('التعرّف على التلاوة غير متاح بعد؛ لم يُفتح الميكروفون ولم يُسجّل صوتك.'));
document.getElementById('startReview').addEventListener('click',()=>{
  const fields=document.querySelectorAll('#reviewPanel input');const from=Number(fields[0].value),to=Number(fields[1].value);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from){announce('راجع نطاق الآيات: البداية يجب أن تكون رقمًا صحيحًا وأقل من النهاية.');return}
  announce('تم اختيار المقطع. تشغيل التسميع يحتاج ربط محرك التعرّف على التلاوة.');
});

const toArabic=value=>new Intl.NumberFormat('ar-EG',{useGrouping:false}).format(value);
const pagePicker=document.getElementById('pagePickerDialog');
const mushafIndex=document.getElementById('mushafIndexDialog');
const ayahNoteDialog=document.getElementById('ayahNoteDialog');
let page=Number(readStore('rattil-page','42'))||42,pageLoaded=false,pageRequest=0;
function updatePageNumbers(){for(const id of ['pageNumber','pageNumberBottom','paperPageNumber','homePageNumber'])document.getElementById(id).textContent=toArabic(page)}
function setPage(next){page=Math.max(1,Math.min(604,Number(next)||1));writeStore('rattil-page',page);pageLoaded=false;updatePageNumbers();loadPage(page)}
const quranCacheName='rattil-quran-pages-v1';
async function cachedJson(url){
  if('caches'in window){try{const cache=await caches.open(quranCacheName);const hit=await cache.match(url);if(hit)return await hit.json()}catch{}}
  return null;
}
async function fetchJson(url){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    if('caches'in window){try{const cache=await caches.open(quranCacheName);await cache.put(url,response.clone())}catch{}}
    return await response.json();
  }finally{clearTimeout(timer)}
}
const quranApi='https://api.alquran.cloud/v1';
async function getQuranJson(url){const cached=await cachedJson(url);if(cached)return cached;return fetchJson(url)}
const mushafSvgBase='https://cdn.jsdelivr.net/gh/quran-ws/quran-svg@b4155f07e4aea087d2c458069acff9f7c7e749f6/mushafs/hafs/kfqc/svg';
function mushafPageUrl(pageNumber){return `${mushafSvgBase}/${String(pageNumber).padStart(3,'0')}.svg`}
async function fetchPageSvg(url){
  if('caches'in window){try{const cache=await caches.open(quranCacheName);const hit=await cache.match(url);if(hit)return hit.text()}catch{}}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch(url,{signal:controller.signal,headers:{Accept:'image/svg+xml'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    if('caches'in window){try{const cache=await caches.open(quranCacheName);await cache.put(url,response.clone())}catch{}}
    return await response.text();
  }finally{clearTimeout(timer)}
}
function renderPageSvg(source,requestedPage){
  const parsed=new DOMParser().parseFromString(source,'image/svg+xml');
  const svg=parsed.documentElement;
  if(svg.localName!=='svg'||parsed.querySelector('parsererror')||!svg.querySelector('#content'))throw new Error('invalid mushaf page');
  const root=document.getElementById('mushafSvgHost');
  const mounted=document.importNode(svg,true);
  mounted.classList.add('mushaf-svg');mounted.setAttribute('role','img');mounted.setAttribute('aria-label',`صفحة المصحف ${toArabic(requestedPage)}`);
  mounted.removeAttribute('width');mounted.removeAttribute('height');
  root.replaceChildren(mounted);
  document.getElementById('paperPageNumber').textContent=toArabic(requestedPage);pageLoaded=true;
  connectAyahMarkers(requestedPage,mounted);
}
async function connectAyahMarkers(requestedPage,svg){
  try{
    const result=await getQuranJson(`${quranApi}/page/${requestedPage}/quran-uthmani`);if(page!==requestedPage)return;
    const ayahs=result.data.ayahs,markers=[...svg.querySelectorAll('#ayah_markers .ayah-mark')];
    markers.forEach((marker,index)=>{const ayah=ayahs[index];if(!ayah)return;const reference={surah:ayah.surah.number,surahName:ayah.surah.name,ayah:ayah.numberInSurah,page:requestedPage};let pressTimer=0,didLongPress=false,pointerType='';marker.classList.add('ayah-note-marker');marker.setAttribute('role','button');marker.setAttribute('tabindex','0');marker.setAttribute('aria-label',`اضغط مطولًا لإضافة ملاحظة على ${ayah.surah.name}، الآية ${toArabic(ayah.numberInSurah)}`);marker.addEventListener('pointerdown',event=>{pointerType=event.pointerType;if(pointerType==='touch'||pointerType==='pen'){didLongPress=false;pressTimer=setTimeout(()=>{didLongPress=true;openAyahNote(reference)},550)}});['pointerup','pointerleave','pointercancel'].forEach(type=>marker.addEventListener(type,()=>clearTimeout(pressTimer)));marker.addEventListener('click',event=>{if(event.detail===0||pointerType==='mouse')openAyahNote(reference);else if(didLongPress)event.preventDefault()})});
  }catch{/* يبقى عرض المصحف متاحًا حتى عند تعذّر تحميل بيانات الفهرسة */}
}
async function loadPage(requestedPage){
  const current=++pageRequest,root=document.getElementById('mushafSvgHost');
  root.innerHTML='<p class="quran-loading">جارٍ تحميل صفحة المصحف…</p>';
  const url=mushafPageUrl(requestedPage);
  try{
    const svg=await fetchPageSvg(url);if(current!==pageRequest)return;renderPageSvg(svg,requestedPage);
  }catch{
    if(current!==pageRequest)return;
    pageLoaded=false;root.innerHTML='<div class="quran-error">تعذّر تحميل الصفحة. افتحها أول مرة مع اتصال بالإنترنت، ثم ستُحفظ على هذا الجهاز.<button class="gold-button" id="retryPage">إعادة المحاولة</button></div>';
    document.getElementById('retryPage').addEventListener('click',()=>loadPage(requestedPage));
  }
}
updatePageNumbers();
document.getElementById('previousPage').addEventListener('click',()=>setPage(page-1));
document.getElementById('nextPage').addEventListener('click',()=>setPage(page+1));
document.getElementById('pagePickerButton').addEventListener('click',()=>{document.getElementById('pageInput').value=page;pagePicker.showModal()});
document.getElementById('goToPageButton').addEventListener('click',event=>{event.preventDefault();const input=document.getElementById('pageInput');const value=Number(input.value);if(!Number.isInteger(value)||value<1||value>604){input.setCustomValidity('أدخل رقمًا من ١ إلى ٦٠٤');input.reportValidity();return}input.setCustomValidity('');pagePicker.close();setPage(value)});
const indexData={meta:null,surahs:null};
const getBookmarks=()=>{try{const saved=JSON.parse(readStore('rattil-bookmarks','[]'));return Array.isArray(saved)?saved:[]}catch{return []}};
const getNotes=()=>{try{const saved=JSON.parse(readStore('rattil-ayah-notes','[]'));return Array.isArray(saved)?saved:[]}catch{return []}};
const getSurahName=(number)=>indexData.surahs?.find(item=>item.number===number)?.name||`السورة ${toArabic(number)}`;
function pageForReference(surah,ayah){const refs=indexData.meta?.pages?.references||[];let found=0;for(let i=0;i<refs.length;i++){const ref=refs[i];if(ref.surah===surah&&ref.ayah<=ayah)found=i+1;if(ref.surah>surah)break}return found||1}
function juzForReference(surah,ayah){const refs=indexData.meta?.juzs?.references||[];let number=1;refs.forEach((ref,index)=>{if(ref.surah<surah||(ref.surah===surah&&ref.ayah<=ayah))number=index+1});return number}
function makeIndexRow({title,detail,page:targetPage,kind='page',reference=null,progress=null}){
  const button=document.createElement('button');button.className='surah-option index-entry';button.setAttribute('role','listitem');
  const primary=document.createElement('span');primary.className='index-entry-copy';const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('small');small.textContent=detail;primary.append(strong,small);
  const pageLabel=document.createElement('span');pageLabel.className='index-entry-page';pageLabel.textContent=toArabic(targetPage);
  button.append(primary);
  if(progress!==null){const meter=document.createElement('span');meter.className='juz-progress';meter.style.setProperty('--progress',`${progress*3.6}deg`);meter.setAttribute('role','img');meter.setAttribute('aria-label',`التقدم في الجزء حسب آخر صفحة: ${toArabic(progress)}٪`);const value=document.createElement('span');value.textContent=`${toArabic(progress)}٪`;meter.append(value);button.append(meter)}
  button.append(pageLabel);button.addEventListener('click',()=>{if(kind==='note'&&reference)openAyahNote(reference);mushafIndex.close();showView('quran');setPage(targetPage)});return button;
}
function renderSavedIndexes(){
  const notes=[...getNotes()],bookmarks=[...getBookmarks()],sort=document.querySelector('#indexSort [data-sort].selected')?.dataset.sort||'date';
  const ordering=(a,b)=>sort==='page'?a.page-b.page:b.updatedAt-a.updatedAt;
  notes.sort(ordering);bookmarks.sort(ordering);
  const noteList=document.getElementById('notesList'),bookmarkList=document.getElementById('bookmarksList');noteList.replaceChildren();bookmarkList.replaceChildren();
  if(!notes.length)noteList.innerHTML='<div class="index-empty"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M19 3l2 2-9 9-3 1 1-3z"/></svg></span><strong>لا توجد ملاحظات</strong><small>اضغط مطولًا على علامة آية في صفحة المصحف لإضافة ملاحظة.</small></div>';
  else notes.forEach(note=>noteList.append(makeIndexRow({title:`${note.surahName||getSurahName(note.surah)} · الآية ${toArabic(note.ayah)}`,detail:`صفحة ${toArabic(note.page)} · ${new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium'}).format(note.updatedAt)}`,page:note.page,kind:'note',reference:note})));
  if(!bookmarks.length)bookmarkList.innerHTML='<div class="index-empty"><span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z"/></svg></span><strong>لا توجد صفحات محفوظة</strong><small>احفظ الصفحة من شريط المصحف للوصول إليها هنا.</small></div>';
  else bookmarks.forEach(item=>{const ref=indexData.meta?.pages?.references?.[item.page-1];const detail=ref?`${getSurahName(ref.surah)} · الآية ${toArabic(ref.ayah)} · حُفظت ${new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium'}).format(item.updatedAt)}`:`حُفظت ${new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium'}).format(item.updatedAt)}`;bookmarkList.append(makeIndexRow({title:`صفحة ${toArabic(item.page)}`,detail,page:item.page}))});
}
async function loadIndexData(){
  const surahList=document.getElementById('surahList'),juzList=document.getElementById('juzList');
  if(indexData.meta&&indexData.surahs){renderSurahs();renderJuz();renderSavedIndexes();return}
  surahList.innerHTML='<p class="quran-loading">جارٍ تحميل الفهرس…</p>';juzList.innerHTML='<p class="quran-loading">جارٍ تحميل الأجزاء…</p>';
  try{
    const [meta,surahs]=await Promise.all([getQuranJson(`${quranApi}/meta`),getQuranJson(`${quranApi}/surah`)]);indexData.meta=meta.data;indexData.surahs=surahs.data;renderSurahs();renderJuz();renderSavedIndexes();
  }catch{surahList.innerHTML='<p class="quran-error">تعذر تحميل الفهرس. اتصل بالإنترنت ثم أعد فتحه.</p>';juzList.innerHTML='<p class="quran-error">تعذر تحميل فهرس الأجزاء.</p>'}
}
function renderSurahs(){
  if(!indexData.surahs)return;
  const list=document.getElementById('surahList'),query=document.getElementById('surahSearch').value.trim().toLocaleLowerCase('ar');list.replaceChildren();
  const matches=indexData.surahs.filter(s=>s.name.toLocaleLowerCase('ar').includes(query)||String(s.number).includes(query));
  let activeJuz=0;
  matches.forEach(surah=>{
    const targetPage=pageForReference(surah.number,1),juz=juzForReference(surah.number,1);
    if(juz!==activeJuz){const heading=document.createElement('h3');heading.className='index-group-heading';heading.textContent=`الجزء ${toArabic(juz)}`;list.append(heading);activeJuz=juz}
    list.append(makeIndexRow({title:`${toArabic(surah.number)}. ${surah.name}`,detail:`${toArabic(surah.numberOfAyahs)} آية · ${surah.revelationType==='Meccan'?'مكية':'مدنية'}`,page:targetPage}));
  });
  if(!list.children.length)list.innerHTML='<p class="quran-error">لا توجد سورة بهذا الاسم.</p>';
}
function renderJuz(){
  const list=document.getElementById('juzList'),refs=indexData.meta.juzs.references,lastPage=Number(readStore('rattil-page','42'))||42;list.replaceChildren();
  refs.forEach((ref,index)=>{
    const startPage=pageForReference(ref.surah,ref.ayah),endPage=index+1<refs.length?pageForReference(refs[index+1].surah,refs[index+1].ayah)-1:604,span=Math.max(1,endPage-startPage+1);
    const progress=Math.max(0,Math.min(100,Math.round((lastPage<startPage?0:lastPage>endPage?span:lastPage-startPage+1)/span*100)));
    list.append(makeIndexRow({title:`الجزء ${toArabic(index+1)}`,detail:`${getSurahName(ref.surah)} · الآية ${toArabic(ref.ayah)}`,page:startPage,progress}));
  });
}
function selectIndexTab(name){document.querySelectorAll('[data-index-tab]').forEach(tab=>{const selected=tab.dataset.indexTab===name;tab.classList.toggle('selected',selected);tab.setAttribute('aria-selected',String(selected))});document.querySelectorAll('.index-panel').forEach(panel=>{const selected=panel.id===`indexPanel-${name}`;panel.hidden=!selected;panel.classList.toggle('active',selected)});document.getElementById('surahSearchWrap').hidden=name!=='surahs';document.getElementById('indexSort').hidden=!['notes','bookmarks'].includes(name);if(name==='notes'||name==='bookmarks')renderSavedIndexes()}
document.getElementById('indexButton').addEventListener('click',()=>{selectIndexTab('surahs');mushafIndex.showModal();loadIndexData()});
document.getElementById('closeMushafIndex').addEventListener('click',()=>mushafIndex.close());
document.querySelectorAll('[data-index-tab]').forEach(tab=>tab.addEventListener('click',()=>selectIndexTab(tab.dataset.indexTab)));
document.getElementById('surahSearch').addEventListener('input',renderSurahs);
document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-sort]').forEach(item=>item.classList.toggle('selected',item===button));renderSavedIndexes()}));
document.getElementById('bookmarkButton').addEventListener('click',event=>{
  const button=event.currentTarget;let saved=getBookmarks();if(!saved.length){const legacy=Number(readStore('rattil-bookmarked-page','0'));if(legacy)saved=[{page:legacy,updatedAt:Date.now()}]}
  if(saved.some(item=>item.page===page)){saved=saved.filter(item=>item.page!==page);announce('اتشالت الصفحة من المرجعيات')}else{saved.push({page,updatedAt:Date.now()});announce(`اتحفظت الصفحة ${toArabic(page)}`)}
  writeStore('rattil-bookmarks',JSON.stringify(saved));syncBookmark();if(mushafIndex.open)renderSavedIndexes();
});
function syncBookmark(){let saved=getBookmarks();if(!saved.length){const legacy=Number(readStore('rattil-bookmarked-page','0'));if(legacy)saved=[{page:legacy}]}const active=saved.some(item=>item.page===page);const button=document.getElementById('bookmarkButton');button.classList.toggle('saved',active);button.setAttribute('aria-pressed',String(active));button.querySelector('span').textContent=active?'محفوظة':'حفظ الصفحة'}
const previousSetPage=setPage;setPage=function(next){previousSetPage(next);syncBookmark()};syncBookmark();
let touchStart=null;const mushafPaper=document.querySelector('.mushaf-paper');
mushafPaper.addEventListener('touchstart',event=>{if(event.changedTouches.length)touchStart={x:event.changedTouches[0].clientX,y:event.changedTouches[0].clientY}},{passive:true});
mushafPaper.addEventListener('touchend',event=>{if(!touchStart||!event.changedTouches.length)return;const touch=event.changedTouches[0],dx=touch.clientX-touchStart.x,dy=touch.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25)setPage(page+(dx>0?1:-1))},{passive:true});
document.addEventListener('keydown',event=>{if(document.getElementById('view-quran').classList.contains('active')&&!pagePicker.open&&!mushafIndex.open&&!ayahNoteDialog.open){if(event.key==='ArrowLeft')setPage(page+1);if(event.key==='ArrowRight')setPage(page-1)}});

let activeNote=null;
function noteKey(reference){return `${reference.surah}:${reference.ayah}`}
function openAyahNote(reference){activeNote=reference;const key=noteKey(reference),saved=getNotes().find(note=>noteKey(note)===key);document.getElementById('noteVerseReference').textContent=`${reference.surahName||saved?.surahName||getSurahName(reference.surah)} · الآية ${toArabic(reference.ayah)} · صفحة ${toArabic(reference.page)}`;document.getElementById('ayahNoteText').value=saved?.text||'';document.getElementById('deleteAyahNote').hidden=!saved;ayahNoteDialog.showModal();setTimeout(()=>document.getElementById('ayahNoteText').focus(),80)}
document.getElementById('closeAyahNote').addEventListener('click',()=>ayahNoteDialog.close());
document.getElementById('saveAyahNote').addEventListener('click',()=>{const text=document.getElementById('ayahNoteText').value.trim();if(!text){announce('اكتب الملاحظة قبل حفظها');return}const notes=getNotes().filter(note=>noteKey(note)!==noteKey(activeNote));notes.push({...activeNote,text,updatedAt:Date.now()});writeStore('rattil-ayah-notes',JSON.stringify(notes));ayahNoteDialog.close();announce('اتحفظت الملاحظة على هذا الجهاز');if(mushafIndex.open)renderSavedIndexes()});
document.getElementById('deleteAyahNote').addEventListener('click',()=>{writeStore('rattil-ayah-notes',JSON.stringify(getNotes().filter(note=>noteKey(note)!==noteKey(activeNote))));ayahNoteDialog.close();announce('اتحذفت الملاحظة');if(mushafIndex.open)renderSavedIndexes()});

const immersiveButton=document.getElementById('immersiveButton');
function setImmersive(active){document.body.classList.toggle('immersive-reading',active);document.documentElement.classList.toggle('immersive-reading',active);immersiveButton.setAttribute('aria-pressed',String(active));immersiveButton.textContent=active?'إنهاء ملء الشاشة':'ملء الشاشة';immersiveButton.setAttribute('aria-label',active?'إنهاء وضع القراءة الغامر':'تفعيل وضع القراءة الغامر');if(!active&&document.fullscreenElement)document.exitFullscreen?.().catch(()=>{})}
immersiveButton.addEventListener('click',async()=>{const active=!document.body.classList.contains('immersive-reading');setImmersive(active);if(active&&document.documentElement.requestFullscreen){try{await document.documentElement.requestFullscreen()}catch{/* يبقى وضع القراءة داخل الصفحة */}}});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.body.classList.contains('immersive-reading'))setImmersive(false)});

const today=new Date();const dateText=new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(today);
document.querySelectorAll('#todayDate,#todayDate2').forEach(node=>node.textContent=dateText);

const locations={cairo:{lat:30.0444,lon:31.2357,name:'القاهرة'}};
let userLocation={...locations.cairo,name:`${locations.cairo.name} (افتراضي)`};
try{const saved=JSON.parse(readStore('rattil-location','null'));if(saved&&Number.isFinite(saved.lat)&&Number.isFinite(saved.lon))userLocation=saved}catch{}
function setLocationLabels(){const shortName=userLocation.name.replace(' (افتراضي)','');document.getElementById('prayerCityName').textContent=shortName;document.getElementById('settingsLocationLabel').textContent=`${userLocation.name} · اضغط لتغيير الموقع`;document.getElementById('prayerMethodNote').textContent=`طريقة الحساب المصرية · ${userLocation.name}`}
function prayerTimesFor(date){const coordinates=new adhan.Coordinates(userLocation.lat,userLocation.lon);const params=adhan.CalculationMethod.Egyptian();params.madhab=adhan.Madhab.Shafi;return new adhan.PrayerTimes(coordinates,date,params)}
const prayerNames={fajr:'الفجر',sunrise:'الشروق',dhuhr:'الظهر',asr:'العصر',maghrib:'المغرب',isha:'العشاء'};
const prayerIconPaths={
  fajr:'<path d="M3 19h18M6 14l2 1.4M12 11v3M18 14l-2 1.4M4.5 10.5l1.2 1.2M19.5 10.5l-1.2 1.2"/>',
  sunrise:'<path d="M3 19h18M6 16a6 6 0 0 1 12 0M12 3v3M5.6 6.6l2.1 2.1M18.4 6.6l-2.1 2.1M3.5 12.5l2.4.6M20.5 12.5l-2.4.6"/>',
  dhuhr:'<circle cx="12" cy="12" r="3.4"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  asr:'<circle cx="12" cy="12" r="2.8"/><circle cx="12" cy="3.2" r=".65"/><circle cx="18.2" cy="5.8" r=".65"/><circle cx="20.8" cy="12" r=".65"/><circle cx="18.2" cy="18.2" r=".65"/><circle cx="12" cy="20.8" r=".65"/><circle cx="5.8" cy="18.2" r=".65"/><circle cx="3.2" cy="12" r=".65"/><circle cx="5.8" cy="5.8" r=".65"/>',
  maghrib:'<path d="M3 19h18M6 18a6 6 0 0 1 12 0M12 4v3M5.7 7l2 2M18.3 7l-2 2M3.5 13l2.4.6M20.5 13l-2.4.6"/>',
  isha:'<path d="M18.5 15.5A8 8 0 0 1 8.4 5.4a8.5 8.5 0 1 0 10.1 10.1Z"/><path d="M17.5 4v3M16 5.5h3M21 10v2M20 11h2"/>'
};
function prayerIconSvg(key){return `<svg class="prayer-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${prayerIconPaths[key]||prayerIconPaths.fajr}</svg>`}
function formatTime(date){return new Intl.DateTimeFormat('ar-EG',{hour:'numeric',minute:'2-digit',hour12:true}).format(date)}
function formatCompactPrayerTime(date){return formatTime(date).replace(/\s*[صم]$/,'')}
let nextPrayerAt=null;
function updatePrayerCountdown(){
  if(!nextPrayerAt)return;
  const seconds=Math.max(0,Math.floor((nextPrayerAt-new Date())/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),remaining=seconds%60;
  const value=[hours,minutes,remaining].map(part=>String(part).padStart(2,'0')).map(toArabic).join(':');
  document.getElementById('prayerCountdownDashboard').textContent=value;
}
function updatePrayerTimes(){
  try{
    const now=new Date(),times=prayerTimesFor(now),rows=Object.entries(prayerNames).map(([key,name])=>({key,name,time:times[key]}));
    const list=document.getElementById('prayerTimesList');list.replaceChildren();
    rows.forEach(row=>{const line=document.createElement('div');line.className='prayer-time-row';line.dataset.prayer=row.key;line.setAttribute('role','listitem');const icon=document.createElement('span');icon.className=`prayer-time-icon prayer-${row.key}`;icon.innerHTML=prayerIconSvg(row.key);const name=document.createElement('span');name.className='prayer-time-name';name.textContent=row.name;const time=document.createElement('strong');time.className='prayer-time-value';time.textContent=formatCompactPrayerTime(row.time);line.append(icon,name,time);list.append(line)});
    const cycle=['fajr','dhuhr','asr','maghrib','isha'].map(key=>({key,name:prayerNames[key],time:times[key]}));
    let nextIndex=cycle.findIndex(row=>row.time>now),previous,next,nextAt;
    if(nextIndex>=0){next=cycle[nextIndex];nextAt=next.time;if(nextIndex>0)previous=cycle[nextIndex-1];else{const yesterday=new Date(now);yesterday.setDate(now.getDate()-1);previous={key:'isha',name:prayerNames.isha,time:prayerTimesFor(yesterday).isha}}
    }else{const tomorrow=new Date(now);tomorrow.setDate(now.getDate()+1);next={key:'fajr',name:prayerNames.fajr};nextAt=prayerTimesFor(tomorrow).fajr;previous=cycle.at(-1)}
    
    document.getElementById('prayerDashboardNextName').textContent=next.name;
    document.getElementById('nextPrayerGlyph').innerHTML=prayerIconSvg(next.key);
    
    list.querySelector(`[data-prayer="${next.key}"]`)?.classList.add('next-prayer');
    const progress=Math.max(0,Math.min(100,((now-previous.time)/(nextAt-previous.time))*100));
    document.getElementById('prayerProgressFill').style.width=`${progress}%`;
    document.querySelector('.prayer-progress-track').setAttribute('aria-valuenow',String(Math.round(progress)));
    document.getElementById('prayerProgressFrom').textContent=`${previous.name} ${formatTime(previous.time)}`;
    document.getElementById('prayerProgressTo').textContent=`${next.name} ${formatTime(nextAt)}`;
    nextPrayerAt=nextAt;updatePrayerCountdown();
  }catch{document.getElementById('prayerCountdownDashboard').textContent='—';document.getElementById('prayerTimesList').textContent='تعذّر حساب المواقيت على هذا الجهاز.'}
}
setLocationLabels();updatePrayerTimes();setInterval(updatePrayerTimes,60000);setInterval(updatePrayerCountdown,1000);
document.getElementById('locationButton').addEventListener('click',()=>{
  if(!navigator.geolocation){announce('تحديد الموقع غير مدعوم. ستظل المواقيت محسوبة للقاهرة.');return}
  announce('اسمح للموقع بالوصول لموقعك لحساب المواقيت الأقرب.');
  navigator.geolocation.getCurrentPosition(position=>{
    userLocation={lat:position.coords.latitude,lon:position.coords.longitude,name:'موقعي الحالي'};writeStore('rattil-location',JSON.stringify(userLocation));setLocationLabels();updatePrayerTimes();announce('تم تحديث الموقع وحساب مواقيت الصلاة.');
  },error=>{const message=error.code===1?'لم تسمح بالوصول للموقع. غيّر الإذن من إعدادات المتصفح.':error.code===3?'انتهت مهلة تحديد الموقع. حاول مرة أخرى.':'تعذر تحديد الموقع. تأكد من تشغيل خدمات الموقع.';announce(`${message} المواقيت الحالية للقاهرة.`)},{enableHighAccuracy:false,timeout:12000,maximumAge:300000});
});

const themeToggle=document.getElementById('themeToggle');
function applyTheme(){const light=readStore('rattil-theme','night')==='light';document.body.classList.toggle('light',light);themeToggle.querySelector('small').textContent=light?'الواجهة الفاتحة الهادئة':'الواجهة الداكنة الهادئة';themeToggle.querySelector('.state-pill').textContent=light?'مفعّل':'مفعّل'}
themeToggle.addEventListener('click',()=>{writeStore('rattil-theme',readStore('rattil-theme','night')==='light'?'night':'light');applyTheme()});applyTheme();

const todayKey=new Intl.DateTimeFormat('en-CA').format(new Date());
const azkarKey=`rattil-azkar-${todayKey}`;
function getAzkarCounts(){try{return JSON.parse(readStore(azkarKey,'{}'))||{}}catch{return {}}}
function updateAzkar(){const counts=getAzkarCounts();document.querySelectorAll('.dhikr-row').forEach(button=>{const id=button.dataset.dhikr,target=Number(button.dataset.target),count=Math.min(target,Number(counts[id])||0);document.getElementById(`count-${id}`).textContent=`${toArabic(count)} / ${toArabic(target)}`;button.classList.toggle('complete',count>=target);button.setAttribute('aria-label',`${button.querySelector('strong').textContent}: ${toArabic(count)} من ${toArabic(target)}. اضغط للزيادة.`)})}
document.querySelectorAll('.dhikr-row').forEach(button=>button.addEventListener('click',()=>{const counts=getAzkarCounts(),id=button.dataset.dhikr,target=Number(button.dataset.target);counts[id]=Math.min(target,(Number(counts[id])||0)+1);writeStore(azkarKey,JSON.stringify(counts));updateAzkar()}));
document.getElementById('resetAzkar').addEventListener('click',()=>{writeStore(azkarKey,'{}');updateAzkar();announce('اتصفّر عدّ أذكار اليوم')});updateAzkar();

document.getElementById('offlineButton').addEventListener('click',()=>announce(navigator.onLine?'واجهة التطبيق محفوظة، وكل صفحة مصحف تفتحها تُخزّن لقراءتها لاحقًا.':'أنت دون اتصال. هتقدر تفتح الصفحات اللي اتحمّلت قبل كده فقط.'));
let deferredInstall;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;document.getElementById('installButton').hidden=false});
document.getElementById('installButton').addEventListener('click',async()=>{if(!deferredInstall){announce('من Safari اختار مشاركة ثم إضافة إلى الشاشة الرئيسية.');return}deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null});
if('serviceWorker'in navigator&&window.location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(()=>{});

