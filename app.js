const views=[...document.querySelectorAll('.view')];
const navButtons=[...document.querySelectorAll('[data-view]')];
const toast=document.getElementById('toast');
let toastTimer;
function announce(message){toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),2600)}
function showView(name){
  const target=document.getElementById(`view-${name}`);
  if(!target)return;
  views.forEach(view=>view.classList.toggle('active',view===target));
  document.querySelectorAll('.tabbar [data-view]').forEach(button=>{
    const active=button.dataset.view===name;
    button.classList.toggle('active',active);
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  document.title=`رتل — ${target.dataset.title||'رفيقك مع القرآن'}`;
  document.getElementById('mainContent').focus({preventScroll:true});
  window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
navButtons.forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));

const modeButtons=[...document.querySelectorAll('[data-mode]')];
modeButtons.forEach(button=>button.addEventListener('click',()=>{
  const review=button.dataset.mode==='review';
  modeButtons.forEach(tab=>{const active=tab===button;tab.classList.toggle('selected',active);tab.setAttribute('aria-selected',String(active))});
  document.getElementById('followPanel').hidden=review;
  document.getElementById('reviewPanel').hidden=!review;
}));

document.getElementById('startFollow').addEventListener('click',()=>announce('دي معاينة تصميم فقط؛ الميكروفون والتعرّف مش موصولين بعد.'));
document.getElementById('startReview').addEventListener('click',()=>announce('معاينة المراجعة جاهزة؛ محرك التسميع لم يُربط بعد.'));

let page=42;
const toArabic=value=>String(value).replace(/[0-9]/g,d=>'٠١٢٣٤٥٦٧٨٩'[Number(d)]);
function setPage(next){page=Math.max(1,Math.min(604,next));document.getElementById('pageNumber').textContent=toArabic(page);document.getElementById('pageNumberBottom').textContent=toArabic(page)}
document.getElementById('previousPage').addEventListener('click',()=>setPage(page-1));
document.getElementById('nextPage').addEventListener('click',()=>setPage(page+1));
document.getElementById('bookmarkButton').addEventListener('click',event=>{event.currentTarget.classList.toggle('saved');announce(event.currentTarget.classList.contains('saved')?'اتحفظت علامة الصفحة':'اتشالت علامة الصفحة')});
document.getElementById('indexButton').addEventListener('click',()=>announce('فهرس السور هيتربط بمصدر المصحف المعتمد.'));
document.getElementById('themeToggle').addEventListener('click',()=>{document.body.classList.toggle('light');localStorage.setItem('rattil-theme',document.body.classList.contains('light')?'light':'night')});
if(localStorage.getItem('rattil-theme')==='light')document.body.classList.add('light');
document.getElementById('locationButton').addEventListener('click',()=>announce('الموقع ومواقيت الصلاة الفعلية لسه مش متوصلين.'));
document.getElementById('offlineButton').addEventListener('click',()=>announce('واجهة رتل بتتحفظ بعد أول زيارة؛ محتوى المصحف لسه غير مرفق.'));
document.getElementById('bookmarkButton').classList.toggle('saved',localStorage.getItem('rattil-bookmarked')==='true');
document.getElementById('bookmarkButton').addEventListener('click',()=>localStorage.setItem('rattil-bookmarked',String(document.getElementById('bookmarkButton').classList.contains('saved'))));

const today=new Date();
const dateText=new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(today);
document.querySelectorAll('#todayDate,#todayDate2').forEach(node=>node.textContent=dateText);

let deferredInstall;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;document.getElementById('installButton').hidden=false});
document.getElementById('installButton').addEventListener('click',async()=>{if(!deferredInstall){announce('من Safari اختار مشاركة ثم إضافة إلى الشاشة الرئيسية.');return}deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null});
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(()=>{});

// Prayer values are illustrative until a location and calculation method are selected.
