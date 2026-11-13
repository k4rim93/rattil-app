(() => {
const API='https://api.alquran.cloud/v1', $=id=>document.getElementById(id);
const qvpModulePromise=import(new URL('qvp/lite.mjs',document.baseURI).href);
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
 document.body.classList.toggle('recitation-reading',currentScreen==='recite'&&!$('reciteReaderPanel').hidden);
 const isHome=currentScreen==='home';
 $('homeView').hidden=!isHome;
 document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',!isHome&&v.id===views[currentScreen]));
 document.querySelectorAll('.rattil-bottom-nav button').forEach(b=>{const active=b.hasAttribute('data-home-screen')?isHome:b.dataset.navigate===currentScreen;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
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
document.querySelector('[data-home-screen]').addEventListener('click',()=>{history.pushState({rattilScreen:'home'},'','#home');renderScreen('home');});
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
const qvpPageCache=new Map(),recitationWordStates=new Map();
let recitationQvpPage=null,recitationQvpGeometry=null,recitationQvpWordData=null,recitationVerseData=[],recitationPageNumber=0,recitationActiveWordKey='',recitationPreview=false,recitationRenderRequest=0,recitationRenderTimer=null;
let readerReturnScreen="mushaf";
function showReader(){ $("mushafReader").hidden=false; document.body.classList.add("reader-open"); }
function closeReader(){ $("mushafReader").hidden=true; $("readerIndexPanel").hidden=true; $("selectedAyahPanel").hidden=true; document.body.classList.remove("reader-open"); }
function getPageMeta(page){if(!pageMetaCache.has(page))pageMetaCache.set(page,json(API+"/page/"+page+"/quran-uthmani"));return pageMetaCache.get(page);}
function getPageSvg(page){if(!pageSvgCache.has(page))pageSvgCache.set(page,fetch("https://cdn.quran.ws/svg/pages/v1.1.1/hafs-kfqc/"+String(page).padStart(3,"0")+".svg").then(r=>{if(!r.ok)throw Error("SVG HTTP "+r.status);return r.text();}));return pageSvgCache.get(page);}
const mushafZoomKey='rattil-mushaf-zoom-v1';let mushafZoom=localStorage.getItem(mushafZoomKey)!=='false';document.body.classList.toggle('mushaf-zoom',mushafZoom);$('toggleMushafZoom').setAttribute('aria-pressed',String(mushafZoom));
function applyMushafViewBox(svg){const original=svg.dataset.fullViewBox||svg.getAttribute('viewBox');if(!original)return;if(!svg.dataset.fullViewBox)svg.dataset.fullViewBox=original;if(!mushafZoom){svg.setAttribute('viewBox',original);return;}const content=svg.querySelector('#content');if(!content)return;try{const b=content.getBBox(),pad=Math.max(4,b.height*.035);if(b.width>0&&b.height>0)svg.setAttribute('viewBox',[b.x-pad,b.y-pad,b.width+pad*2,b.height+pad*2].join(' '));}catch{svg.setAttribute('viewBox',original);}}
$('toggleMushafZoom').addEventListener('click',()=>{mushafZoom=!mushafZoom;localStorage.setItem(mushafZoomKey,String(mushafZoom));document.body.classList.toggle('mushaf-zoom',mushafZoom);$('toggleMushafZoom').setAttribute('aria-pressed',String(mushafZoom));if($('mushafReader').hidden===false)openMushafPage(activeMushafPage,selectedVerseKey);});
function verseKey(ayah){return ayah.surah.number+":"+ayah.numberInSurah;}
function renderReaderMeta(data){const a=data.ayahs?.[0];if(!a)throw Error("Empty Mushaf page");$("readerSurah").textContent=a.surah.name;$("readerSurahName").textContent=a.surah.name;$("readerJuz").textContent="الجزء "+(a.juz||"—");$("readerHizb").textContent="الحزب "+(a.hizbQuarter||"—");$("readerPageNumber").textContent=activeMushafPage;}
$('homeOpenIndex').addEventListener('click',()=>{navigate('mushaf');$('openSurahIndex').click();});
$('resumeReading').addEventListener('click',async()=>{navigate('mushaf');const key=localStorage.getItem('rattil-last-ayah')||'';const savedPage=Number(localStorage.getItem('rattil-last-page')||0);if(savedPage>0)await openMushafPage(savedPage,key||null);else $('openSurahIndex').click();});
const lastReadLabel=$('lastReadLabel');if(lastReadLabel){const last=localStorage.getItem('rattil-last-ayah');lastReadLabel.textContent=last?'آخر موضع: '+last.replace(':',' · الآية '):'افتح المصحف وابدأ من اختيارك';}
function selectReaderAyah(key,meta,poly){selectedVerseKey=key;const [sn,an]=key.split(":").map(Number);const ayah=meta.ayahs.find(a=>a.surah.number===sn&&a.numberInSurah===an);const panel=$("selectedAyahPanel");if(ayah){panel.innerHTML="<strong>"+ayah.surah.name+" · الآية "+an+"</strong><div>"+ayah.text+"</div>";panel.hidden=false;localStorage.setItem("rattil-last-ayah",key);}const root=$("readerAyahs").querySelector("svg");root?.querySelectorAll(".ayahPolygon").forEach(p=>p.setAttribute("fill-opacity",p===poly?"0.42":"0"));}
async function openMushafPage(page,key,direction){const target=Math.max(1,Math.min(604,+page||1));if(pageTurnLock)return;pageTurnLock=true;activeMushafPage=target;if(key)selectedVerseKey=key;showReader();$("readerAyahs").setAttribute("aria-busy","true");$("readerPageNumber").textContent=target;try{const [meta,svgText]=await Promise.all([getPageMeta(target),getPageSvg(target)]);if(activeMushafPage!==target)return;const parsed=new DOMParser().parseFromString(svgText,"image/svg+xml");if(parsed.querySelector("parsererror")||parsed.documentElement.localName!=="svg")throw Error("Invalid page SVG");parsed.querySelectorAll("script,foreignObject").forEach(n=>n.remove());parsed.querySelectorAll("*").forEach(n=>[...n.attributes].forEach(a=>{if(/^on/i.test(a.name))n.removeAttribute(a.name);}));const host=$("readerAyahs");host.replaceChildren(document.importNode(parsed.documentElement,true));const root=host.querySelector("svg");root.setAttribute("preserveAspectRatio","xMidYMid meet");root.setAttribute("role","img");root.setAttribute("aria-label","صفحة المصحف رقم "+target);root.style.cssText="display:block;width:100%;height:auto;max-width:100%;background:var(--mushaf-page)";applyMushafViewBox(root);root.querySelectorAll("#content path:not(.ayahPolygon),#ayah_markers path:not(.ayahPolygon)").forEach(p=>p.style.setProperty("fill","var(--mushaf-ink)","important"));const content=root.querySelector("#content");if(content)content.style.pointerEvents="none";root.querySelectorAll(".ayahPolygon").forEach(poly=>{poly.style.pointerEvents="all";poly.style.cursor="pointer";poly.setAttribute("fill","#d9b65e");poly.setAttribute("fill-opacity","0");poly.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();const sn=Number(poly.getAttribute("surah")),an=Number(poly.getAttribute("ayah"));if(sn&&an)selectReaderAyah(sn+":"+an,meta,poly);});});renderReaderMeta(meta);if(selectedVerseKey){const [sn,an]=selectedVerseKey.split(":").map(Number);const hit=[...root.querySelectorAll(".ayahPolygon")].find(p=>Number(p.getAttribute("surah"))===sn&&Number(p.getAttribute("ayah"))===an);if(hit)selectReaderAyah(selectedVerseKey,meta,hit);}else $("selectedAyahPanel").hidden=true;localStorage.setItem("rattil-last-page",target);$("mushafPaper").classList.remove("page-turn-next","page-turn-prev");void $("mushafPaper").offsetWidth;if(direction)$("mushafPaper").classList.add(direction==="next"?"page-turn-next":"page-turn-prev");}catch(e){$("readerAyahs").textContent="تعذر تحميل صفحة المصحف. تحقق من الاتصال وحاول مرة أخرى.";$("readerPageNumber").textContent=target;console.error(e);}finally{$("readerAyahs").removeAttribute("aria-busy");pageTurnLock=false;}}
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
async function fetchQvpResource(url){
 let cache=null;
 try{if('caches'in window){cache=await caches.open('rattil-qvp-v0.5.0');const saved=await cache.match(url);if(saved)return saved;}}catch{}
 const response=await fetch(url);if(!response.ok)throw Error('QVP HTTP '+response.status);
 if(cache)try{await cache.put(url,response.clone());}catch{}
 return response;
}
async function loadQvpPage(number){
 const pageNumber=Math.max(1,Math.min(604,Number(number)||1));
 if(!qvpPageCache.has(pageNumber))qvpPageCache.set(pageNumber,(async()=>{
  const pad=String(pageNumber).padStart(3,'0'),base='https://cdn.quran.ws/qvp/v0.5.0/'+pad;
  const [module,qvpResponse,wordResponse]=await Promise.all([qvpModulePromise,fetchQvpResource(base+'.qvp'),fetchQvpResource(base+'.words.json')]);
  const buffer=await qvpResponse.arrayBuffer(),page=module.decodePage(buffer),geometry=module.decodeGeometry(buffer),wordData=await wordResponse.json();
  return {page,geometry,wordData};
 })().catch(error=>{qvpPageCache.delete(pageNumber);throw error;}));
 return qvpPageCache.get(pageNumber);
}
function drawRecitationQvpPage(){
 const host=$('liveRecitationText'),canvas=host?.querySelector('canvas');if(!host||!canvas||!recitationQvpPage)return;
 const ratio=recitationQvpPage.width/recitationQvpPage.height,width=Math.max(1,host.clientWidth),dpr=Math.min(2,window.devicePixelRatio||1);
 canvas.width=Math.round(width*dpr);canvas.height=Math.round(width/ratio*dpr);canvas.style.aspectRatio=recitationQvpPage.width+'/'+recitationQvpPage.height;
 const ctx=canvas.getContext('2d'),pageColor=getComputedStyle(document.body).getPropertyValue('--mushaf-page').trim()||'#050b08',ink=getComputedStyle(document.body).getPropertyValue('--mushaf-ink').trim()||'#f7f0df',fit=recitationQvpPage.fit(canvas,0);
 ctx.fillStyle=pageColor;ctx.fillRect(0,0,canvas.width,canvas.height);
 if(recitationPreview)recitationQvpPage.draw(ctx,{...fit,ink});
 recitationQvpPage.drawDecorations(ctx,{...fit,ink:'#c7a34c'});
 const now=Date.now(),active=[],correct=[],errors=[],uncertain=[];
 recitationQvpGeometry.words.forEach((word,index)=>{const key=word.surah+':'+word.ayah+':'+word.word,state=recitationWordStates.get(key);if(!state)return;if(state.state==='active')active.push(index);else if(state.state==='error')errors.push(index);else if(state.state==='uncertain')uncertain.push(index);else if(state.state==='correct'&&state.until>now)correct.push(index);else if(state.state==='correct')recitationWordStates.delete(key);});
 if(correct.length)recitationQvpPage.drawWords(ctx,correct,{...fit,ink:'#48d889'});
 if(errors.length)recitationQvpPage.drawWords(ctx,errors,{...fit,ink:'#ff625d'});
 if(uncertain.length)recitationQvpPage.drawWords(ctx,uncertain,{...fit,ink:'#e8c36b'});
 if(active.length)recitationQvpPage.drawWords(ctx,active,{...fit,ink:'#e8c75a'});
}
async function showRecitationQvpPage(number){
 const host=$('liveRecitationText'),request=++recitationRenderRequest;host.setAttribute('aria-busy','true');
 try{
  const data=await loadQvpPage(number);if(request!==recitationRenderRequest)return;
  recitationQvpPage=data.page;recitationQvpGeometry=data.geometry;recitationQvpWordData=data.wordData;recitationPageNumber=data.page.number||Number(number);
  host.replaceChildren();const canvas=document.createElement('canvas');canvas.className='recitation-qvp-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','صفحة المصحف '+recitationPageNumber+'، كلماتها ستظهر أثناء التسميع');host.append(canvas);drawRecitationQvpPage();
  $('reciteCurrentSurahMeta').textContent='صفحة '+recitationPageNumber+' · الآيات تظهر مع تلاوتك';
  if(recitationRenderTimer)clearTimeout(recitationRenderTimer);recitationRenderTimer=setTimeout(drawRecitationQvpPage,850);
 }catch(error){if(request===recitationRenderRequest){host.replaceChildren();host.textContent='تعذر تحميل صفحة المصحف. تحقق من الاتصال وحاول مرة أخرى.';console.error('QVP page load failed',error);}}
 finally{if(request===recitationRenderRequest)host.removeAttribute('aria-busy');}
}
async function openRecitationSurah(s){
 const host=$('liveRecitationText');$('reciteIndexPanel').hidden=true;$('reciteReaderPanel').hidden=false;
 document.body.classList.add('recitation-reading');recitationPreview=false;recitationWordStates.clear();recitationActiveWordKey='';liveCurrentVerse=null;$('reciteCorrectionPanel').hidden=true;$('toggleReciteText').textContent='معاينة الآيات';$('toggleReciteText').setAttribute('aria-pressed','false');
 $('reciteCurrentSurahName').textContent=s.name;$('reciteCurrentSurahMeta').textContent=s.numberOfAyahs+' آية';
 $('reciteBottomStatus').textContent='تحميل آيات '+s.name+'…';
 host.replaceChildren();host.textContent='جارٍ تحميل الآيات…';
 try{
  if(!surahDataCache.has(s.number))surahDataCache.set(s.number,json(API+'/surah/'+s.number+'/quran-uthmani'));
  const data=await surahDataCache.get(s.number);recitationVerseData=data.ayahs;
  activeReciteSurah=s.number;$('startRec').disabled=!asrReady;
  if(asrWorker)asrWorker.postMessage({type:'set_expected',passage:{surah:s.number,ayah:1,ayahEnd:s.numberOfAyahs}});
  const firstAyah=data.ayahs[0];await showRecitationQvpPage(firstAyah?.page||1);
  $('reciteBottomStatus').textContent=asrReady?'جاهز للتسميع · '+s.name:'ارجع للفهرس وحمّل المحرك أول مرة · '+s.name;
  $('asrResult').textContent='ابدأ القراءة؛ ستظهر الكلمة الحالية على صفحة المصحف الأصلية.';
  localStorage.setItem('rattil-last-surah',String(s.number));
 }catch(e){host.textContent='تعذر تحميل آيات السورة. تحقق من الاتصال وحاول مرة أخرى.';$('reciteBottomStatus').textContent='تعذر تحميل السورة';console.error(e);}
}
$('reciteSurahSearchInput').addEventListener('input',populateReciteSurahs);
$('reciteBackToIndex').addEventListener('click',()=>{$('reciteReaderPanel').hidden=true;$('reciteIndexPanel').hidden=false;document.body.classList.remove('recitation-reading');});

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
function normalizeRecitationWord(text){return String(text||'').normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\ufeffـ]/g,'').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه');}
function mapRecitationToken(surah,ayah,apiIndex){
 const source=recitationVerseData.find(item=>item.numberInSurah===Number(ayah)),apiWords=String(source?.text||'').split(/\s+/).filter(Boolean),pageWords=recitationQvpGeometry?.words||[];
 const candidates=pageWords.map((record,index)=>({record,index,key:record.surah+':'+record.ayah+':'+record.word})).filter(item=>item.record.surah===Number(surah)&&item.record.ayah===Number(ayah));
 if(!apiWords.length||!candidates.length)return Number(apiIndex)+1;
 const variants=candidates.map(({key})=>{const item=recitationQvpWordData?.[key]||{};return new Set(Object.values(item).map(normalizeRecitationWord).filter(Boolean));}),tokens=apiWords.map(normalizeRecitationWord),rows=tokens.length+1,cols=candidates.length+1,dp=Array.from({length:rows},()=>new Uint16Array(cols));
 for(let i=tokens.length-1;i>=0;i--)for(let j=candidates.length-1;j>=0;j--)dp[i][j]=variants[j].has(tokens[i])?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
 const mapping=new Map();let i=0,j=0;while(i<tokens.length&&j<candidates.length){if(variants[j].has(tokens[i])&&dp[i][j]===1+dp[i+1][j+1]){mapping.set(i,candidates[j].record.word);i++;j++;}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;}
 return mapping.get(Number(apiIndex))??Number(apiIndex)+1;
}
function setRecitationWordState(surah,ayah,wordNumber,state,ttl=0,redraw=true){
 const key=Number(surah)+':'+Number(ayah)+':'+Number(wordNumber);recitationWordStates.set(key,{state,until:ttl?Date.now()+ttl:0});
 if(state==='active'){const previous=recitationWordStates.get(recitationActiveWordKey);if(previous?.state==='active'&&recitationActiveWordKey!==key){recitationWordStates.set(recitationActiveWordKey,{state:'correct',until:Date.now()+850});if(recitationRenderTimer)clearTimeout(recitationRenderTimer);recitationRenderTimer=setTimeout(drawRecitationQvpPage,880);}recitationActiveWordKey=key;}
 if(state==='correct'&&ttl){if(recitationRenderTimer)clearTimeout(recitationRenderTimer);recitationRenderTimer=setTimeout(drawRecitationQvpPage,ttl+30);}
 if(redraw)drawRecitationQvpPage();
}
async function followQvpWord(surah,ayah,wordNumber){
 const key=Number(surah)+':'+Number(ayah)+':'+Number(wordNumber),hasWord=data=>data.geometry.words.some(word=>word.surah+':'+word.ayah+':'+word.word===key);
 if((recitationQvpGeometry&&hasWord({geometry:recitationQvpGeometry}))||recitationPageNumber>=604)return;
 const page=recitationPageNumber+1;try{const data=await loadQvpPage(page);if(hasWord(data)&&page!==recitationPageNumber)await showRecitationQvpPage(page);}catch{}
}
function renderLiveVerse(msg){
 const host=$('liveRecitationText');if(!host)return;
 if(msg.type==='correction'){
  const state=msg.state||{},issue=state.issue,panel=$('reciteCorrectionPanel');
  if(issue){
   const issueVerse=recitationVerseData.find(item=>item.numberInSurah===Number(issue.ayah));if(issueVerse?.page&&issueVerse.page!==recitationPageNumber)showRecitationQvpPage(issueVerse.page);
   const start=Math.max(0,Number(issue.word)||0),count=Number(issue.words)||1;
   const kind=issue.kind||'possible_substitution';
   const labels={possible_omission:'احتمال كلمة لم تُقرأ',possible_substitution:'احتمال اختلاف في الكلمة',possible_vowel:'اختلاف محتمل في الحركة',possible_repetition:'احتمال تكرار كلمة',possible_skipped_ayah:'احتمال تخطي آية',unclear_ayah:'لم يستطع المحرك متابعة الآية'};
   const uncertain=['possible_vowel','possible_repetition','unclear_ayah'].includes(kind);
   const source=recitationVerseData.find(item=>item.numberInSurah===Number(issue.ayah)),countWords=String(source?.text||'').split(/\s+/).filter(Boolean).length;
   const targetIndices=['possible_skipped_ayah','unclear_ayah'].includes(kind)?Array.from({length:countWords},(_,i)=>i):Array.from({length:count},(_,i)=>start+i);
   targetIndices.forEach(index=>setRecitationWordState(issue.surah,issue.ayah,mapRecitationToken(issue.surah,issue.ayah,index),uncertain?'uncertain':'error'));
   $('reciteCorrectionTitle').textContent=labels[kind]||'موضع يحتاج مراجعة';
   $('reciteCorrectionText').textContent='رصد المحرك احتمالًا يحتاج مراجعة في الآية '+issue.ayah+'. قد لا يكون الحكم صحيحًا دائمًا، ولا يقيّم هذا حكم التجويد.';
   panel.hidden=!['error','retrying'].includes(state.phase);
   panel.querySelectorAll('[data-correction-action]').forEach(button=>{button.hidden=state.phase==='retrying'?button.dataset.correctionAction!=='stop_retry':button.dataset.correctionAction==='stop_retry';});
   if(state.phase==='retrying')$('reciteCorrectionText').textContent='أعد قراءة المقطع المحدد؛ يراجع المحرك هذه المحاولة الآن.';
   if(state.phase==='corrected'){$('reciteCorrectionText').textContent='انتهت مراجعة هذا الموضع.';targetIndices.forEach(index=>setRecitationWordState(issue.surah,issue.ayah,mapRecitationToken(issue.surah,issue.ayah,index),'correct',900));panel.hidden=true;}
  }else if(state.phase==='idle'||state.outcome){panel.hidden=true;}
 }else if(msg.type==='correction_note'){
  const issue=msg.issue;if(issue){const word=mapRecitationToken(issue.surah,issue.ayah,Math.max(0,Number(issue.word)||0));setRecitationWordState(issue.surah,issue.ayah,word,'uncertain');$('asrResult').textContent='رصد المحرك احتمال تكرار كلمة في الآية '+issue.ayah+'؛ راجع الموضع.';}
 }else if(msg.type==='verse_match'){
  liveCurrentVerse={surah:msg.surah,ayah:msg.ayah,text:msg.verse_text||''};
  const verse=recitationVerseData.find(item=>item.numberInSurah===Number(msg.ayah));if(verse?.page&&verse.page!==recitationPageNumber)showRecitationQvpPage(verse.page);
  $('reciteCurrentSurahName').textContent=(msg.surah_name||('سورة '+msg.surah))+' · الآية '+msg.ayah;
  const title=(msg.surah_name||('سورة '+msg.surah))+' · الآية '+msg.ayah;
  $('asrResult').textContent='تم التعرف على موضع التلاوة · '+title+' · '+(Number.isFinite(msg.confidence)?Math.round(msg.confidence*100)+'٪ ثقة':'');
  $('reciteBottomStatus').textContent=title;
  $('reciteLiveIndicator').textContent='● يستمع';
  localStorage.setItem('rattil-last-recitation',JSON.stringify({surah:msg.surah,ayah:msg.ayah,at:Date.now()}));
 }else if(msg.type==='word_progress'&&liveCurrentVerse&&msg.surah===liveCurrentVerse.surah&&msg.ayah===liveCurrentVerse.ayah){
  const verse=recitationVerseData.find(item=>item.numberInSurah===Number(msg.ayah)),tokenCount=String(verse?.text||'').split(/\s+/).filter(Boolean).length;
  const indices=Array.isArray(msg.matched_indices)?msg.matched_indices.map(Number).filter(index=>Number.isInteger(index)&&index>=0&&index<tokenCount):[];
  const reportedIndex=Number(msg.word_index);
  const lastHeardIndex=Number.isInteger(reportedIndex)?Math.min(tokenCount-1,reportedIndex-1):Math.max(-1,...indices),lastIndex=Math.max(lastHeardIndex,...indices),activeIndex=indices.length?Math.max(...indices):lastHeardIndex;
  for(let index=0;index<=lastIndex;index++){const word=mapRecitationToken(msg.surah,msg.ayah,index);if(indices.includes(index))setRecitationWordState(msg.surah,msg.ayah,word,index===activeIndex?'active':'correct',index===activeIndex?0:850,false);else setRecitationWordState(msg.surah,msg.ayah,word,'error',0,false);}
  drawRecitationQvpPage();if(activeIndex>=0){const word=mapRecitationToken(msg.surah,msg.ayah,activeIndex);followQvpWord(msg.surah,msg.ayah,word);}
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
 if(!navigator.mediaDevices?.getUserMedia||(!window.AudioContext&&!window.webkitAudioContext)){asrStatus('المتصفح لا يدعم الميكروفون. افتح رَتِّل من Safari على HTTPS.');return;}
 try{
  liveMediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  const Ctx=window.AudioContext||window.webkitAudioContext;liveAudioContext=new Ctx();await liveAudioContext.resume();
  liveSource=liveAudioContext.createMediaStreamSource(liveMediaStream);liveProcessor=liveAudioContext.createScriptProcessor(4096,1,1);
  liveSamples=new Float32Array(0);liveLastVerse=null;liveCurrentVerse=null;
  recitationWordStates.clear();recitationActiveWordKey='';drawRecitationQvpPage();
  asrWorker.postMessage({type:'reset'});
  liveProcessor.onaudioprocess=e=>{
   if(!liveAudioContext)return;
   const next=resampleTo16k(e.inputBuffer.getChannelData(0),liveAudioContext.sampleRate);
   const joined=new Float32Array(liveSamples.length+next.length);joined.set(liveSamples);joined.set(next,liveSamples.length);liveSamples=joined;
   while(liveSamples.length>=4800){sendAudioChunk(liveSamples.subarray(0,4800));liveSamples=liveSamples.slice(4800);}
  };
  liveSource.connect(liveProcessor);liveProcessor.connect(liveAudioContext.destination);
  $('startRec').disabled=true;$('stopRec').disabled=false;
  asrStatus('التسميع المباشر يعمل على الجهاز — الصوت لا يغادر الآيفون.');$('reciteBottomStatus').textContent='جاري الاستماع إلى تلاوتك…';$('reciteLiveIndicator').textContent='● يستمع';
 }catch(e){asrStatus('تعذر فتح الميكروفون: '+(e.message||'تحقق من الإذن.'));await stopLiveRecording();}
}
async function stopLiveRecording(){
 if(liveProcessor){liveProcessor.onaudioprocess=null;try{liveProcessor.disconnect();}catch(e){}}
 if(liveSource){try{liveSource.disconnect();}catch(e){}}
 if(liveSamples.length)sendAudioChunk(liveSamples);
 liveSamples=new Float32Array(0);
 if(liveMediaStream)liveMediaStream.getTracks().forEach(t=>t.stop());
 if(liveAudioContext){try{await liveAudioContext.close();}catch(e){}}
 liveProcessor=liveSource=liveMediaStream=liveAudioContext=null;
 if(asrWorker&&asrReady)asrWorker.postMessage({type:'stop'});
 $('startRec').disabled=!asrReady||!activeReciteSurah;$('stopRec').disabled=true;
 asrStatus('تم إيقاف التسميع. الصوت لم يغادر جهازك.');$('reciteBottomStatus').textContent='تم إيقاف التسميع';$('reciteLiveIndicator').textContent='● جاهز';
}
$('toggleReciteText').addEventListener('click',()=>{recitationPreview=!recitationPreview;const b=$('toggleReciteText');b.textContent=recitationPreview?'إخفاء الآيات':'معاينة الآيات';b.setAttribute('aria-pressed',String(recitationPreview));b.setAttribute('aria-label',recitationPreview?'إخفاء نص الآيات':'عرض نص الآيات للمعاينة');drawRecitationQvpPage();});
window.addEventListener('resize',drawRecitationQvpPage,{passive:true});
document.querySelectorAll('[data-correction-action]').forEach(button=>button.addEventListener('click',()=>{if(!asrWorker)return;document.querySelectorAll('[data-correction-action]').forEach(action=>action.disabled=true);$('reciteCorrectionText').textContent='تم إرسال اختيارك إلى المحرك…';asrWorker.postMessage({type:'correction_action',action:button.dataset.correctionAction});setTimeout(()=>document.querySelectorAll('[data-correction-action]').forEach(action=>action.disabled=false),600);}));

$('startRec').addEventListener('click',startRecording);
$('stopRec').addEventListener('click',stopLiveRecording);


 // Qibla compass. First tap obtains location; the next tap requests iOS compass permission in a user gesture.
 let qiblaBearing=null,qiblaOrientationHandler=null,qiblaOrientationTimer=null;
 function bearingToKaaba(lat,lon){
  const kLat=21.4225*Math.PI/180,kLon=39.8262*Math.PI/180,pLat=lat*Math.PI/180,pLon=lon*Math.PI/180;
  const y=Math.sin(kLon-pLon)*Math.cos(kLat),x=Math.cos(pLat)*Math.sin(kLat)-Math.sin(pLat)*Math.cos(kLat)*Math.cos(kLon-pLon);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
 }
 $('enableQibla')?.addEventListener('click',async()=>{
  const status=$('qiblaStatus'),button=$('enableQibla');
  if(qiblaBearing===null){
   status.textContent='جارٍ تحديد موقعك…';
   if(!navigator.geolocation){status.textContent='المتصفح لا يدعم تحديد الموقع.';return;}
   navigator.geolocation.getCurrentPosition(pos=>{
    qiblaBearing=bearingToKaaba(pos.coords.latitude,pos.coords.longitude);
    status.textContent='اتجاه القبلة من الشمال: '+Math.round(qiblaBearing)+'°. اضغط تفعيل البوصلة.';
    button.textContent='تفعيل البوصلة';
   },err=>{status.textContent=err.code===1?'لم يتم السماح بالموقع. فعّل إذن الموقع.':'تعذر تحديد الموقع. حاول مرة أخرى.';},{enableHighAccuracy:true,timeout:12000,maximumAge:300000});
   return;
  }
  try{
   if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
    const permission=await DeviceOrientationEvent.requestPermission();
    if(permission!=='granted'){
     $('qiblaNeedle').style.transform='rotate('+qiblaBearing+'deg)';
     status.textContent='لم يُسمح بالبوصلة؛ السهم يوضح الاتجاه التقريبي من الشمال ('+Math.round(qiblaBearing)+'°).';
     button.textContent='إعادة محاولة البوصلة';return;
    }
   }
   if(qiblaOrientationHandler)window.removeEventListener('deviceorientation',qiblaOrientationHandler,true);
   if(qiblaOrientationTimer)clearTimeout(qiblaOrientationTimer);
   let receivedHeading=false;
   qiblaOrientationHandler=e=>{
    const heading=Number.isFinite(e.webkitCompassHeading)?e.webkitCompassHeading:e.absolute===true&&Number.isFinite(e.alpha)?(360-e.alpha):null;
    if(heading===null)return;
    receivedHeading=true;if(qiblaOrientationTimer)clearTimeout(qiblaOrientationTimer);
    $('qiblaNeedle').style.transform='rotate('+((qiblaBearing-heading+360)%360)+'deg)';
    status.textContent='البوصلة نشطة. وجّه الهاتف حتى يشير السهم لاتجاه القبلة.';
    button.textContent='البوصلة مفعّلة';button.disabled=true;
   };
   window.addEventListener('deviceorientation',qiblaOrientationHandler,true);
   status.textContent='جارٍ انتظار قراءة حساس الاتجاه…';
   qiblaOrientationTimer=setTimeout(()=>{
    if(receivedHeading)return;
    window.removeEventListener('deviceorientation',qiblaOrientationHandler,true);qiblaOrientationHandler=null;
    $('qiblaNeedle').style.transform='rotate('+qiblaBearing+'deg)';
    status.textContent='حساس البوصلة غير متاح؛ السهم يوضح الاتجاه التقريبي من الشمال ('+Math.round(qiblaBearing)+'°).';
    button.textContent='إعادة محاولة البوصلة';button.disabled=false;
   },3000);
  }catch(err){if(qiblaBearing!==null){$('qiblaNeedle').style.transform='rotate('+qiblaBearing+'deg)';status.textContent='حساس البوصلة غير متاح؛ السهم يوضح الاتجاه التقريبي من الشمال ('+Math.round(qiblaBearing)+'°).';button.textContent='إعادة محاولة البوصلة';button.disabled=false;}else status.textContent='تعذر تفعيل البوصلة على هذا الجهاز.';}
 });
 // Simple local tasbih counter; counts persist on this device.
 const adhkarSets={morning:['سبحان الله','الحمد لله','الله أكبر'],evening:['أستغفر الله','سبحان الله وبحمده','لا إله إلا الله']};
 let adhkarSet='morning',adhkarIndex=0,adhkarCount=Number(localStorage.getItem('rattil-adhkar-count')||0);
 function renderAdhkar(){
  $('adhkarText').textContent=adhkarSets[adhkarSet][adhkarIndex];
  $('adhkarCount').textContent=adhkarCount;
  document.querySelectorAll('[data-adhkar-set]').forEach(x=>x.classList.toggle('selected',x.dataset.adhkarSet===adhkarSet));
 }
 document.querySelectorAll('[data-adhkar-set]').forEach(x=>x.addEventListener('click',()=>{adhkarSet=x.dataset.adhkarSet;adhkarIndex=0;adhkarCount=0;localStorage.setItem('rattil-adhkar-count','0');$('adhkarStatus').textContent='ابدأ ذكرك، وسيتم حفظ تقدمك تلقائيًا.';renderAdhkar();}));
 $('adhkarCounter')?.addEventListener('click',()=>{adhkarCount=Math.min(33,adhkarCount+1);localStorage.setItem('rattil-adhkar-count',String(adhkarCount));renderAdhkar();if(adhkarCount===33)$('adhkarStatus').textContent='أحسنت، اكتمل العدد المحدد.';});
 $('adhkarReset')?.addEventListener('click',()=>{adhkarCount=0;localStorage.setItem('rattil-adhkar-count','0');$('adhkarStatus').textContent='تمت إعادة العداد.';renderAdhkar();});
 $('adhkarNext')?.addEventListener('click',()=>{adhkarIndex=(adhkarIndex+1)%adhkarSets[adhkarSet].length;adhkarCount=0;localStorage.setItem('rattil-adhkar-count','0');$('adhkarStatus').textContent='انتقلت إلى الذكر التالي.';renderAdhkar();});
 renderAdhkar();

})();
