(() => {
const API='https://api.alquran.cloud/v1', $=id=>document.getElementById(id);
const views={mushaf:'mushafView',memorize:'memorizeView',recite:'reciteView',achievements:'achievementsView',settings:'settingsView',qibla:'qiblaView',adhkar:'adhkarView'};
// ASR state is initialized before any UI event can invoke its handlers.
let asrWorker=null,asrReady=false,activeReciteSurah=0,liveAudioContext=null,liveMediaStream=null,liveSource=null,liveProcessor=null,liveSamples=new Float32Array(0),liveLastVerse=null,liveCurrentVerse=null;
$('loadAsr').addEventListener('click',loadAsr);
let currentScreen='home';

function updateRattilSky(){
 const h=new Date().getHours(),b=document.body;
 b.classList.remove('sky-dawn','sky-day','sky-sunset','sky-night');
 const phase=h>=5&&h<8?'sky-dawn':h>=8&&h<16?'sky-day':h>=16&&h<19?'sky-sunset':'sky-night';
 b.classList.add(phase);
 const greeting=$('rattilGreetingDate');
 if(greeting)greeting.textContent=new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
}
updateRattilSky();setInterval(updateRattilSky,60000);

function renderScreen(name){
 currentScreen=views[name]?name:'home';
 const isHome=currentScreen==='home';
 $('homeView').hidden=!isHome;
 document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',!isHome&&v.id===views[currentScreen]));
 document.body.classList.toggle('screen-open',!isHome);
 window.scrollTo({top:0,behavior:'instant'});
}
function navigate(name){
 if(!views[name])return;
 history.pushState({rattilScreen:name},'', '#'+name);
 renderScreen(name);
}
function goBack(){
 if(currentScreen==='home')return;
 if(history.state?.rattilScreen){history.back();return;}
 renderScreen('home');
}
document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const key=a.getAttribute('href').slice(1);navigate(key);}));
document.querySelectorAll('[data-navigate]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.navigate)));
$('openSettings').addEventListener('click',()=>navigate('settings'));
document.querySelectorAll('[data-home]').forEach(b=>b.addEventListener('click',()=>goBack()));
window.addEventListener('popstate',e=>renderScreen(e.state?.rattilScreen||'home'));
$('prayerCountdown').addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
// iOS-style edge swipe: start within the left 28px, finish with a deliberate rightward drag.
let touchStart=null;
document.addEventListener('touchstart',e=>{if(currentScreen!=='home'&&e.touches.length===1&&e.touches[0].clientX<=28)touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
document.addEventListener('touchend',e=>{if(!touchStart)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=Math.abs(t.clientY-touchStart.y);if(dx>85&&dy<90)goBack();touchStart=null;},{passive:true});
renderScreen(location.hash.slice(1));
async function json(url){const r=await fetch(url);if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.code!==200)throw Error(j.status||'API error');return j.data;}let activeMushafPage=1,selectedVerseKey=null,surahCatalog=[],pageTurnLock=false;
function applyTheme(mode){const m=["auto","dark","light"].includes(mode)?mode:"auto";localStorage.setItem("rattil-theme",m);document.body.dataset.theme=m==="auto"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):m;document.querySelectorAll("[data-theme-choice]").forEach(b=>b.classList.toggle("selected",b.dataset.themeChoice===m));const status=$("themeStatus");if(status)status.textContent="المظهر الحالي: "+({auto:"تلقائي حسب إعدادات الجهاز",light:"نهاري",dark:"ليلي"}[m]);}
applyTheme(localStorage.getItem("rattil-theme")||"auto");
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if((localStorage.getItem("rattil-theme")||"auto")==="auto")applyTheme("auto");});
document.querySelectorAll("[data-theme-choice]").forEach(b=>b.addEventListener("click",()=>applyTheme(b.dataset.themeChoice)));
const pageMetaCache=new Map(),pageSvgCache=new Map(),surahDataCache=new Map();
let readerReturnScreen="mushaf";
function showReader(){ $("mushafReader").hidden=false; document.body.classList.add("reader-open"); }
function closeReader(){ $("mushafReader").hidden=true; $("readerIndexPanel").hidden=true; $("selectedAyahPanel").hidden=true; document.body.classList.remove("reader-open"); }
function getPageMeta(page){if(!pageMetaCache.has(page))pageMetaCache.set(page,json(API+"/page/"+page+"/quran-uthmani"));return pageMetaCache.get(page);}
function getPageSvg(page){if(!pageSvgCache.has(page))pageSvgCache.set(page,fetch("https://cdn.quran.ws/svg/pages/v1.1.1/hafs-kfqc/"+String(page).padStart(3,"0")+".svg").then(r=>{if(!r.ok)throw Error("SVG HTTP "+r.status);return r.text();}));return pageSvgCache.get(page);}
function verseKey(ayah){return ayah.surah.number+":"+ayah.numberInSurah;}
function renderReaderMeta(data){const a=data.ayahs?.[0];if(!a)throw Error("Empty Mushaf page");$("readerSurah").textContent=a.surah.name;$("readerSurahName").textContent=a.surah.name;$("readerJuz").textContent="الجزء "+(a.juz||"—");$("readerHizb").textContent="الحزب "+(a.hizbQuarter||"—");$("readerPageNumber").textContent=activeMushafPage;}
$('homeOpenIndex').addEventListener('click',()=>{navigate('mushaf');$('openSurahIndex').click();});
$('resumeReading').addEventListener('click',async()=>{navigate('mushaf');const key=localStorage.getItem('rattil-last-ayah')||'';const savedPage=Number(localStorage.getItem('rattil-last-page')||0);if(savedPage>0)await openMushafPage(savedPage,key||null);else $('openSurahIndex').click();});
const lastReadLabel=$('lastReadLabel');if(lastReadLabel){const last=localStorage.getItem('rattil-last-ayah');lastReadLabel.textContent=last?'آخر موضع: '+last.replace(':',' · الآية '):'افتح المصحف وابدأ من اختيارك';}
function selectReaderAyah(key,meta,poly){selectedVerseKey=key;const [sn,an]=key.split(":").map(Number);const ayah=meta.ayahs.find(a=>a.surah.number===sn&&a.numberInSurah===an);const panel=$("selectedAyahPanel");if(ayah){panel.innerHTML="<strong>"+ayah.surah.name+" · الآية "+an+"</strong><div>"+ayah.text+"</div>";panel.hidden=false;localStorage.setItem("rattil-last-ayah",key);}const root=$("readerAyahs").querySelector("svg");root?.querySelectorAll(".ayahPolygon").forEach(p=>p.setAttribute("fill-opacity",p===poly?"0.42":"0"));}
async function openMushafPage(page,key,direction){const target=Math.max(1,Math.min(604,+page||1));if(pageTurnLock)return;pageTurnLock=true;activeMushafPage=target;if(key)selectedVerseKey=key;showReader();$("readerAyahs").setAttribute("aria-busy","true");$("readerPageNumber").textContent=target;try{const [meta,svgText]=await Promise.all([getPageMeta(target),getPageSvg(target)]);if(activeMushafPage!==target)return;const parsed=new DOMParser().parseFromString(svgText,"image/svg+xml");if(parsed.querySelector("parsererror")||parsed.documentElement.localName!=="svg")throw Error("Invalid page SVG");parsed.querySelectorAll("script,foreignObject").forEach(n=>n.remove());parsed.querySelectorAll("*").forEach(n=>[...n.attributes].forEach(a=>{if(/^on/i.test(a.name))n.removeAttribute(a.name);}));const host=$("readerAyahs");host.replaceChildren(document.importNode(parsed.documentElement,true));const root=host.querySelector("svg");root.setAttribute("preserveAspectRatio","xMidYMid meet");root.setAttribute("role","img");root.setAttribute("aria-label","صفحة المصحف رقم "+target);root.style.cssText="display:block;width:100%;height:100%;max-width:100%;background:var(--mushaf-page)";root.querySelectorAll("#content path:not(.ayahPolygon),#ayah_markers path:not(.ayahPolygon)").forEach(p=>p.style.setProperty("fill","var(--mushaf-ink)","important"));const content=root.querySelector("#content");if(content)content.style.pointerEvents="none";root.querySelectorAll(".ayahPolygon").forEach(poly=>{poly.style.pointerEvents="all";poly.style.cursor="pointer";poly.setAttribute("fill","#d9b65e");poly.setAttribute("fill-opacity","0");poly.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();const sn=Number(poly.getAttribute("surah")),an=Number(poly.getAttribute("ayah"));if(sn&&an)selectReaderAyah(sn+":"+an,meta,poly);});});renderReaderMeta(meta);if(selectedVerseKey){const [sn,an]=selectedVerseKey.split(":").map(Number);const hit=[...root.querySelectorAll(".ayahPolygon")].find(p=>Number(p.getAttribute("surah"))===sn&&Number(p.getAttribute("ayah"))===an);if(hit)selectReaderAyah(selectedVerseKey,meta,hit);}else $("selectedAyahPanel").hidden=true;localStorage.setItem("rattil-last-page",target);$("mushafPaper").classList.remove("page-turn-next","page-turn-prev");void $("mushafPaper").offsetWidth;if(direction)$("mushafPaper").classList.add(direction==="next"?"page-turn-next":"page-turn-prev");}catch(e){$("readerAyahs").textContent="تعذر تحميل صفحة المصحف. تحقق من الاتصال وحاول مرة أخرى.";$("readerPageNumber").textContent=target;console.error(e);}finally{$("readerAyahs").removeAttribute("aria-busy");pageTurnLock=false;}}
$("closeMushafReader").onclick=closeReader;
$("previousMushafPage").onclick=()=>openMushafPage(activeMushafPage-1,null,"prev");
$("nextMushafPage").onclick=()=>openMushafPage(activeMushafPage+1,null,"next");
const paper=$("mushafPaper");let swipeStart=null;
paper.addEventListener("touchstart",e=>{if(e.touches.length===1)swipeStart={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
paper.addEventListener("touchend",e=>{if(!swipeStart)return;const t=e.changedTouches[0],dx=t.clientX-swipeStart.x,dy=Math.abs(t.clientY-swipeStart.y);swipeStart=null;if(Math.abs(dx)>55&&Math.abs(dx)>dy*1.2)openMushafPage(activeMushafPage+(dx>0?1:-1),null,dx>0?"next":"prev");},{passive:true});
$("openSurahIndex").onclick=async()=>{showReader();$("readerIndexPanel").hidden=false;const host=$("readerSurahList");host.textContent="جارٍ تحميل فهرس السور…";try{if(!surahCatalog.length)await loadChapters();populateReciteSurahs();renderReaderSurahIndex();}catch(e){host.textContent="تعذر تحميل الفهرس. تحقق من الاتصال.";console.error(e);}};
$("readerOpenIndex").onclick=()=>$("openSurahIndex").click();
function renderReaderSurahIndex(filter=""){const host=$("readerSurahList");host.replaceChildren();surahCatalog.filter(s=>(s.name+" "+s.number+" "+s.englishName).toLowerCase().includes(filter.toLowerCase())).forEach(s=>{const b=document.createElement("button");b.type="button";b.className="reader-surah-row";b.innerHTML="<span class='reader-surah-number'>"+s.number+"</span><span class='reader-surah-name'>"+s.name+"</span><small>"+s.numberOfAyahs+" آية</small>";b.onclick=async()=>{b.disabled=true;try{if(!surahDataCache.has(s.number))surahDataCache.set(s.number,json(API+"/surah/"+s.number+"/quran-uthmani"));const data=await surahDataCache.get(s.number);const first=data.ayahs[0];$("readerIndexPanel").hidden=true;$("surahSelect").value=String(s.number);selectedVerseKey=s.number+":1";await openMushafPage(first.page||1,selectedVerseKey);}catch(e){b.disabled=false;host.insertAdjacentText("afterbegin","تعذر فتح السورة. حاول مرة أخرى. ");console.error(e);}};host.append(b);});}
$("readerSurahSearch").addEventListener("input",e=>renderReaderSurahIndex(e.target.value));
$("closeReaderIndex").onclick=()=>$("readerIndexPanel").hidden=true;
function opt(s){return '<option value="'+s.number+'">'+s.number+'. '+s.name+' — '+s.englishName+'</option>';}
function populateReciteSurahs(){
 const host=$('reciteSurahIndexList');if(!host||!surahCatalog.length)return;
 const filter=$('reciteSurahSearchInput')?.value||'';
 host.replaceChildren();
 surahCatalog.filter(s=>(s.name+' '+s.number+' '+s.englishName).toLowerCase().includes(filter.toLowerCase())).forEach(s=>{
  const b=document.createElement('button');b.type='button';b.className='recite-surah-index-item';
  const n=document.createElement('span');n.className='surah-index-number';n.textContent=s.number;
  const label=document.createElement('span');const title=document.createElement('strong');title.textContent=s.name;const meta=document.createElement('small');meta.textContent=s.numberOfAyahs+' آية';label.append(title,meta);b.append(n,label);
  b.addEventListener('click',()=>openRecitationSurah(s));host.append(b);
 });
}
async function openRecitationSurah(s){
 const host=$('liveRecitationText');$('reciteIndexPanel').hidden=true;$('reciteReaderPanel').hidden=false;
 $('reciteCurrentSurahName').textContent=s.name;$('reciteCurrentSurahMeta').textContent=s.numberOfAyahs+' آية';
 $('reciteBottomStatus').textContent='تحميل آيات '+s.name+'…';
 host.replaceChildren();host.textContent='جارٍ تحميل الآيات…';
 try{
  if(!surahDataCache.has(s.number))surahDataCache.set(s.number,json(API+'/surah/'+s.number+'/quran-uthmani'));
  const data=await surahDataCache.get(s.number);
  activeReciteSurah=s.number;$('startRec').disabled=!asrReady;
  if(asrWorker)asrWorker.postMessage({type:'set_expected',passage:{surah:s.number,ayah:1,ayahEnd:s.numberOfAyahs}});
  host.replaceChildren();
  data.ayahs.forEach(a=>{
   const article=document.createElement('article');article.className='recite-ayah';article.dataset.recitationAyah=s.number+':'+a.numberInSurah;
   const text=document.createElement('span');text.className='recite-ayah-text';
   String(a.text||'').split(/\s+/).filter(Boolean).forEach((word,i)=>{const span=document.createElement('span');span.className='recite-word unattempted';span.textContent=word+' ';span.dataset.wordIndex=i;text.append(span);});
   const marker=document.createElement('span');marker.className='recite-ayah-number';marker.textContent=a.numberInSurah;marker.setAttribute('aria-label','الآية '+a.numberInSurah);
   article.append(text,marker);host.append(article);
  });
  $('reciteBottomStatus').textContent='جاهز للتسميع · '+s.name;
  $('asrResult').textContent='ابدأ القراءة، وسيتم تمييز الآية والكلمات التي يتعرف عليها المحرك.';
  localStorage.setItem('rattil-last-surah',String(s.number));
 }catch(e){host.textContent='تعذر تحميل آيات السورة. تحقق من الاتصال وحاول مرة أخرى.';$('reciteBottomStatus').textContent='تعذر تحميل السورة';console.error(e);}
}
$('reciteSurahSearchInput').addEventListener('input',populateReciteSurahs);
$('reciteBackToIndex').addEventListener('click',()=>{$('reciteReaderPanel').hidden=true;$('reciteIndexPanel').hidden=false;});

async function loadChapters(){try{const list=await json(API+'/surah');if(!Array.isArray(list)||list.length!==114)throw Error("Expected all 114 surahs");surahCatalog=list;['surahSelect','memorizeSurah'].forEach(id=>$(id).innerHTML=list.map(opt).join(''));$('surahMeta').textContent='114 سورة • النص بالرسم العثماني';return list;}catch(e){$('quranContent').textContent='تعذر تحميل قائمة السور كاملة. تحقق من الاتصال ثم أعد المحاولة.';throw e;}}
async function loadSurah(){const n=$('surahSelect').value;if(!n)return;const out=$('quranContent');out.className='empty';out.textContent='جارٍ تحميل السورة…';try{const [textVerses,tafsirVerses]=await Promise.all([json(API+'/surah/'+n+'/quran-uthmani'),json(API+'/surah/'+n+'/ar.muyassar').catch(()=>null)]);out.className='';$('surahMeta').textContent=textVerses.name+' • '+textVerses.englishName+' • '+textVerses.numberOfAyahs+' آية';out.innerHTML=textVerses.ayahs.map((a,i)=>{const taf=tafsirVerses?.ayahs?.[i]?.text;return '<article class="ayah"><div class="ayahText" role="button" tabindex="0" data-open-page="'+(a.page||1)+'" data-verse-key="'+n+':'+a.numberInSurah+'">'+a.text+' <span class="ayahNum">'+a.numberInSurah+'</span></div><div class="ayahActions"><button type="button" data-tafsir="'+i+'">التفسير الميسر</button><button type="button" data-bookmark="'+a.number+'">حفظ علامة</button></div><div class="verseTafsir" id="tafsir-'+i+'" hidden>'+(taf?taf.replace(/</g,'&lt;'):'التفسير الميسر غير متاح حاليًا لهذه الآية من المصدر.')+'</div></article>';}).join('');out.querySelectorAll('[data-tafsir]').forEach(b=>b.addEventListener('click',()=>{const el=$('tafsir-'+b.dataset.tafsir);el.hidden=!el.hidden;}));out.querySelectorAll('[data-open-page]').forEach(el=>{const go=()=>openMushafPage(el.dataset.openPage,el.dataset.verseKey);el.onclick=go;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}};});out.querySelectorAll('[data-bookmark]').forEach(b=>b.addEventListener('click',()=>{
 const globalAyah=+b.dataset.bookmark,localAyah=+b.closest('.ayah').querySelector('.ayahNum').textContent;
 const items=getBookmarks(),id=n+':'+localAyah;
 if(items.some(x=>x.id===id)){b.textContent='محفوظة ✓';return;}
 const surahName=$('surahSelect').selectedOptions[0]?.textContent?.split(' — ')[0]||('السورة '+n);
 items.push({id,surah:+n,ayah:localAyah,globalAyah,surahName,savedAt:Date.now()});
 localStorage.setItem(BOOKMARKS_KEY,JSON.stringify(items));b.textContent='تم الحفظ ✓';renderBookmarks();stats();
}));localStorage.setItem('rattil-last-surah',n);}catch(e){out.className='empty';out.textContent='تعذر تحميل السورة أو التفسير. حاول مرة أخرى عند توفر الإنترنت.';}}
$('loadSurahText').addEventListener('click',loadSurah);
$("loadSurah").addEventListener("click",async()=>{const n=Number($("surahSelect").value);if(!n)return;try{if(!surahDataCache.has(n))surahDataCache.set(n,json(API+"/surah/"+n+"/quran-uthmani"));const d=await surahDataCache.get(n);await openMushafPage(d.ayahs[0].page||1,n+":1");}catch(e){console.error(e);$("surahMeta").textContent="تعذر فتح السورة. تحقق من الاتصال.";}});
$('savePlan').addEventListener('click',()=>{const p={surah:+$('memorizeSurah').value,from:+$('memorizeFrom').value,to:+$('memorizeTo').value};if(!p.surah||p.from<1||p.to<p.from){$('planStatus').textContent='راجع أرقام السورة والآيات.';return;}localStorage.setItem('rattil-plan',JSON.stringify(p));$('planStatus').textContent='تم حفظ خطة الحفظ على هذا الجهاز. السورة '+p.surah+'، من الآية '+p.from+' إلى '+p.to+'.';});
const BOOKMARKS_KEY='rattil-bookmarks-v1';
function getBookmarks(){
 try{
  const saved=JSON.parse(localStorage.getItem(BOOKMARKS_KEY)||'[]');
  if(Array.isArray(saved))return saved;
  return [];
 }catch{return [];}
}
function saveBookmarks(items){localStorage.setItem(BOOKMARKS_KEY,JSON.stringify(items));renderBookmarks();stats();}
function renderBookmarks(){
 const host=$('bookmarkList');if(!host)return;
 const items=getBookmarks();
 if(!items.length){host.textContent='لا توجد علامات محفوظة بعد.';return;}
 host.innerHTML='';
 items.slice().reverse().forEach(item=>{
  const row=document.createElement('div');row.className='bookmark-item';
  const label=document.createElement('span');label.textContent=(item.surahName||('السورة '+item.surah))+' — الآية '+item.ayah;
  const actions=document.createElement('span');
  const open=document.createElement('button');open.textContent='فتح';open.addEventListener('click',async()=>{ $('surahSelect').value=String(item.surah);await loadSurah();const target=document.querySelector('[data-bookmark="'+item.globalAyah+'"]');target?.scrollIntoView({behavior:'smooth',block:'center'});});
  const remove=document.createElement('button');remove.className='remove-bookmark';remove.textContent='حذف';remove.addEventListener('click',()=>saveBookmarks(getBookmarks().filter(x=>x.id!==item.id)));
  actions.append(open,remove);row.append(label,actions);host.append(row);
 });
}
function stats(){
 const p=JSON.parse(localStorage.getItem('rattil-plan')||'null');
 const b=getBookmarks();
 $('achievementStats').textContent='خطة الحفظ: '+(p?'السورة '+p.surah+'، الآيات '+p.from+'–'+p.to:'لم تُحدد بعد')+' • العلامات المحفوظة: '+b.length;
}
loadChapters().then(populateReciteSurahs);renderBookmarks();stats();

 // Prayer times use the saved coordinates and an explicit calculation method.
 const prayerNames=[['Fajr','الفجر','☼'],['Sunrise','الشروق','☼'],['Dhuhr','الظهر','☀'],['Asr','العصر','◉'],['Maghrib','المغرب','☼'],['Isha','العشاء','☾']];
 const prayerMethods={5:'الهيئة المصرية العامة للمساحة',3:'رابطة العالم الإسلامي',4:'أم القرى — مكة',1:'جامعة العلوم الإسلامية — كراتشي',2:'الجمعية الإسلامية لأمريكا الشمالية'};
 const prayerLocationKey='rattil-prayer-location-v1',prayerMethodKey='rattil-prayer-method-v1';
 const defaultPrayerLocation={name:'القاهرة',latitude:30.0444,longitude:31.2357};
 function validPrayerLocation(value){return value&&typeof value.name==='string'&&value.name.trim()&&Number.isFinite(Number(value.latitude))&&Math.abs(Number(value.latitude))<=90&&Number.isFinite(Number(value.longitude))&&Math.abs(Number(value.longitude))<=180;}
 let prayerLocation=defaultPrayerLocation;
 try{const saved=JSON.parse(localStorage.getItem(prayerLocationKey)||'null');if(validPrayerLocation(saved))prayerLocation={...saved,name:saved.name.trim(),latitude:Number(saved.latitude),longitude:Number(saved.longitude)};}catch{}
 let prayerMethod=Number(localStorage.getItem(prayerMethodKey));if(!prayerMethods[prayerMethod])prayerMethod=5;
 $('prayerLocationName').textContent=prayerLocation.name;$('prayerLocationLabel').value=prayerLocation.name;$('prayerLatitude').value=prayerLocation.latitude;$('prayerLongitude').value=prayerLocation.longitude;$('prayerMethod').value=String(prayerMethod);
 let prayerDayOffset=0,prayerSchedule=null,prayerTick=null,prayerTimeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const dateLabel=d=>new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate(),12)));
 const prayerDateForZone=(zone,offset=0)=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));return new Date(parts.year,parts.month-1,parts.day+offset);};
 function setPrayerLocation(value){prayerDayOffset=0;prayerLocation=value;localStorage.setItem(prayerLocationKey,JSON.stringify(value));$('prayerLocationName').textContent=value.name;$('prayerLocationLabel').value=value.name;$('prayerLatitude').value=value.latitude;$('prayerLongitude').value=value.longitude;loadPrayerTimes();}
 $('editPrayerLocation').addEventListener('click',()=>{const form=$('prayerLocationEditor');form.hidden=!form.hidden;$('editPrayerLocation').setAttribute('aria-expanded',String(!form.hidden));});
 $('cancelPrayerLocation').addEventListener('click',()=>{$('prayerLocationEditor').hidden=true;$('editPrayerLocation').setAttribute('aria-expanded','false');$('prayerLocationLabel').value=prayerLocation.name;$('prayerLatitude').value=prayerLocation.latitude;$('prayerLongitude').value=prayerLocation.longitude;$('prayerMethod').value=String(prayerMethod);});
 $('prayerLocationEditor').addEventListener('submit',event=>{event.preventDefault();const value={name:$('prayerLocationLabel').value.trim(),latitude:Number($('prayerLatitude').value),longitude:Number($('prayerLongitude').value)};if(!validPrayerLocation(value)){$('prayerLocationLabel').reportValidity();return;}prayerMethod=Number($('prayerMethod').value);localStorage.setItem(prayerMethodKey,String(prayerMethod));$('prayerLocationEditor').hidden=true;$('editPrayerLocation').setAttribute('aria-expanded','false');setPrayerLocation(value);});
 $('usePrayerLocation').addEventListener('click',()=>{const button=$('usePrayerLocation');if(!navigator.geolocation){$('nextPrayer').textContent='تحديد الموقع غير مدعوم؛ أدخل الإحداثيات يدويًا.';$('prayerLocationEditor').hidden=false;return;}button.disabled=true;button.textContent='جارٍ التحديد…';navigator.geolocation.getCurrentPosition(pos=>{button.disabled=false;button.textContent='موقعي الحالي';setPrayerLocation({name:'موقعي الحالي',latitude:Number(pos.coords.latitude.toFixed(5)),longitude:Number(pos.coords.longitude.toFixed(5))});},err=>{button.disabled=false;button.textContent='موقعي الحالي';$('nextPrayer').textContent=err.code===1?'لم يُسمح بتحديد الموقع؛ أدخل الإحداثيات يدويًا.':'تعذر تحديد الموقع؛ أدخل الإحداثيات يدويًا.';$('prayerLocationEditor').hidden=false;$('editPrayerLocation').setAttribute('aria-expanded','true');},{enableHighAccuracy:true,timeout:12000,maximumAge:300000});});
 async function loadPrayerTimes(){
  const d=prayerDateForZone(prayerTimeZone,prayerDayOffset),ds=[String(d.getDate()).padStart(2,'0'),String(d.getMonth()+1).padStart(2,'0'),d.getFullYear()].join('-');
  $('date').textContent=dateLabel(d);
  const grid=$('prayerTimes'); if(grid)grid.querySelectorAll('b').forEach(x=>x.textContent='…');
  try{
   const url='https://api.aladhan.com/v1/timings/'+ds+'?latitude='+encodeURIComponent(prayerLocation.latitude)+'&longitude='+encodeURIComponent(prayerLocation.longitude)+'&method='+prayerMethod;
   const res=await fetch(url);if(!res.ok)throw Error('HTTP '+res.status);
   const payload=await res.json();if(payload.code!==200)throw Error('Prayer API unavailable');
   prayerSchedule=payload.data.timings;
   prayerTimeZone=payload.data.meta?.timezone||prayerTimeZone;
   $('date').textContent=dateLabel(d);
   prayerNames.forEach(([key,label],i)=>{const el=$('prayer-'+key);if(el)el.textContent=String(prayerSchedule[key]||'--:--').slice(0,5);});
   $('prayerSource').textContent='طريقة الحساب: '+(prayerMethods[prayerMethod]||'طريقة مخصصة');
   updatePrayerCountdown();
  }catch(e){
   prayerSchedule=null;$('prayerSource').textContent='تعذر تحميل المواقيت — تحقق من الاتصال وحاول تحديث الصفحة';
   $('nextPrayer').textContent='مواقيت الصلاة غير متاحة';$('prayerCountdown').textContent='--:--:--';
  }
 }
 function updatePrayerCountdown(){
  if(!prayerSchedule)return;
  const now=new Date(),keys=['Fajr','Dhuhr','Asr','Maghrib','Isha'];
  const localParts=(date)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:prayerTimeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const wallTime=(base,hh,mm,dayOffset=0)=>{const dayUtc=Date.UTC(base.year,base.month-1,base.day+dayOffset),target=dayUtc+hh*3600000+mm*60000;let guess=target;for(let n=0;n<2;n++){const observed=localParts(new Date(guess)),observedWall=Date.UTC(observed.year,observed.month-1,observed.day);guess+=target-(observedWall+observed.hour*3600000+observed.minute*60000);}return new Date(guess);};
  const today=localParts(now);
  let upcoming=null,upcomingAt=null,previous=null;
  for(const key of keys){
   const [hh,mm]=String(prayerSchedule[key]).split(':').map(Number);
   const at=wallTime(today,hh,mm);
   if(at>now&&!upcoming){upcoming=key;upcomingAt=at;}
   if(at<=now)previous=key;
  }
  if(!upcoming){upcoming='Fajr';const [hh,mm]=String(prayerSchedule.Fajr).split(':').map(Number);upcomingAt=wallTime(today,hh,mm,1);}
  const label=prayerNames.find(x=>x[0]===upcoming)?.[1]||'الفجر';
  $('nextPrayer').textContent='الصلاة القادمة: '+label;
  const secs=Math.max(0,Math.floor((upcomingAt-now)/1000)),h=Math.floor(secs/3600),m=Math.floor(secs%3600/60),s=secs%60;
  $('prayerCountdown').textContent=[h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
  $('previousPrayer').textContent=previous?prayerNames.find(x=>x[0]===previous)[1]:'—';
  $('upcomingPrayer').textContent=label;
  const activeKey=upcoming;
  prayerNames.forEach(([key])=>{const el=$('prayer-'+key)?.closest('.time');if(el)el.classList.toggle('active',key===activeKey);});
 }
 $('previousDate').addEventListener('click',()=>{prayerDayOffset--;loadPrayerTimes();});
 $('nextDate').addEventListener('click',()=>{prayerDayOffset++;loadPrayerTimes();});
 loadPrayerTimes();prayerTick=setInterval(updatePrayerCountdown,1000);


// Local-only streaming ASR. ONNX runs in a dedicated module worker.
function asrStatus(s){$('asrStatus').textContent=s;}
function renderLiveVerse(msg){
 const host=$('liveRecitationText');if(!host)return;
 if(msg.type==='correction'){
  const state=msg.state||{},issue=state.issue,panel=$('reciteCorrectionPanel');
  if(issue){
   const verse=host.querySelector('[data-recitation-ayah="'+issue.surah+':'+issue.ayah+'"]');
   const allWords=verse?.querySelectorAll('[data-word-index]')||[];
   const start=Math.max(0,Number(issue.word)||0),count=Number(issue.words)||1;
   const kind=issue.kind||'possible_substitution';
   const labels={possible_omission:'احتمال كلمة لم تُقرأ',possible_substitution:'احتمال اختلاف في الكلمة',possible_vowel:'اختلاف محتمل في الحركة',possible_repetition:'احتمال تكرار كلمة',possible_skipped_ayah:'احتمال تخطي آية',unclear_ayah:'لم يستطع المحرك متابعة الآية'};
   const uncertain=['possible_vowel','possible_repetition','unclear_ayah'].includes(kind);
   const targets=['possible_skipped_ayah','unclear_ayah'].includes(kind)?allWords:[...allWords].slice(start,start+count);
   targets.forEach(word=>{word.classList.add('revealed',uncertain?'uncertain':'error');word.classList.remove(uncertain?'error':'correct');word.classList.remove('unattempted');word.setAttribute('aria-label',labels[kind]+' — راجعها');});
   if(verse)verse.scrollIntoView({behavior:'smooth',block:'center'});
   $('reciteCorrectionTitle').textContent=labels[kind]||'موضع يحتاج مراجعة';
   $('reciteCorrectionText').textContent='رصد المحرك احتمالًا يحتاج مراجعة في الآية '+issue.ayah+'. قد لا يكون الحكم صحيحًا دائمًا، ولا يقيّم هذا حكم التجويد.';
   panel.hidden=!['error','retrying'].includes(state.phase);
   panel.querySelectorAll('[data-correction-action]').forEach(button=>{button.hidden=state.phase==='retrying'?button.dataset.correctionAction!=='stop_retry':button.dataset.correctionAction==='stop_retry';});
   if(state.phase==='retrying')$('reciteCorrectionText').textContent='أعد قراءة المقطع المحدد؛ يراجع المحرك هذه المحاولة الآن.';
   if(state.phase==='corrected'){$('reciteCorrectionText').textContent='انتهت مراجعة هذا الموضع.';targets.forEach(word=>{word.classList.remove('error','uncertain');word.classList.add('correct');word.removeAttribute('aria-label');});panel.hidden=true;}
  }else if(state.phase==='idle'||state.outcome){panel.hidden=true;}
 }else if(msg.type==='correction_note'){
  const issue=msg.issue;if(issue){const verse=host.querySelector('[data-recitation-ayah="'+issue.surah+':'+issue.ayah+'"]'),word=verse?.querySelector('[data-word-index="'+Math.max(0,Number(issue.word)||0)+'"]');word?.classList.add('revealed','uncertain');word?.setAttribute('aria-label','احتمال تكرار؛ راجع الموضع');$('asrResult').textContent='رصد المحرك احتمال تكرار كلمة في الآية '+issue.ayah+'؛ راجع الموضع.';}
 }else if(msg.type==='verse_match'){
  liveCurrentVerse={surah:msg.surah,ayah:msg.ayah,text:msg.verse_text||''};
  host.querySelectorAll('.recite-ayah.active').forEach(el=>el.classList.remove('active'));
  const verse=host.querySelector('[data-recitation-ayah="'+msg.surah+':'+msg.ayah+'"]');
  if(verse){
   verse.classList.add('active');
   verse.querySelectorAll('.recite-word').forEach(word=>{
    word.classList.remove('revealed','correct','error','uncertain');
    word.classList.add('unattempted');
    word.removeAttribute('aria-label');
   });
   verse.scrollIntoView({behavior:'smooth',block:'center'});
  }
  const title=(msg.surah_name||('سورة '+msg.surah))+' · الآية '+msg.ayah;
  $('asrResult').textContent='تم التعرف على موضع التلاوة · '+title+' · '+(Number.isFinite(msg.confidence)?Math.round(msg.confidence*100)+'٪ ثقة':'');
  $('reciteBottomStatus').textContent=title;
  $('reciteLiveIndicator').textContent='● يستمع';
  localStorage.setItem('rattil-last-recitation',JSON.stringify({surah:msg.surah,ayah:msg.ayah,at:Date.now()}));
 }else if(msg.type==='word_progress'&&liveCurrentVerse&&msg.surah===liveCurrentVerse.surah&&msg.ayah===liveCurrentVerse.ayah){
  const indices=Array.isArray(msg.matched_indices)?msg.matched_indices.map(Number).filter(Number.isInteger):[];
  const verse=host.querySelector('[data-recitation-ayah="'+msg.surah+':'+msg.ayah+'"]');
  const words=verse?.querySelectorAll('[data-word-index]')||[];
  const reportedIndex=Number(msg.word_index);
  const lastHeardIndex=Number.isInteger(reportedIndex)?reportedIndex:Math.max(-1,...indices);
  words.forEach((el,i)=>{
   const matched=indices.includes(i);
   const reached=i<=lastHeardIndex;
   el.classList.toggle('revealed',matched||reached);
   el.classList.toggle('correct',matched&&!el.classList.contains('error')&&!el.classList.contains('uncertain'));
   el.classList.toggle('unattempted',!matched&&!el.classList.contains('error')&&!el.classList.contains('uncertain'));
  });
 }
}
function stopWorker(){if(asrWorker){asrWorker.terminate();asrWorker=null;}asrReady=false;}
async function loadAsr(){
 const btn=$('loadAsr');btn.disabled=true;asrStatus('تشغيل محرك التسميع…');
 try{
  stopWorker();
  asrWorker=new Worker(new URL('./asr-worker.js',import.meta.url),{type:'module'});
  asrWorker.onmessage=e=>{
   const m=e.data||{};
   if(m.type==='loading_status')asrStatus(m.message);
   else if(m.type==='loading')asrStatus('تنزيل نموذج التسميع لأول مرة… '+(m.percent||0)+'٪');
   else if(m.type==='ready'){asrReady=true;if(activeReciteSurah){const selected=surahCatalog.find(s=>s.number===activeReciteSurah);if(selected)asrWorker.postMessage({type:'set_expected',passage:{surah:selected.number,ayah:1,ayahEnd:selected.numberOfAyahs}});}$('startRec').disabled=!activeReciteSurah;btn.disabled=true;asrStatus('محرك التسميع جاهز — النموذج محفوظ محليًا بعد اكتمال التنزيل.');}
   else if(m.type==='error'){asrStatus('تعذر تشغيل محرك التسميع: '+m.message);btn.disabled=false;}
   else if(m.type==='event')renderLiveVerse(m.event);
  };
  asrWorker.onerror=e=>{console.error('Rattil ASR worker error',e);asrStatus('حدث خطأ داخل محرك التسميع. أعد المحاولة.');btn.disabled=false;};
  asrWorker.postMessage({type:'init'});
 }catch(e){console.error(e);asrStatus('تعذر بدء محرك التسميع: '+(e.message||e));btn.disabled=false;}
}
async function clearAsrStorage(){
 if(liveAudioContext){asrStatus('أوقف التسميع أولًا.');return;}
 const b=$('clearAsrCache');b.disabled=true;
 try{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('rattil-zipformer-assets',1);q.onupgradeneeded=()=>q.result.createObjectStore('assets');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  db.close();asrStatus('تم حذف نموذج Zipformer وملفاته من هذا الجهاز.');
 }catch(e){asrStatus('تعذر حذف الملفات: '+e.message);b.disabled=false;}
}
$('clearAsrCache').addEventListener('click',clearAsrStorage);
$('clearAsrCache').disabled=false;
function resampleTo16k(input,rate){
 if(rate===16000)return input.slice();
 const n=Math.floor(input.length*16000/rate),out=new Float32Array(n),ratio=rate/16000;
 for(let i=0;i<n;i++){const p=i*ratio,l=Math.floor(p),f=p-l;out[i]=(input[l]||0)*(1-f)+(input[Math.min(l+1,input.length-1)]||0)*f;}
 return out;
}
function sendAudioChunk(samples){
 if(!asrWorker||!asrReady||!samples.length)return;
 const copy=samples.slice();asrWorker.postMessage({type:'audio',samples:copy},[copy.buffer]);
}
async function startRecording(){
 if(!activeReciteSurah){asrStatus('اختر سورة من الفهرس أولًا.');return}
 if(!asrReady||!asrWorker){asrStatus('حمّل محرك التسميع أولًا.');return;}
 if(!navigator.mediaDevices?.getUserMedia||(!window.AudioContext&&!window.webkitAudioContext)){asrStatus6�������k�w��rSurahSearch" type="search" placeholder="ابحث باسم السورة أو رقمها"><div id="readerSurahList" class="reader-surah-list"></div></div></section>
<script>document.getElementById('date').textContent=new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long'}).format(new Date());</script></body></html>
