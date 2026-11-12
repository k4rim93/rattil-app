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
function renderPage(data,requestedPage){
  const ayahs=data?.data?.ayahs;if(!Array.isArray(ayahs)||!ayahs.length)throw new Error('empty page');
  const root=document.getElementById('quranVerses');root.replaceChildren();
  let lastSurah=null;
  ayahs.forEach(ayah=>{
    if(ayah.surah.number!==lastSurah){
      if(ayah.numberInSurah===1){const heading=document.createElement('h2');heading.className='surah-heading';heading.textContent=ayah.surah.name;root.append(heading);if(ayah.surah.number!==1&&ayah.surah.number!==9){const basmala=document.createElement('p');basmala.className='bismillah';basmala.textContent='بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';root.append(basmala)}}
      lastSurah=ayah.surah.number;
    }
    const text=document.createElement('span');text.className='ayah-text';text.textContent=`${ayah.text} `;root.append(text);
    const marker=document.createElement('span');marker.className='ayah-marker';marker.textContent=` ﴿${toArabic(ayah.numberInSurah)}﴾ `;root.append(marker);
  });
  document.getElementById('paperPageNumber').textContent=toArabic(requestedPage);pageLoaded=true;
}
async function loadPage(requestedPage){
  const current=++pageRequest;const root=document.getElementById('quranVerses');
  root.innerHTML='<p class="quran-loading">جارٍ تحميل آيات الصفحة…</p>';
  const url=`${quranApi}/page/${requestedPage}/quran-uthmani`;
  try{
    const data=await getQuranJson(url);if(current!==pageRequest)return;renderPage(data,requestedPage);
  }catch{
    if(current!==pageRequest)return;
    pageLoaded=false;root.innerHTML='<div class="quran-error">لم نتمكن من تحميل الصفحة. تأكد من الاتصال ثم حاول مرة أخرى.<button class="gold-button" id="retryPage">إعادة المحاولة</button></div>';
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
mushafPaper.addEventListener('touchend',event=>{if(!touchStart||!event.changedTouches.length)return;const touch=event.changedTouches[0],dx=touch.clientX-touchStart.x,dy=touch.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25)setPage(page+(dx<0?1:-1))},{passive:true});
document.addEventListener('keydown',event=>{if(document.getElementById('view-quran').classList.contains('active')&&!pagePicker.open&&!surahPicker.open){if(event.key==='ArrowLeft')setPage(page+1);if(event.key==='ArrowRight')setPage(page-1)}});

const today=new Date();const dateText=new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(today);
document.querySelectorAll('#todayDate,#todayDate2').forEach(node=>node.textContent=dateText);

const locations={cairo:{lat:30.0444,lon:31.2357,name:'القاهرة'}};
let userLocation={...locations.cairo,name:`${locations.cairo.name} (افتراضي)`};
try{const saved=JSON.parse(readStore('rattil-location','null'));if(saved&&Number.isFinite(saved.lat)&&Number.isFinite(saved.lon))userLocation=saved}catch{}
function setLocationLabels(){document.getElementById('locationLabel').textContent=`${userLocation.name} · حساب محلي`;document.getElementById('settingsLocationLabel').textContent=`${userLocation.name} · اضغط لتغيير الموقع`;document.getElementById('prayerMethodNote').textContent=`طريقة الحساب المصرية · ${userLocation.name}`}
function prayerTimesFor(date){const coordinates=new adhan.Coordinates(userLocation.lat,userLocation.lon);const params=adhan.CalculationMethod.Egyptian();params.madhab=adhan.Madhab.Shafi;return new adhan.PrayerTimes(coordinates,date,params)}
const prayerNames={fajr:'الفجر',sunrise:'الشروق',dhuhr:'الظهر',asr:'العصر',maghrib:'المغرب',isha:'العشاء'};
function formatTime(date){return new Intl.DateTimeFormat('ar-EG',{hour:'numeric',minute:'2-digit',hour12:true}).format(date)}
let nextPrayerAt=null;
function updatePrayerCountdown(){
  if(!nextPrayerAt)return;
  const seconds=Math.max(0,Math.floor((nextPrayerAt-new Date())/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),remaining=seconds%60;
  document.getElementById('prayerCountdown').textContent=[hours,minutes,remaining].map(value=>String(value).padStart(2,'0')).map(toArabic).join(':');
}
function updatePrayerTimes(){
  try{
    const now=new Date(),times=prayerTimesFor(now),rows=Object.entries(prayerNames).map(([key,name])=>({key,name,time:times[key]}));
    const list=document.getElementById('prayerTimesList');list.replaceChildren();
    rows.forEach(row=>{const line=document.createElement('div');line.className='prayer-time-row';line.dataset.prayer=row.key;const name=document.createElement('span');name.textContent=row.name;const time=document.createElement('strong');time.textContent=formatTime(row.time);line.append(name,time);list.append(line)});
    let next=rows.filter(row=>row.key!=='sunrise'&&row.time>now)[0];let nextAt=next?.time;
    if(!next){next={key:'fajr',name:prayerNames.fajr};const tomorrow=new Date(now);tomorrow.setDate(now.getDate()+1);nextAt=prayerTimesFor(tomorrow).fajr}
    document.getElementById('nextPrayerName').textContent=next.name;
    list.querySelector(`[data-prayer="${next.key}"]`)?.classList.add('next-prayer');
    nextPrayerAt=nextAt;updatePrayerCountdown();
  }catch{document.getElementById('prayerCountdown').textContent='—';document.getElementById('prayerTimesList').textContent='تعذّر حساب المواقيت على هذا الجهاز.'}
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
