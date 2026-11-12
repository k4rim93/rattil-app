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
const surahPicker=document.getElementById('surahPickerDialog');
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
document.getElementById('indexButton').addEventListener('click',async()=>{
  surahPicker.showModal();const list=document.getElementById('surahList');if(list.dataset.loaded==='true')return;
  list.innerHTML='<p class="quran-loading">جارٍ تحميل الفهرس…</p>';
  try{
    const result=await getQuranJson(`${quranApi}/surah`);list.replaceChildren();
    result.data.forEach(surah=>{const button=document.createElement('button');button.className='surah-option';button.setAttribute('role','listitem');const name=document.createElement('span');name.textContent=`${toArabic(surah.number)}. ${surah.name}`;const small=document.createElement('small');small.textContent=`${toArabic(surah.numberOfAyahs)} آية`;button.append(name,small);button.addEventListener('click',async()=>{
      button.disabled=true;announce(`جارٍ فتح ${surah.name}`);
      try{const result=await getQuranJson(`${quranApi}/surah/${surah.number}/quran-uthmani`);const first=result.data.ayahs[0];surahPicker.close();showView('quran');setPage(first.page)}catch{announce('تعذر فتح السورة الآن. تحقق من الاتصال وحاول مرة أخرى.')}finally{button.disabled=false}
    });list.append(button)});list.dataset.loaded='true';
  }catch{list.innerHTML='<p class="quran-error">تعذر تحميل الفهرس. اتصل بالإنترنت ثم أعد فتحه.</p>'}
});
document.getElementById('closeSurahPicker').addEventListener('click',()=>surahPicker.close());
document.getElementById('bookmarkButton').addEventListener('click',event=>{
  const button=event.currentTarget;const saved=Number(readStore('rattil-bookmarked-page','0'));
  if(saved===page){writeStore('rattil-bookmarked-page','0');button.classList.remove('saved');button.setAttribute('aria-pressed','false');announce('اتشالت علامة الصفحة')}else{writeStore('rattil-bookmarked-page',page);button.classList.add('saved');button.setAttribute('aria-pressed','true');announce(`اتحفظت الصفحة ${toArabic(page)}`)}
});
function syncBookmark(){const active=Number(readStore('rattil-bookmarked-page','0'))===page;const button=document.getElementById('bookmarkButton');button.classList.toggle('saved',active);button.setAttribute('aria-pressed',String(active))}
const previousSetPage=setPage;setPage=function(next){previousSetPage(next);syncBookmark()};syncBookmark();
let touchStart=null;const mushafPaper=document.querySelector('.mushaf-paper');
mushafPaper.addEventListener('touchstart',event=>{if(event.changedTouches.length)touchStart={x:event.changedTouches[0].clientX,y:event.changedTouches[0].clientY}},{passive:true});
mushafPaper.addEventListener('touchend',event=>{if(!touchStart||!event.changedTouches.length)return;const touch=event.changedTouches[0],dx=touch.clientX-touchStart.x,dy=touch.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25)setPage(page+(dx>0?1:-1))},{passive:true});
document.addEventListener('keydown',event=>{if(document.getElementById('view-quran').classList.contains('active')&&!pagePicker.open&&!surahPicker.open){if(event.key==='ArrowLeft')setPage(page+1);if(event.key==='ArrowRight')setPage(page-1)}});

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

