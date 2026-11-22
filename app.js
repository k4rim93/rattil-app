import {installAppUpdate} from './app-update.js';
import { referencePage, sessionStats, nextHint, mergeWord, backfillFromHeard, backfillMatchedAyah, bismillahOffset, engineTokenMap, hasRecitationLetters } from './recall-core.js';
import './vendor/adhan.umd.min.js';
import { startCapture } from './audio-capture.js';
import { createLatencyStats } from './latency-stats.js';
import { splitPending } from './pending-progress.js';
import { createDiag, buildDiagReport, renderDiagLines } from './diag.js';
import { buildSessionSummary, aggregateMistakes, mistakeKindLabel, classifyVerdict, isFlagged } from './mistake-core.js';
const latencyStats=createLatencyStats();let pendingPaintAt=0,drawQueued=false;
const diag=createDiag();let diagWorkerLog=null,diagHb=0,diagLastChunk=0,wpPendingAt=0,diagWpRecvAt=0,diagWpKey='';
document.getElementById('appManifest').href=new URL('manifest.webmanifest',document.baseURI).href;
const qvpModulePromise=import(new URL('qvp/lite.mjs',document.baseURI).href);
const qvpPageCache=new Map();

const views=[...document.querySelectorAll('.view')];
const toast=document.getElementById('toast');
let toastTimer;
function announce(message){toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),3200)}
function readStore(key,fallback=null){try{return localStorage.getItem(key)??fallback}catch{return fallback}}
function writeStore(key,value){try{localStorage.setItem(key,String(value));return true}catch{announce('تعذّر الحفظ على هذا الجهاز.');return false}}

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
  if(name==='practice')loadRecitationCatalog();
  if(name==='progress')renderProgress();
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

let appUpdating=false,recitationStarting=false;
let recitationStopping=false,micLevel=0,micLevelFrame=0;
let asrWorker=null,asrReady=false,reciteCatalog=[],reciteVerseCache=new Map(),activeReciteSurah=0,activeReciteMode='follow',reciteRange={from:1,to:10},liveAudioContext=null,liveMediaStream=null,liveSource=null,liveProcessor=null,liveSamples=new Float32Array(0),liveSampleCount=0,liveCurrentVerse=null,pendingWordProgress=[],pendingRecitationMisses=new Set(),rescoreUnavailable=false,recitationLastConfirmedIndex=-1,recitationWordStates=new Map(),recitationWordExpiry=new Map(),recitationTokenMaps=new Map(),currentRecitationSession=null,recitationSessionCancelled=false,recitationRequest=0,pendingReciteSurah=0,pendingReciteLoad=null,recitationSvgPage=0,recitationPreview=false,recitationSvgRequest=0,recitationQvpPage=null,recitationQvpGeometry=null,recitationQvpWordData=null,recitationRenderRequest=0,recitationRenderTimer=null,recitationActiveWordKey='',recitationTrackingKey='';
let heardTranscript='',heardBackfillDone=false,heardBackfillTarget=null;
function showEngineSetup(message='نزّل محرك التسميع المجاني مرة واحدة للبدء.'){document.getElementById('engineSetupPanel').hidden=false;document.getElementById('loadAsr').scrollIntoView({behavior:'smooth',block:'center'});announce(message);}
document.getElementById('followFeatureStart').addEventListener('click',()=>{if(!asrReady){showEngineSetup(readStore('rattil-asr-installed')==='true'?'المحرك المحفوظ قيد التجهيز. انتظر لحظات.':'نزّل محرك التسميع المجاني مرة واحدة للبدء.');return;}document.getElementById('startFollow').click()});
document.getElementById('reviewFeatureStart').addEventListener('click',()=>{if(!asrReady){showEngineSetup(readStore('rattil-asr-installed')==='true'?'المحرك المحفوظ قيد التجهيز. انتظر لحظات.':'نزّل محرك التسميع المجاني مرة واحدة للبدء.');return;}loadRecitationCatalog();const dialog=document.getElementById('recitationSetupDialog');if(!dialog.open)dialog.showModal();});
document.getElementById('cancelRecitationSetup').addEventListener('click',()=>document.getElementById('recitationSetupDialog').close());
function asrStatus(message){document.getElementById('asrStatus').textContent=message;}
async function loadRecitationCatalog(){
  const select=document.getElementById('reviewSurah');if(reciteCatalog.length){if(select.options.length<2)select.innerHTML=reciteCatalog.map(s=>`<option value="${s.number}">${s.name}</option>`).join('');return}
  select.innerHTML='<option value="">جارٍ تحميل فهرس السور…</option>';
  try{const result=await getQuranJson(`${quranApi}/surah`);reciteCatalog=result.data;select.innerHTML=reciteCatalog.map(s=>`<option value="${s.number}">${s.name}</option>`).join('');const last=String(Number(readStore('rattil-last-surah','1'))||1);select.value=last;document.getElementById('reviewFrom').value=String(Number(readStore('rattil-review-from','1'))||1);document.getElementById('reviewTo').value=String(Number(readStore('rattil-review-to','10'))||10);document.getElementById('startReview').disabled=!asrReady;select.dispatchEvent(new Event('change'));updatePracticeSummary();}
  catch{select.innerHTML='<option value="">تعذر تحميل الفهرس</option>';asrStatus('تعذر تحميل فهرس السور. تحقق من اتصال الإنترنت ثم أعد المحاولة.');}
}
async function fetchQvpResource(url){let cache=null;try{if('caches'in window){cache=await caches.open('rattil-qvp-v0.5.0');const saved=await cache.match(url);if(saved)return saved}}catch{}const response=await fetch(url);if(!response.ok)throw Error('QVP HTTP '+response.status);if(cache)try{await cache.put(url,response.clone())}catch{}return response}
async function loadQvpPage(number){const pageNumber=Math.max(1,Math.min(604,Number(number)||1));if(!qvpPageCache.has(pageNumber))qvpPageCache.set(pageNumber,(async()=>{const pad=String(pageNumber).padStart(3,'0'),base='https://cdn.quran.ws/qvp/v0.5.0/'+pad,[module,qvpResponse,wordResponse]=await Promise.all([qvpModulePromise,fetchQvpResource(base+'.qvp'),fetchQvpResource(base+'.words.json')]),buffer=await qvpResponse.arrayBuffer();return {page:module.decodePage(buffer),geometry:module.decodeGeometry(buffer),wordData:await wordResponse.json()}})().catch(error=>{qvpPageCache.delete(pageNumber);throw error}));return qvpPageCache.get(pageNumber)}
function normalizeRecitationWord(text){return String(text||'').normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\ufeffـ]/g,'').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')}
function getRecitationTokenMap(surah,ayah){const key=recitationSvgPage+':'+Number(surah)+':'+Number(ayah);if(recitationTokenMaps.has(key))return recitationTokenMaps.get(key);const verse=reciteVerseCache.get(Number(surah))?.find(item=>item.numberInSurah===Number(ayah)),apiWords=String(verse?.text||'').split(/\s+/).filter(Boolean),pageWords=recitationQvpGeometry?.words||[],candidates=pageWords.map(record=>record).filter(record=>record.surah===Number(surah)&&record.ayah===Number(ayah));if(!apiWords.length||!candidates.length)return new Map();const variants=candidates.map(record=>new Set(Object.values(recitationQvpWordData?.[record.surah+':'+record.ayah+':'+record.word]||{}).map(normalizeRecitationWord).filter(Boolean))),tokens=apiWords.map(normalizeRecitationWord),rows=tokens.length+1,cols=candidates.length+1,dp=Array.from({length:rows},()=>new Uint16Array(cols));for(let i=tokens.length-1;i>=0;i--)for(let j=candidates.length-1;j>=0;j--)dp[i][j]=variants[j].has(tokens[i])?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);const mapping=new Map();let i=0,j=0;while(i<tokens.length&&j<candidates.length){if(variants[j].has(tokens[i])&&dp[i][j]===1+dp[i+1][j+1]){mapping.set(i,candidates[j].word);i++;j++}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++}recitationTokenMaps.set(key,mapping);return mapping}
function mapRecitationToken(surah,ayah,apiIndex){return getRecitationTokenMap(surah,ayah).get(Number(apiIndex))??Number(apiIndex)+1}
let baseLayer={key:'',canvas:null};
function drawRecitationQvpPage(){if(diagWpRecvAt&&!wpPendingAt)wpPendingAt=diagWpRecvAt;if(!pendingPaintAt)pendingPaintAt=performance.now();if(drawQueued)return;drawQueued=true;requestAnimationFrame(()=>{drawQueued=false;const started=performance.now();drawRecitationQvpPageNow();const done=performance.now();latencyStats.draw(done-started);if(pendingPaintAt){latencyStats.paint(done-pendingPaintAt);pendingPaintAt=0}if(wpPendingAt){const lagp=Date.now()-wpPendingAt;diag.mark('wp_paint',{ms:lagp});diag.sample('paint',lagp);wpPendingAt=0}})}
function drawRecitationQvpPageNow(){
 const host=document.getElementById('liveRecitationText'),canvas=host?.querySelector('.recitation-qvp-canvas');if(!host||!canvas||!recitationQvpPage||!recitationQvpGeometry)return;
 const availableWidth=Math.max(1,host.clientWidth),availableHeight=Math.max(1,host.clientHeight),ratio=recitationQvpPage.width/recitationQvpPage.height,scale=Math.min(availableWidth/recitationQvpPage.width,availableHeight/recitationQvpPage.height),displayWidth=Math.max(1,recitationQvpPage.width*scale),displayHeight=Math.max(1,recitationQvpPage.height*scale),dpr=Math.min(2,window.devicePixelRatio||1),pixelWidth=Math.round(displayWidth*dpr),pixelHeight=Math.round(displayHeight*dpr);
 // Resizing a canvas reallocates its bitmap, so only do it when the size really changed.
 if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.style.width=displayWidth+'px';canvas.style.height=displayHeight+'px';canvas.width=pixelWidth;canvas.height=pixelHeight;canvas.style.aspectRatio=String(ratio)}
 const ctx=canvas.getContext('2d'),ink='#263b31',fit=recitationQvpPage.fit(canvas,0),layerKey=[recitationSvgPage,pixelWidth,pixelHeight,recitationPreview].join(':');
 // Paper, decorations and (in preview) the printed words never change between events: draw them once per page and size.
 if(baseLayer.key!==layerKey||!baseLayer.canvas){const layer=baseLayer.canvas||document.createElement('canvas');layer.width=pixelWidth;layer.height=pixelHeight;const lctx=layer.getContext('2d');lctx.fillStyle='#f8f1df';lctx.fillRect(0,0,pixelWidth,pixelHeight);if(recitationPreview)recitationQvpPage.draw(lctx,{...fit,ink});recitationQvpPage.drawDecorations(lctx,{...fit,ink:'#c7a34c'});baseLayer={key:layerKey,canvas:layer}}
 ctx.drawImage(baseLayer.canvas,0,0);
 const buckets={revealed:[],correct:[],error:[],uncertain:[],hint:[],active:[]},activeBoxes=[],now=Date.now();
 recitationQvpGeometry.words.forEach((word,printedIndex)=>{const mapping=getRecitationTokenMap(word.surah,word.ayah);for(const [apiIndex,printedWord]of mapping){if(printedWord!==word.word)continue;const stateKey=`${word.surah}:${word.ayah}:${apiIndex}`,state=recitationWordStates.get(stateKey);if(state&&buckets[state]){buckets[state].push(printedIndex);if(state==='active')activeBoxes.push(word.box)}break}});
 if(activeBoxes.length){ctx.save();ctx.setTransform(fit.scale,0,0,fit.scale,fit.x,fit.y);ctx.fillStyle='#fff';for(const [x0,y0,x1,y1]of activeBoxes)ctx.fillRect(x0-2,y0-1,x1-x0+4,y1-y0+2);ctx.restore()}
 for(const [state,indices]of Object.entries(buckets)){if(indices.length){const color=state==='revealed'?ink:state==='correct'?'#246343':state==='error'?'#b23121':state==='uncertain'?'#86621f':state==='hint'?'#98652b':"#0b1414";recitationQvpPage.drawWords(ctx,indices,{...fit,ink:color})}}
 for(const [key,status]of recitationWordStates){if(status==='correct'&&recitationWordExpiry.get(key)<=now){recitationWordStates.set(key,'revealed');recitationWordExpiry.delete(key)}}
 if(recitationTrackingKey){const[trackSurah,trackAyah,trackIndex]=recitationTrackingKey.split(':').map(Number);let tracked=false;recitationQvpGeometry.words.forEach((word,printedIndex)=>{if(tracked||word.surah!==trackSurah||word.ayah!==trackAyah)return;const mapping=getRecitationTokenMap(word.surah,word.ayah);for(const [apiIndex,printedWord]of mapping){if(apiIndex!==trackIndex||printedWord!==word.word)continue;recitationQvpPage.drawWords(ctx,[printedIndex],{...fit,ink:'#7d7455'});const [x0,y0,x1,y1]=word.box;ctx.save();ctx.setTransform(fit.scale,0,0,fit.scale,fit.x,fit.y);ctx.strokeStyle='#7d7455';ctx.lineWidth=2.5;ctx.setLineDash([7,5]);ctx.beginPath();ctx.moveTo(x0-2,y1+4);ctx.lineTo(x1+2,y1+4);ctx.stroke();ctx.restore();tracked=true;break}})}
}
async function showRecitationPage(pageNumber,{reveal=[]}={}){const host=document.getElementById('liveRecitationText');pageNumber=Math.max(1,Math.min(604,Number(pageNumber)||1));if(recitationSvgPage===pageNumber&&host.querySelector('.recitation-qvp-canvas')){drawRecitationQvpPage();if(!document.querySelector('.recitation-mushaf-paper.awaiting-match')){document.getElementById('recitationSurahMeta').textContent=`صفحة ${toArabic(pageNumber)} · الآيات مرقّمة والكلمات تظهر مع القراءة`}return}const current=++recitationSvgRequest;recitationSvgPage=pageNumber;host.innerHTML='<p class="quran-loading">جارٍ تجهيز صفحة المصحف…</p>';document.getElementById('recitationReader').hidden=!document.body.classList.contains('recitation-session-active');diag.mark('page_load_start',{page:pageNumber});try{const data=await loadQvpPage(pageNumber);diag.mark('page_loaded',{page:pageNumber});if(current!==recitationSvgRequest)return;recitationQvpPage=data.page;recitationQvpGeometry=data.geometry;recitationQvpWordData=data.wordData;recitationTokenMaps.clear();host.replaceChildren();const canvas=document.createElement('canvas');canvas.className='recitation-qvp-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','صفحة المصحف '+toArabic(pageNumber)+'؛ الكلمات تظهر مع التلاوة');host.append(canvas);drawRecitationQvpPage();document.getElementById('recitationPageNumber').textContent=`صفحة ${toArabic(pageNumber)}`;document.getElementById('recitationSurahMeta').textContent=`صفحة ${toArabic(pageNumber)} · الآيات مرقّمة والكلمات تظهر مع القراءة`;document.getElementById('recitationWaiting').hidden=!document.querySelector('.recitation-mushaf-paper.awaiting-match')&&true;if(recitationRenderTimer)clearTimeout(recitationRenderTimer);recitationRenderTimer=setTimeout(drawRecitationQvpPage,850)}catch{if(current!==recitationSvgRequest)return;host.innerHTML='<p class="recitation-empty">تعذّر تحميل صفحة المصحف. تحقق من الاتصال وحاول مرة أخرى.</p>'}}
async function revealRecitedAyah(surah,ayah){
  diag.mark('reveal_start');let verses=reciteVerseCache.get(Number(surah));if(!verses){await ensureRecitationSurah(Number(surah));verses=reciteVerseCache.get(Number(surah));}
  if(liveCurrentVerse&&(liveCurrentVerse.surah!==Number(surah)||liveCurrentVerse.ayah!==Number(ayah)))return;
  const verse=verses?.find(item=>item.numberInSurah===Number(ayah));diag.mark('reveal_verses',{ok:Boolean(verse?.page)});if(!verse?.page)return;
  const pageChanged=Number(verse.page)!==recitationSvgPage;await showRecitationPage(verse.page);if(pageChanged&&liveAudioContext)document.getElementById('recitationReader').scrollIntoView({behavior:'smooth',block:'start'});
}
async function openRecitationSurah(number,range=null){
  const request=++recitationRequest,host=document.getElementById('liveRecitationText'),entry=reciteCatalog.find(s=>s.number===Number(number));if(!entry)return;
  host.innerHTML='<p class="quran-loading">جارٍ تجهيز صفحة المصحف…</p>';
  try{const result=reciteVerseCache.has(entry.number)?{data:{ayahs:reciteVerseCache.get(entry.number)}}:await getQuranJson(`${quranApi}/surah/${entry.number}/quran-uthmani`);if(request!==recitationRequest)return;activeReciteSurah=entry.number;const verses=result.data.ayahs;reciteVerseCache.set(entry.number,verses);const from=range?.from||1,to=range?.to||verses.length;document.getElementById('recitationReader').hidden=!document.body.classList.contains('recitation-session-active');document.getElementById('recitationSurahName').textContent=entry.name;document.getElementById('recitationSurahMeta').textContent=range?`الآيات ${toArabic(from)}–${toArabic(to)} · مخفية حتى تبدأ`:`${toArabic(entry.numberOfAyahs)} آيات · مخفية حتى تبدأ`;localStorage.setItem('rattil-last-surah',String(entry.number));await showRecitationPage(verses.find(a=>a.numberInSurah===from)?.page||page,{reveal:[]});
    if(asrWorker&&activeReciteMode==='review')asrWorker.postMessage({type:'set_expected',passage:{surah:entry.number,ayah:from,ayahEnd:to}});
  }catch{if(request!==recitationRequest)return;host.innerHTML='<p class="recitation-empty">تعذر تحميل الآيات. تحقق من اتصال الإنترنت وحاول مرة أخرى.</p>';}
}
async function ensureRecitationSurah(number){if(reciteVerseCache.has(Number(number)))return;if(pendingReciteSurah===number&&pendingReciteLoad)return pendingReciteLoad;pendingReciteSurah=number;pendingReciteLoad=(async()=>{const result=await getQuranJson(`${quranApi}/surah/${number}/quran-uthmani`);reciteVerseCache.set(Number(number),result.data.ayahs);activeReciteSurah=Number(number)})();try{await pendingReciteLoad}finally{pendingReciteSurah=0;pendingReciteLoad=null}}
function saveRecitationWord(surah,ayah,index,status,displayStatus=status,transientMs=0,redraw=true,errorSource){
  const verse=reciteVerseCache.get(Number(surah))?.find(item=>item.numberInSurah===Number(ayah)),text=String(verse?.text||'').split(/\s+/).filter(Boolean)[index]||'';if(!text)return;
  const key=`${surah}:${ayah}:${index}`;recitationWordStates.set(key,displayStatus);if(transientMs){const expires=Date.now()+transientMs;recitationWordExpiry.set(key,expires);setTimeout(()=>{if(recitationWordExpiry.get(key)===expires){recitationWordStates.set(key,'revealed');recitationWordExpiry.delete(key);drawRecitationQvpPage()}},transientMs+20)}else recitationWordExpiry.delete(key);
  if(currentRecitationSession){const existing=currentRecitationSession.words.find(item=>item.key===key);const incoming={key,surah:Number(surah),ayah:Number(ayah),index,text,status};if(status==='error')incoming.errorSource=(existing?.errorSource==='rescore'||errorSource==='rescore')?'rescore':(errorSource||existing?.errorSource);if(existing)Object.assign(existing,mergeWord(existing,incoming));else currentRecitationSession.words.push(mergeWord(null,incoming));}
  if(redraw)drawRecitationQvpPage();
}
async function backfillHeardWords(){
 try{
  if(activeReciteMode==='review'){heardBackfillDone=true;return}
  const target=heardBackfillTarget;if(!target)return;
  const heard=heardTranscript;if(!heard)return;
  if(Date.now()-target.at>12000){heardBackfillDone=true;heardBackfillTarget=null;heardTranscript='';return}
  await ensureRecitationSurah(target.surah);const all=reciteVerseCache.get(target.surah)||[];
  const verses=all.filter(item=>item.numberInSurah<target.ayah).map(item=>({surah:target.surah,ayah:item.numberInSurah,words:String(item.text||'').split(/\s+/).filter(Boolean)}));
  const marks=backfillFromHeard(heard,verses,target.ayah);
  const mine=all.find(item=>item.numberInSurah===target.ayah);
  if(mine){const confirmed=new Set();for(const key of recitationWordStates.keys()){const parts=key.split(':');if(Number(parts[0])===target.surah&&Number(parts[1])===target.ayah)confirmed.add(Number(parts[2]))}
   for(const index of backfillMatchedAyah(heard,String(mine.text||'').split(/\s+/).filter(Boolean),confirmed))marks.push({surah:target.surah,ayah:target.ayah,from:index,to:index})}
  let restored=0;
  for(const mark of marks)for(let index=mark.from;index<=mark.to;index++){const key=`${mark.surah}:${mark.ayah}:${index}`;if(recitationWordStates.has(key))continue;saveRecitationWord(mark.surah,mark.ayah,index,'uncertain','uncertain',0,false);restored++}
  if(restored){heardBackfillDone=true;heardBackfillTarget=null;heardTranscript='';drawRecitationQvpPage();document.getElementById('asrResult').textContent+=` · استرجعنا ${toArabic(restored)} كلمة من البداية كمسموع غير مؤكد`}
 }catch{}
}
function applyTentativeCursor(message){
 const surah=Number(message.surah),ayah=Number(message.ayah),reported=Number(message.word_index);if(!Number.isInteger(reported))return;
 const verse=reciteVerseCache.get(surah)?.find(item=>item.numberInSurah===ayah);if(!verse)return;
 const tokenCount=String(verse.text||'').split(/\s+/).filter(Boolean).length;if(!tokenCount)return;
 const engineMap=engineTokenMap(String(verse.text||'').split(/\s+/).filter(Boolean));const cursor=Math.min(tokenCount-1,Math.max(0,engineMap[reported]??0)),key=`${surah}:${ayah}:${cursor}`;
 const next=key===recitationActiveWordKey?'':key;
 if(recitationTrackingKey===next)return;
 recitationTrackingKey=next;drawRecitationQvpPage();
}
function settleActiveRecitationWord(){if(!recitationActiveWordKey)return;const [surah,ayah,index]=recitationActiveWordKey.split(':').map(Number);if(Number.isInteger(surah)&&Number.isInteger(ayah)&&Number.isInteger(index))saveRecitationWord(surah,ayah,index,'correct','correct',850);recitationActiveWordKey='';}
function applyRecognizedWords(message){
  const surah=Number(message.surah),ayah=Number(message.ayah);if(!reciteVerseCache.has(surah)){ensureRecitationSurah(surah).then(()=>{if(liveCurrentVerse?.surah===surah&&liveCurrentVerse?.ayah===ayah)applyRecognizedWords(message)});return;}
  const verse=reciteVerseCache.get(surah)?.find(item=>item.numberInSurah===ayah),tokens=String(verse?.text||'').split(/\s+/).filter(Boolean),tokenCount=tokens.length,engineMap=engineTokenMap(tokens),indices=new Set(Array.isArray(message.matched_indices)?message.matched_indices.map(Number).filter(index=>Number.isInteger(index)&&index>=0).map(index=>engineMap[index]).filter(index=>Number.isInteger(index)&&index<tokenCount):[]),reportedRaw=Number(message.word_index),reported=Number.isInteger(reportedRaw)?(engineMap[reportedRaw]??tokenCount-1):reportedRaw,last=Number.isInteger(reportedRaw)?Math.min(tokenCount-1,reported-1):Math.max(-1,...indices),active=indices.size?Math.max(...indices):last,previous=recitationLastConfirmedIndex;
  if(active>=0&&recitationActiveWordKey!==`${surah}:${ayah}:${active}`)settleActiveRecitationWord();for(const index of indices){saveRecitationWord(surah,ayah,index,'correct',index===active?'active':'correct',index===active?0:850,false)}
  if(last>previous){for(let index=Math.max(engineMap[0]??0,previous+1);index<last;index++){if(!indices.has(index)&&hasRecitationLetters(tokens[index]))pendingRecitationMisses.add(index)}recitationLastConfirmedIndex=Math.max(previous,last)}for(let index=engineMap[0]??0;index<=last&&index<tokenCount;index++){if(!hasRecitationLetters(tokens[index])&&!recitationWordStates.has(`${surah}:${ayah}:${index}`))saveRecitationWord(surah,ayah,index,'revealed','revealed',0,false)}for(const index of [...pendingRecitationMisses]){if(index<=last-2){if(!indices.has(index))saveRecitationWord(surah,ayah,index,'uncertain','uncertain',0,false);pendingRecitationMisses.delete(index)}}drawRecitationQvpPage();
  if(active>=0){const printedWord=mapRecitationToken(surah,ayah,active),exists=recitationQvpGeometry?.words.some(word=>word.surah===surah&&word.ayah===ayah&&word.word===printedWord);if(!exists&&recitationSvgPage<604)loadQvpPage(recitationSvgPage+1).then(next=>{if(next.geometry.words.some(word=>word.surah===surah&&word.ayah===ayah&&word.word===printedWord))showRecitationPage(recitationSvgPage+1)}).catch(()=>{});recitationActiveWordKey=`${surah}:${ayah}:${active}`}
}

function diagStart(){diag.reset();diagWorkerLog=null;wpPendingAt=0;diagWpRecvAt=0;diagWpKey='';diagLastChunk=0;const c=liveAudioContext;diag.mark('ctx',{sampleRate:c.sampleRate,baseLatency:c.baseLatency,state:c.state,ua:navigator.userAgent});clearInterval(diagHb);let last=Date.now();diagHb=setInterval(()=>{const n=Date.now(),late=Math.max(0,n-last-100);last=n;diag.sample('loop',late);diag.bucket(n,'loop',late)},100)}
function diagChunk(at){const n=Date.now();if(!diagLastChunk)diag.mark('chunk_first',{at});else{const gap=n-diagLastChunk;diag.sample('gap',gap);if(gap>250)diag.mark('chunk_gap',{gap})}diagLastChunk=n;diag.sample('deliver',n-at);diag.bucket(n,'deliver',n-at)}
function diagRecv(m){const e=m.event||{},now=Date.now();if(m.wt)diag.sample('transport',now-m.wt);if(e.type==='word_progress'){const key=e.ayah+':'+(e.matched_indices||[]).length+':'+e.word_index;if(key!==diagWpKey){diagWpKey=key;diagWpRecvAt=now;diag.mark('ev_recv',{type:'word_progress',wt:m.wt||now,a:m.a})}}else if(e.type==='verse_match'){diagWpRecvAt=(pendingWordProgress[0]&&pendingWordProgress[0].at)||now;diag.mark('ev_recv',{type:'verse_match',wt:m.wt||now,a:m.a})}}
function diagEnabled(){try{if(new URLSearchParams(location.search).get('diag')==='1')localStorage.setItem('rattil-diag','1');return localStorage.getItem('rattil-diag')==='1'}catch{return false}}
function renderDiagPanel(){if(!diagEnabled())return;const host=document.getElementById('diagPanel');if(!host)return;const report=buildDiagReport(diag.snapshot(),diagWorkerLog);host.hidden=false;document.getElementById('diagText').textContent=renderDiagLines(report).join('\n');document.getElementById('diagJson').value=JSON.stringify(report);window.__rattilDiag=report;window.__rattilDiagRaw={main:diag.snapshot(),worker:diagWorkerLog}}
document.getElementById('diagCopy')?.addEventListener('click',async()=>{const ta=document.getElementById('diagJson'),btn=document.getElementById('diagCopy');try{await navigator.clipboard.writeText(ta.value);btn.textContent='تم النسخ'}catch{ta.hidden=false;ta.select();btn.textContent='حدّد النص وانسخه'}});
function showPerfSummary(){
 const summary=latencyStats.summary();if(!summary)return;
 try{localStorage.setItem('rattil-last-perf',JSON.stringify(summary))}catch{}
 renderPerfReadout(summary);
}
function renderPerfReadout(summary){
 const host=document.getElementById('perfReadout');if(!host||!summary)return;
 const n=value=>toArabic(String(value));
 host.hidden=false;host.textContent=`قياس السرعة على جهازك (آخر جلسة ${n(summary.audioSeconds)} ث): المحرك أسرع من صوتك ${n(summary.engineSpeed)} مرة. تأخير المعالجة المعتاد ${n(summary.lagMedianMs)} م.ث وأسوأ ${n(summary.lagMaxMs)}. رسم المصحف ${n(summary.drawMedianMs)} م.ث. أول كلمة ظهرت بعد ${summary.firstWordSec==null?'لم تظهر':n(summary.firstWordSec)+' ث'}.`;
}
try{renderPerfReadout(JSON.parse(localStorage.getItem('rattil-last-perf')||'null'))}catch{}
function savedRecitationHistory(){try{const items=JSON.parse(readStore('rattil-recitation-history','[]'));return Array.isArray(items)?items.filter(s=>s&&Number.isFinite(s.startedAt)&&Array.isArray(s.words)):[]}catch{return []}}
function finalizeRecitationSession(){if(!currentRecitationSession)return {session:null,saved:false};const session=currentRecitationSession;let saved=false;session.endedAt=Date.now();if(session.words.length||session.startedAt){const history=savedRecitationHistory();history.push(session);saved=writeStore('rattil-recitation-history',JSON.stringify(history.slice(-30)));}currentRecitationSession=null;renderRecitationHistory();renderProgress();updatePracticeSummary();renderMistakesLog();return {session,saved};}
function updatePracticeSummary(){const sessions=savedRecitationHistory(),weekAgo=Date.now()-7*86400000,recent=sessions.filter(session=>Number(session.startedAt)>=weekAgo),minutes=Math.round(recent.reduce((sum,session)=>sum+Math.max(0,(Number(session.endedAt||session.startedAt)-Number(session.startedAt||0))/60000),0));document.getElementById('practiceWeekSummary').textContent=recent.length?`${toArabic(recent.length)} جلسات · ${toArabic(minutes)} دقيقة هذا الأسبوع`:'اختار طريقة التسميع اللي تناسبك.';}
function renderRecitationHistory(){
  const list=document.getElementById('recitationHistoryList'),sessions=savedRecitationHistory();list.replaceChildren();
  document.getElementById('clearSessionHistory').hidden=!sessions.length;
  if(!sessions.length){const empty=document.createElement('p');empty.className='recitation-history-empty';empty.textContent='أول جلسة تبدأ من هنا. نتائجك وتلميحاتك هتفضل على جهازك فقط.';list.append(empty);return;}
  sessions.slice().reverse().forEach(session=>{
    const details=document.createElement('details');details.className='recitation-history-entry';
    const summary=document.createElement('summary'),stats=sessionStats(session);
    summary.textContent=`${new Date(session.startedAt).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'})} · ${session.mode==='review'?'تسميع محدد':'متابعة'} · ${toArabic(stats.touched)} كلمة`;
    details.append(summary);
    const caption=document.createElement('p');caption.textContent=`${toArabic(stats.followed)} تابعها المحرك · ${toArabic(stats.hints)} تلميح · ${toArabic(stats.review)} للمراجعة`;
    const review=buildSessionSummary(session);
    if(review.counts.touched){
      details.append(sessionSummaryCountsNode(review));
      const open=document.createElement('button');open.type='button';open.className='quiet-link';open.textContent='عرض ملخص الجلسة';open.addEventListener('click',()=>openSessionSummary(session));details.append(open);
    }
    const caveat=document.createElement('small');caveat.textContent='دي نتيجة متابعة آلية، مش حكم على صحة التلاوة. المواضع تشمل تلميحاتك وما لم يتابعه المحرك بوضوح.';
    details.append(caption,caveat);if(session.previews){const preview=document.createElement('p');preview.textContent=`فتحت معاينة الصفحة ${toArabic(session.previews)} مرة أثناء الجلسة.`;details.append(preview);}
    const grouped=new Map();(session.words||[]).forEach(word=>{if(!(word.hinted||['hint','error','uncertain'].includes(word.status)))return;const key=`${word.surah}:${word.ayah}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(word)});
    if(!stats.touched){const empty=document.createElement('p');empty.textContent='لم يتابع المحرك كلمات في هذه الجلسة. لا يعني ذلك خطأ في قراءتك.';details.append(empty)}
    grouped.forEach(words=>{
      const group=document.createElement('div'),label=document.createElement('small'),body=document.createElement('div'),retry=document.createElement('button');
      group.className='recitation-history-verse';label.textContent=`${getSurahName(words[0].surah)} · الآية ${toArabic(words[0].ayah)}`;body.className='recitation-history-words';
      words.sort((a,b)=>a.index-b.index).forEach(word=>{const span=document.createElement('span');span.className=word.hinted?'hint':word.status==='error'?'error':'uncertain';span.textContent=`${word.text} `;body.append(span);if(word.status==='error'&&!word.hinted){const verdict=session.verdicts?.[word.key];if(verdict){const kind=document.createElement('span');kind.className='mistake-kind';kind.textContent=mistakeKindLabel(isFlagged(verdict)?classifyVerdict(verdict).kind:null);body.append(kind)}}});
      retry.type='button';retry.className='quiet-link';retry.textContent='راجع الآية';retry.addEventListener('click',async()=>{showView('quran');try{await ensureRecitationSurah(words[0].surah);const verse=reciteVerseCache.get(words[0].surah)?.find(v=>v.numberInSurah===words[0].ayah);if(verse?.page)setPage(verse.page);else announce('تعذر تحديد الصفحة. افتح الفهرس للمحاولة.')}catch{announce('تعذر تحميل موضع الآية. تحقق من الاتصال.')}});
      group.append(label,body,retry);details.append(group);
    });list.append(details);
  });
}
function sessionSummaryCountsNode(summary){
  const counts=summary.counts,row=document.createElement('p');row.className='session-summary-counts';
  const parts=[`${toArabic(counts.correct)} صح`,`${toArabic(counts.wrong)} غلط محتمل`,`${toArabic(counts.unsure)} غير مؤكدة`];
  if(counts.hinted)parts.push(`${toArabic(counts.hinted)} صح بتلميح`);
  if(counts.unreviewed)parts.push(`${toArabic(counts.unreviewed)} لم تُفحص صوتيًا`);
  row.textContent=parts.join(' · ');return row;
}
function sessionSummaryLegendNode(){
  const legend=document.createElement('small');legend.className='session-summary-caveat';
  legend.textContent='صح = المحرك فحص الكلمة صوتيًا وما رصدش فيها غلط واضح · صح بتلميح = اتساعدت بتلميح · غير مؤكدة = المحرك شك من غير تأكيد · لم تُفحص = المتابعة وصلتلها من غير فحص صوتي.';
  return legend;
}
function sessionSummaryCaveatNode(summary){
  const note=document.createElement('small');note.className='session-summary-caveat';
  if(summary.rescoreUnavailable)note.textContent='الفحص الصوتي للغلطات ما اتاحش في الجلسة دي؛ النتيجة متابعة بس من غير فحص غلطات.';
  else if(!summary.counts.judged)note.textContent='الفحص الصوتي لم يغطِّ كلمات الجلسة دي، فلا يوجد فحص غلطات لها.';
  else if(!summary.counts.wrong)note.textContent=`المحرك فحص صوتيًا ${toArabic(summary.counts.judged)} من ${toArabic(summary.counts.touched)} كلمة وما رصدش فيها غلطات واضحة. ده مش تأكيد إن التلاوة كلها صحيحة.`;
  else note.textContent=`المحرك فحص صوتيًا ${toArabic(summary.counts.judged)} من ${toArabic(summary.counts.touched)} كلمة. النتيجة تقديرية وقد تخطئ، ولا تقيّم أحكام التجويد.`;
  return note;
}
function sessionMistakesNode(summary,withReviewButtons){
  const host=document.createElement('div');host.className='session-summary-mistakes';
  if(!summary.mistakes.length)return host;
  const grouped=new Map();
  for(const mistake of summary.mistakes){const key=`${mistake.surah}:${mistake.ayah}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(mistake);}
  grouped.forEach(items=>{
    const group=document.createElement('div');group.className='recitation-history-verse';
    const label=document.createElement('small');label.textContent=`${getSurahName(items[0].surah)} · الآية ${toArabic(items[0].ayah)}`;
    const body=document.createElement('div');body.className='recitation-history-words';
    items.sort((a,b)=>a.index-b.index).forEach(mistake=>{
      const span=document.createElement('span');span.className='error';span.textContent=`${mistake.text} `;body.append(span);
      const kind=document.createElement('span');kind.className='mistake-kind';kind.textContent=mistakeKindLabel(mistake.kind);body.append(kind);
    });
    group.append(label,body);
    if(withReviewButtons){const retry=document.createElement('button');retry.type='button';retry.className='quiet-link';retry.textContent='راجع الآية';retry.addEventListener('click',async()=>{showView('quran');try{await ensureRecitationSurah(items[0].surah);const verse=reciteVerseCache.get(items[0].surah)?.find(v=>v.numberInSurah===items[0].ayah);if(verse?.page)setPage(verse.page);else announce('تعذر تحديد الصفحة. افتح الفهرس للمحاولة.')}catch{announce('تعذر تحميل موضع الآية. تحقق من الاتصال.')}});group.append(retry);}
    host.append(group);
  });
  return host;
}
function openSessionSummary(session){
  const dialog=document.getElementById('sessionSummaryDialog'),content=document.getElementById('sessionSummaryContent');
  if(!dialog||!content)return;
  const summary=buildSessionSummary(session);content.replaceChildren();
  content.append(sessionSummaryCountsNode(summary));
  const headline=document.createElement('p');headline.className='session-summary-headline';
  headline.textContent=summary.rescoreUnavailable?'الفحص الصوتي ما كانش متاح في الجلسة دي؛ الأرقام من المتابعة الحية بس.':(summary.counts.wrong?`رصد المحرك ${toArabic(summary.counts.wrong)} موضع محتاج مراجعة:`:(summary.counts.judged?'المحرك ما رصدش غلطات واضحة في الكلمات اللي فحصها صوتيًا.':'مفيش فحص غلطات للجلسة دي.'));
  content.append(headline,sessionMistakesNode(summary,true),sessionSummaryLegendNode(),sessionSummaryCaveatNode(summary));
  content.onclick=event=>{if(event.target?.classList?.contains('quiet-link'))dialog.close()};
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
}
function renderMistakesLog(){
  const panel=document.getElementById('mistakesPanel'),list=document.getElementById('mistakesList');
  if(!panel||!list)return;
  const items=aggregateMistakes(savedRecitationHistory());list.replaceChildren();
  panel.hidden=!items.length;
  if(!items.length)return;
  items.forEach(item=>{
    const row=document.createElement('div');row.className='mistakes-log-entry';
    const word=document.createElement('span');word.className='error';word.textContent=item.text;
    const detail=document.createElement('small');
    const when=item.last?new Date(item.last).toLocaleString('ar-EG',{dateStyle:'medium'}):'';
    detail.textContent=`${getSurahName(item.surah)} · الآية ${toArabic(item.ayah)} · ${mistakeKindLabel(item.kind)} · ${toArabic(item.sessions)} ${item.sessions===1?'مرة':'مرات'}${when?` · آخرها ${when}`:''}`;
    const retry=document.createElement('button');retry.type='button';retry.className='quiet-link';retry.textContent='راجع الآية';
    retry.addEventListener('click',async()=>{showView('quran');try{await ensureRecitationSurah(item.surah);const verse=reciteVerseCache.get(item.surah)?.find(v=>v.numberInSurah===item.ayah);if(verse?.page)setPage(verse.page);else announce('تعذر تحديد الصفحة. افتح الفهرس للمحاولة.')}catch{announce('تعذر تحميل موضع الآية. تحقق من الاتصال.')}});
    row.append(word,detail,retry);list.append(row);
  });
}
document.getElementById('reviewSurah').addEventListener('change',async event=>{const number=Number(event.target.value),entry=reciteCatalog.find(s=>s.number===number);if(!entry)return;recitationPreview=false;recitationWordStates.clear();recitationWordExpiry.clear();document.getElementById('toggleReciteText').textContent='معاينة';document.getElementById('toggleReciteText').setAttribute('aria-pressed','false');const from=document.getElementById('reviewFrom'),to=document.getElementById('reviewTo');from.max=to.max=entry.numberOfAyahs;from.value='1';to.value=String(Math.min(10,entry.numberOfAyahs));await openRecitationSurah(number,{from:1,to:Math.min(10,entry.numberOfAyahs)});document.getElementById('startRec').disabled=!asrReady;});
async function startSelectedReview(){const number=Number(document.getElementById('reviewSurah').value),from=Number(document.getElementById('reviewFrom').value),to=Number(document.getElementById('reviewTo').value),entry=reciteCatalog.find(s=>s.number===number),verses=reciteVerseCache.get(number);if(!entry||!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>entry.numberOfAyahs){document.getElementById('reviewSetupStatus').textContent='راجع نطاق الآيات؛ النهاية لازم تكون بعد البداية وداخل السورة.';return}if(!verses){document.getElementById('reviewSetupStatus').textContent='جارٍ تحميل آيات السورة؛ انتظر لحظات.';return}document.getElementById('reviewSetupStatus').textContent='';writeStore('rattil-review-from',from);writeStore('rattil-review-to',to);activeReciteMode='review';setAwaitingMatch(false);activeReciteSurah=number;reciteRange={from,to};recitationPreview=false;document.getElementById('toggleReciteText').textContent='معاينة';document.getElementById('toggleReciteText').setAttribute('aria-pressed','false');document.getElementById('recitationSurahName').textContent=entry.name;document.getElementById('recitationSurahMeta').textContent=`الآيات ${toArabic(from)}–${toArabic(to)} · مخفية حتى تبدأ`;const pageTask=showRecitationPage(verses.find(a=>a.numberInSurah===from)?.page||page,{reveal:[]});if(asrReady)asrWorker.postMessage({type:'set_mode',mode:'correction'});if(asrReady)asrWorker.postMessage({type:'set_expected',passage:{surah:number,ayah:from,ayahEnd:to}});const recordingTask=startLiveRecording();await Promise.all([pageTask,recordingTask]);}
document.getElementById('loadAsr').addEventListener('click',loadAsr);
document.getElementById('startFollow').addEventListener('click',async()=>{activeReciteMode='follow';setAwaitingMatch(true);{const pr=document.getElementById('perfReadout');if(pr)pr.hidden=true;const ar=document.getElementById('asrResult');if(ar)ar.textContent='التعرف على الآية والكلمات تقريبي وقد يخطئ.'}activeReciteSurah=0;recitationPreview=false;document.getElementById('toggleReciteText').textContent='معاينة';document.getElementById('toggleReciteText').setAttribute('aria-pressed','false');if(asrWorker){asrWorker.postMessage({type:'set_mode',mode:'tracking'});asrWorker.postMessage({type:'set_expected',passage:null});}document.getElementById('recitationSurahName').textContent='اتبع قراءتك';const pageTask=showRecitationPage(Number(readStore('rattil-page','42'))||42,{reveal:[]});document.getElementById('recitationSurahMeta').textContent='الآيات مخفية · ستظهر مع تقدّم قراءتك';document.getElementById('recitationStartLabel').textContent='ابدأ من أي مكان';const recordingTask=startLiveRecording();await Promise.all([pageTask,recordingTask]);});
document.getElementById('startReview').addEventListener('click',startSelectedReview);
document.getElementById('startRec').addEventListener('click',()=>activeReciteMode==='review'?startSelectedReview():startLiveRecording());
document.getElementById('stopRec').addEventListener('click',stopLiveRecording);
function enterRecitationSessionView(){recitationSessionCancelled=false;document.getElementById('recitationSetupDialog').close();document.body.classList.add('recitation-session-active');document.getElementById('startFollow').disabled=true;document.getElementById('startReview').disabled=true;document.getElementById('recitationReader').hidden=false;document.querySelector('.recitation-controls').hidden=false;document.getElementById('recitationWaiting').hidden=false;window.scrollTo({top:0,behavior:'instant'});}
document.getElementById('startFollow').addEventListener('click',enterRecitationSessionView,{capture:true});
document.getElementById('startReview').addEventListener('click',event=>{const from=Number(document.getElementById('reviewFrom').value),to=Number(document.getElementById('reviewTo').value),entry=reciteCatalog.find(item=>item.number===Number(document.getElementById('reviewSurah').value));if(entry&&Number.isInteger(from)&&Number.isInteger(to)&&from>=1&&to>=from&&to<=entry.numberOfAyahs)enterRecitationSessionView();},{capture:true});
document.getElementById('exitRecitation').addEventListener('click',async()=>{recitationSessionCancelled=true;if(liveAudioContext)await stopLiveRecording();document.body.classList.remove('recitation-session-active','recitation-session-paused');document.getElementById('recitationReader').hidden=true;document.querySelector('.recitation-controls').hidden=true;document.getElementById('startFollow').disabled=!asrReady;document.getElementById('startReview').disabled=!asrReady;});
document.getElementById('toggleReciteText').addEventListener('click',event=>{recitationPreview=!recitationPreview;if(recitationPreview&&currentRecitationSession)currentRecitationSession.previews=(currentRecitationSession.previews||0)+1;const button=event.currentTarget;button.textContent=recitationPreview?'إخفاء':'معاينة';button.setAttribute('aria-pressed',String(recitationPreview));drawRecitationQvpPage();document.getElementById('recitationWaiting').hidden=recitationPreview||Boolean(liveCurrentVerse);});
window.addEventListener('resize',drawRecitationQvpPage,{passive:true});
document.querySelectorAll('[data-correction-action]').forEach(button=>button.addEventListener('click',()=>{if(asrWorker)asrWorker.postMessage({type:'correction_action',action:button.dataset.correctionAction});}));
function stopAsrWorker(){if(asrWorker){asrWorker.terminate();asrWorker=null;}asrReady=false;}
async function loadAsr(){const button=document.getElementById('loadAsr');button.disabled=true;asrStatus('بدء محرك التسميع…');try{stopAsrWorker();asrWorker=new Worker(new URL('./asr-worker.js',import.meta.url),{type:'module'});asrWorker.onmessage=async event=>{const message=event.data||{};if(message.type==='loading_status')asrStatus(message.message);else if(message.type==='loading')asrStatus('تم حفظ '+(message.percent||0)+'٪ من النموذج. لو قفلت، التحميل هيكمل من آخر جزء محفوظ.');else if(message.type==='ready'){asrReady=true;writeStore('rattil-asr-installed','true');document.getElementById('engineSetupPanel').hidden=true;updatePracticeSummary();button.textContent='المحرك جاهز';button.disabled=true;asrStatus('المحرك جاهز ومحفوظ على هذا الجهاز.');document.getElementById('startFollow').disabled=false;document.getElementById('startReview').disabled=false;document.getElementById('startRec').disabled=activeReciteMode==='review'&&!activeReciteSurah;}else if(message.type==='error'){asrReady=false;if(liveAudioContext)stopLiveRecording();writeStore('rattil-asr-installed','false');document.getElementById('engineSetupPanel').hidden=false;asrStatus('تعذر تشغيل محرك التسميع: '+message.message);button.textContent='استكمال';button.disabled=false;}else if(message.type==='perf')latencyStats.worker(message);else if(message.type==='event'){try{diagRecv(message)}catch{}try{handleRecitationEvent(message.event)}finally{diagWpRecvAt=0}}else if(message.type==='diag')diagWorkerLog=message.log;else if(message.type==='stopped'){await Promise.all([...settledUiTasks]);recitationStopping=false;recitationTrackingKey='';showPerfSummary();try{renderDiagPanel()}catch{}document.getElementById('startFollow').disabled=!asrReady;document.getElementById('startReview').disabled=!asrReady;document.getElementById('reciteLiveIndicator').textContent='تم حفظ الجلسة على جهازك';settleActiveRecitationWord();const {session:finishedSession,saved}=finalizeRecitationSession();document.getElementById('reciteLiveIndicator').textContent=saved?'تم حفظ الجلسة على جهازك':'تعذر حفظ الجلسة على الجهاز';if(finishedSession&&finishedSession.words.length)openSessionSummary(finishedSession);if(document.body.classList.contains('recitation-session-paused'))document.getElementById('startRec').disabled=!asrReady}};asrWorker.onerror=()=>{asrReady=false;if(liveAudioContext)stopLiveRecording();writeStore('rattil-asr-installed','false');document.getElementById('engineSetupPanel').hidden=false;asrStatus('توقف المحرك. حاول مرة أخرى؛ الأجزاء المحفوظة لن تُحذف.');button.disabled=false;};asrWorker.postMessage({type:'init',baseUrl:document.baseURI});}catch(error){document.getElementById('engineSetupPanel').hidden=false;asrStatus('تعذر بدء المحرك: '+(error.message||error));button.disabled=false;}}
async function clearAsrCache(){if(liveAudioContext){asrStatus('أوقف التسميع أولًا قبل حذف المحرك.');return;}stopAsrWorker();writeStore('rattil-asr-installed','false');document.getElementById('engineSetupPanel').hidden=false;try{const request=indexedDB.open('rattil-zipformer-assets',1),db=await new Promise((resolve,reject)=>{request.onupgradeneeded=()=>request.result.createObjectStore('assets');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();document.getElementById('loadAsr').textContent='تحميل المحرك';document.getElementById('loadAsr').disabled=false;document.getElementById('startFollow').disabled=true;document.getElementById('startReview').disabled=true;asrStatus('حُذف محرك التسميع من هذا الجهاز.');}catch(error){asrStatus('تعذر حذف الملفات المحفوظة: '+error.message);}}
document.getElementById('clearAsrCache').addEventListener('click',clearAsrCache);
function sendAudioChunk(samples,sentAt=Date.now(),owned=false){if(!asrWorker||!asrReady||!samples.length)return;const copy=owned?samples:samples.slice();asrWorker.postMessage({type:'audio',samples:copy,sentAt,mt:Date.now()},[copy.buffer]);}
async function startLiveRecording(){if(appUpdating){asrStatus("انتظر اكتمال تحديث النسخة.");return}if(recitationStopping)return;if(!asrReady||!asrWorker){asrStatus('حمّل محرك التسميع أولًا.');return;}if(!navigator.mediaDevices?.getUserMedia||(!window.AudioContext&&!window.webkitAudioContext)){asrStatus('الميكروفون غير متاح في هذا المتصفح. افتح رتل عبر Safari على HTTPS.');return;}recitationSessionCancelled=false;if(liveAudioContext)return;const continuing=document.body.classList.contains('recitation-session-paused');try{recitationStarting=true;const mediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});recitationStarting=false;if(recitationSessionCancelled){mediaStream.getTracks().forEach(track=>track.stop());return;}liveMediaStream=mediaStream;const AudioContextClass=window.AudioContext||window.webkitAudioContext;liveAudioContext=new AudioContextClass({latencyHint:'interactive'});await liveAudioContext.resume();liveSource=liveAudioContext.createMediaStreamSource(liveMediaStream);liveSamples=new Float32Array(0);liveSampleCount=0;settledUiEpoch++;latencyStats.start(activeReciteMode);try{diagStart()}catch{}if(!continuing){clearProvisionalSpeech();setAwaitingMatch(activeReciteMode!=='review');liveCurrentVerse=null;pendingWordProgress=[];pendingRecitationMisses.clear();recitationLastConfirmedIndex=-1;recitationWordStates.clear();recitationWordExpiry.clear();recitationTrackingKey='';recitationTokenMaps.clear();heardTranscript='';heardBackfillDone=false;heardBackfillTarget=null}currentRecitationSession={startedAt:Date.now(),mode:activeReciteMode,range:activeReciteMode==='review'?{surah:activeReciteSurah,...reciteRange}:null,words:[]};document.getElementById('reciteCorrectionPanel').hidden=true;asrWorker.postMessage({type:'reset'});asrWorker.postMessage({type:'set_mode',mode:activeReciteMode==='review'?'correction':'tracking'});if(activeReciteMode==='review')asrWorker.postMessage({type:'set_expected',passage:{surah:activeReciteSurah,ayah:reciteRange.from,ayahEnd:reciteRange.to}});else asrWorker.postMessage({type:'set_expected',passage:null});liveProcessor=await startCapture(liveAudioContext,liveSource,(chunk,at)=>{if(!liveAudioContext)return;latencyStats.chunk();try{diagChunk(at)}catch{}sendAudioChunk(chunk,at,true)},level=>{micLevel=level;diag.bucket(Date.now(),'lvl',level);if(!micLevelFrame)micLevelFrame=requestAnimationFrame(()=>{micLevelFrame=0;document.documentElement.style.setProperty('--mic-level',String(Math.min(1,micLevel*9)))})});document.body.classList.remove('recitation-session-paused');document.getElementById('recitationStartLabel').textContent='ابدأ من أي مكان';document.getElementById('startRec').disabled=true;document.getElementById('startFollow').disabled=true;document.getElementById('startReview').disabled=true;document.getElementById('stopRec').disabled=false;document.getElementById('reciteLiveIndicator').textContent='يستمع الآن';asrStatus('التسميع يعمل محليًا على جهازك.');}catch(error){recitationStarting=false;asrStatus('تعذر فتح الميكروفون: '+(error.message||'تحقق من إذن الميكروفون.'));await stopLiveRecording();}}
async function stopLiveRecording(){if(recitationStopping)return;recitationStopping=Boolean(asrWorker&&asrReady);recitationSessionCancelled=true;clearInterval(diagHb);diagHb=0;if(liveProcessor){try{liveProcessor.stop()}catch{}}if(liveSource){try{liveSource.disconnect()}catch{}}if(liveSampleCount)sendAudioChunk(liveSamples.subarray(0,liveSampleCount));liveSamples=new Float32Array(0);liveSampleCount=0;liveMediaStream?.getTracks().forEach(track=>track.stop());if(liveAudioContext){try{await liveAudioContext.close()}catch{}}liveProcessor=liveSource=liveMediaStream=liveAudioContext=null;document.body.classList.add('recitation-session-paused');document.getElementById('startRec').disabled=true;document.getElementById('startFollow').disabled=recitationStopping||!asrReady;document.getElementById('startReview').disabled=recitationStopping||!asrReady;document.getElementById('stopRec').disabled=true;document.getElementById('recitationStartLabel').textContent='استأنف التسميع';document.getElementById('reciteLiveIndicator').textContent='متوقف';document.getElementById('asrResult').textContent='التسميع متوقف. المصحف ونتيجة قراءتك ما زالا ظاهرين.'+(rescoreUnavailable?' تعذّر تمييز الكلمات الخاطئة بالأحمر في هذه الجلسة.':'');document.getElementById('reciteLiveIndicator').textContent='جارٍ حفظ النتيجة…';if(asrWorker&&asrReady)asrWorker.postMessage({type:'stop'});else{const {session:finishedSession}=finalizeRecitationSession();if(finishedSession&&finishedSession.words.length)openSessionSummary(finishedSession);document.getElementById('startRec').disabled=!asrReady;}asrStatus('أُوقف الميكروفون؛ يمكنك مراجعة الصفحة أو استئناف التسميع.');}
function focusRecitedVerse(surah,ayah){revealRecitedAyah(surah,ayah);return true;}
function setAwaitingMatch(on){document.querySelector('.recitation-mushaf-paper')?.classList.toggle('awaiting-match',Boolean(on));const wait=document.getElementById('recitationWaiting');if(on&&wait){wait.hidden=false;wait.classList.remove('hearing');const s=wait.querySelector('strong');if(s)s.textContent='ابدأ القراءة من أي موضع'}}
function showProvisionalSpeech(text){if(activeReciteMode==='review')return;const box=document.getElementById('provisionalSpeech'),out=document.getElementById('provisionalSpeechText');if(!box||!out)return;const clean=String(text||'').replace(/[\u06E6\u0640]{2,}/g,'\u06E6').trim();if(!clean)return;out.textContent=clean.length>70?'…'+clean.slice(-70):clean;box.hidden=false}
function clearProvisionalSpeech(){const box=document.getElementById('provisionalSpeech'),out=document.getElementById('provisionalSpeechText');if(out)out.textContent='';if(box)box.hidden=true;clearMatchCandidates()}
function clearMatchCandidates(){const cands=document.getElementById('matchCandidates');if(cands){cands.textContent='';cands.hidden=true}}
async function ensureReciteCatalog(){if(reciteCatalog.length)return;try{const result=await getQuranJson(`${quranApi}/surah`);reciteCatalog=result.data||reciteCatalog}catch{}}
function showMatchCandidates(candidates,stable){if(activeReciteMode==='review')return;ensureReciteCatalog();const box=document.getElementById('provisionalSpeech'),cands=document.getElementById('matchCandidates');if(!box||!cands)return;const top=(Array.isArray(candidates)?candidates:[]).slice(0,3);if(!top.length)return;const label=top.map(c=>{const entry=reciteCatalog.find(s=>s.number===Number(c.surah)),name=entry?entry.name.replace(/^سُورَةُ\s*/,'').replace(/[ً-ٰٟۖ-ۭ]/g,''):('سورة '+toArabic(c.surah));return name+' '+toArabic(c.surah)+':'+toArabic(c.ayah)}).join(' · ');cands.textContent='ربما: '+label;cands.hidden=false;box.hidden=false;if(stable){const strong=document.querySelector('#recitationWaiting strong');if(strong)strong.textContent='قربنا نحدد مكانك…'}}
let settledUiEpoch=0,settledUiTasks=new Set();
async function applySettledWords(message){
 const epoch=settledUiEpoch,surah=Number(message.surah),ayah=Number(message.ayah);
 if(activeReciteMode==='review'&&(surah!==activeReciteSurah||ayah<reciteRange.from||ayah>reciteRange.to))return;
 if(!reciteVerseCache.has(surah))await ensureRecitationSurah(surah);if(epoch!==settledUiEpoch)return;
 const verse=reciteVerseCache.get(surah)?.find(v=>v.numberInSurah===ayah),map=engineTokenMap(String(verse?.text||'').split(/\s+/).filter(Boolean));
 for(const w of message.matched_indices||[]){const index=map[Number(w)];if(!Number.isInteger(index))continue;const key=`${surah}:${ayah}:${index}`;if(recitationWordStates.has(key))continue;saveRecitationWord(surah,ayah,index,'correct','revealed',0,false)}drawRecitationQvpPage();
}
function handleRecitationEvent(message){
 if(message.type==='settled_words'){const p=applySettledWords(message).catch(()=>{});settledUiTasks.add(p);p.finally(()=>settledUiTasks.delete(p));return;}
 if(message.type==='raw_transcript'){const waiting=document.getElementById('recitationWaiting');if(!liveCurrentVerse&&waiting&&!waiting.hidden){waiting.classList.add('hearing');waiting.querySelector('strong').textContent='سمعتك، بحدد المكان…';}if(!liveCurrentVerse){heardTranscript=String(message.text||'').slice(-400);showProvisionalSpeech(message.text)}else if(heardBackfillTarget&&!heardBackfillDone){heardTranscript=String(message.text||'').slice(-400);backfillHeardWords()}return}
 if(message.type==='verse_candidate'){if(!liveCurrentVerse)showMatchCandidates(message.candidates,message.stable);return}
 if(message.type==='verse_match')latencyStats.lock();if(message.type==='word_progress')latencyStats.word();document.getElementById('recitationWaiting')?.classList.remove('hearing');if(message.type==='verse_match'||message.type==='word_progress')clearProvisionalSpeech();
 if(activeReciteMode==='review'&&['verse_match','word_progress'].includes(message.type)&&(Number(message.surah)!==activeReciteSurah||Number(message.ayah)<reciteRange.from||Number(message.ayah)>reciteRange.to)){document.getElementById('asrResult').textContent='لم يتابع المحرك النطاق المحدد بوضوح. جرّب القراءة مرة أخرى أو اطلب تلميحًا.';return}
 const panel=document.getElementById('reciteCorrectionPanel');
 if(message.type==='verse_match'){
  settleActiveRecitationWord();liveCurrentVerse={surah:message.surah,ayah:message.ayah};recitationLastConfirmedIndex=-1;recitationTrackingKey='';pendingRecitationMisses.clear();document.getElementById('recitationSurahMeta').textContent='جارٍ تجهيز الصفحة…';document.getElementById('recitationPageNumber').textContent='';const split=splitPending(pendingWordProgress,message.surah,message.ayah,Date.now());const early=split.early;pendingWordProgress=split.rest;diag.mark('replay',{n:early.length,rest:pendingWordProgress.length,a:Number(message.ayah)});const title=(message.surah_name||`سورة ${toArabic(message.surah)}`)+' · الآية '+toArabic(message.ayah);document.getElementById('asrResult').textContent='موضع التلاوة: '+title+' · التعرّف تقريبي'+(rescoreUnavailable?' · تعذّر تمييز الأحمر هذه الجلسة':'');document.getElementById('reciteLiveIndicator').textContent='يستمع الآن';document.getElementById('recitationWaiting').hidden=true;setAwaitingMatch(false);revealRecitedAyah(message.surah,message.ayah);for(const item of early)applyRecognizedWords(item.message);if(!heardBackfillDone&&!heardBackfillTarget){heardBackfillTarget={surah:Number(message.surah),ayah:Number(message.ayah),at:Date.now()};backfillHeardWords()}localStorage.setItem('rattil-last-recitation',JSON.stringify({surah:message.surah,ayah:message.ayah,at:Date.now()}));
 }else if(message.type==='word_progress'){
  if(liveCurrentVerse&&message.surah===liveCurrentVerse.surah&&message.ayah===liveCurrentVerse.ayah){applyRecognizedWords(message);applyTentativeCursor(message)}else{pendingWordProgress.push({message,at:Date.now()});if(pendingWordProgress.length>30)pendingWordProgress.shift()}
 }else if(message.type==='correction'){
  const state=message.state||{},issue=state.issue;if(!issue){if(state.phase==='idle'||state.outcome)panel.hidden=true;return}
  if(activeReciteMode==='follow'&&!reciteVerseCache.has(Number(issue.surah)))ensureRecitationSurah(issue.surah).then(()=>focusRecitedVerse(issue.surah,issue.ayah));
  const verse=reciteVerseCache.get(Number(issue.surah))?.find(item=>item.numberInSurah===Number(issue.ayah)),wordCount=String(verse?.text||'').split(/\s+/).filter(Boolean).length,start=Math.max(0,Number(issue.word)||0),count=Number(issue.words)||1,uncertain=['possible_vowel','possible_repetition','unclear_ayah'].includes(issue.kind),indices=['possible_skipped_ayah','unclear_ayah'].includes(issue.kind)?Array.from({length:wordCount},(_,i)=>i):Array.from({length:count},(_,i)=>start+i);
  const issueStatus=['possible_substitution','possible_omission'].includes(issue.kind)?'error':'uncertain';indices.forEach(index=>{if(state.phase==='corrected')saveRecitationWord(issue.surah,issue.ayah,index,'correct','correct',850);else saveRecitationWord(issue.surah,issue.ayah,index,issueStatus,issueStatus,0,true,'correction')});
  const labels={possible_omission:'كلمة لم يتابعها المحرك بوضوح',possible_substitution:'احتمال اختلاف في الكلمة',possible_vowel:'اختلاف محتمل في الحركة',possible_repetition:'احتمال تكرار كلمة',possible_skipped_ayah:'احتمال تخطي آية',unclear_ayah:'لم يستطع المحرك متابعة الآية'};document.getElementById('reciteCorrectionTitle').textContent=labels[issue.kind]||'موضع يحتاج مراجعة';document.getElementById('reciteCorrectionText').textContent='رُصد احتمال في الآية '+toArabic(issue.ayah)+'. المحرك قد يخطئ، ولا يقيّم أحكام التجويد.';panel.hidden=!['error','retrying'].includes(state.phase);panel.querySelectorAll('[data-correction-action]').forEach(button=>button.hidden=state.phase==='retrying'?button.dataset.correctionAction!=='stop_retry':button.dataset.correctionAction==='stop_retry');if(state.phase==='retrying')document.getElementById('reciteCorrectionText').textContent='أعد قراءة المقطع المحدد؛ يراجعه المحرك الآن.';if(state.phase==='corrected'){document.getElementById('reciteCorrectionText').textContent='انتهت مراجعة هذا الموضع.';panel.hidden=true;}
 }else if(message.type==='word_issues'){
  const surah=Number(message.surah),ayah=Number(message.ayah),verse=reciteVerseCache.get(surah)?.find(item=>item.numberInSurah===ayah),tokens=String(verse?.text||'').split(/\s+/).filter(Boolean),engineMap=engineTokenMap(tokens);
  for(const w of message.words||[]){const index=engineMap[Number(w)];if(Number.isInteger(index)&&index>=0&&(!tokens.length||index<tokens.length))saveRecitationWord(surah,ayah,index,'error','error',0,true,'rescore')}
  for(const w of message.cleared||[]){const index=engineMap[Number(w)],key=`${surah}:${ayah}:${index}`;if(recitationWordStates.get(key)==='error')saveRecitationWord(surah,ayah,index,'uncertain','uncertain')}
 }else if(message.type==='word_verdicts'){
  const surah=Number(message.surah),ayah=Number(message.ayah),verse=reciteVerseCache.get(surah)?.find(item=>item.numberInSurah===ayah),engineMap=engineTokenMap(String(verse?.text||'').split(/\s+/).filter(Boolean));
  if(currentRecitationSession){if(!currentRecitationSession.verdicts)currentRecitationSession.verdicts={};for(const wv of message.words||[]){const index=engineMap[Number(wv.w)];if(!Number.isInteger(index))continue;currentRecitationSession.verdicts[`${surah}:${ayah}:${index}`]={state:wv.state,gop:wv.gop,gopNone:wv.gopNone,repGain:wv.repGain,vowelErrors:wv.vowelErrors};}}
 }else if(message.type==='rescore_unavailable'){
  rescoreUnavailable=true;if(currentRecitationSession)currentRecitationSession.rescoreUnavailable=true;document.getElementById('asrResult').textContent='تعذّر تمييز الكلمات الخاطئة بالأحمر في هذه الجلسة؛ التسميع والمتابعة مستمران بدونه.';
 }else if(message.type==='correction_note'){
  const issue=message.issue;if(issue){saveRecitationWord(issue.surah,issue.ayah,Math.max(0,Number(issue.word)||0),'uncertain','uncertain');document.getElementById('asrResult').textContent='رصد المحرك احتمال تكرار كلمة في الآية '+toArabic(issue.ayah)+'؛ راجع الموضع.';}
 }
}

const toArabic=value=>new Intl.NumberFormat('ar-EG',{useGrouping:false}).format(value);
updatePracticeSummary();
async function savedAsrModelExists(){
 if(!('indexedDB'in window))return false;
 return new Promise(resolve=>{const request=indexedDB.open('rattil-zipformer-assets',1);
 request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('assets'))request.result.createObjectStore('assets')};
 request.onerror=()=>resolve(false);request.onblocked=()=>resolve(false);
 request.onsuccess=()=>{const db=request.result,tx=db.transaction('assets','readonly'),store=tx.objectStore('assets');let found=false;
 for(const key of ['zipformer-a0w-ep1-a05-int8','zipformer-a0w-ep1-a05-int8:part-v1:0']){const item=store.getKey(key);item.onsuccess=()=>{if(item.result!==undefined)found=true}};
 tx.oncomplete=()=>{db.close();resolve(found)};tx.onerror=()=>{db.close();resolve(false)};};});
}
(async()=>{if(await savedAsrModelExists()){document.getElementById('engineSetupPanel').hidden=false;document.getElementById('practiceWeekSummary').textContent='جارٍ فحص الأجزاء المحفوظة…';loadAsr();}})();
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
  svg.querySelectorAll('script,foreignObject,iframe,style').forEach(node=>node.remove());for(const node of [svg,...svg.querySelectorAll('*')])for(const attr of [...node.attributes])if(attr.name.startsWith('on')||((attr.localName==='href')&&!attr.value.startsWith('#')))node.removeAttribute(attr.name);
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
function pageForReference(surah,ayah){return referencePage(indexData.meta?.pages?.references||[],surah,ayah)}
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
  const list=document.getElementById('surahList'),query=normalizeRecitationWord(document.getElementById('surahSearch').value.trim()).toLocaleLowerCase('ar');list.replaceChildren();
  const matches=indexData.surahs.filter(s=>normalizeRecitationWord(s.name).toLocaleLowerCase('ar').includes(query)||String(s.number).includes(query));
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
function prayerTimesFor(date){const coordinates=new window.adhan.Coordinates(userLocation.lat,userLocation.lon);const params=window.adhan.CalculationMethod.Egyptian();params.madhab=window.adhan.Madhab.Shafi;return new window.adhan.PrayerTimes(coordinates,date,params)}
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
  }catch(error){console.error('Prayer times calculation failed:',error);document.getElementById('prayerCountdownDashboard').textContent='—';document.getElementById('prayerTimesList').textContent='تعذّر حساب المواقيت على هذا الجهاز.'}
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
if(import.meta.env.PROD&&'serviceWorker'in navigator&&window.location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).catch(()=>{});


// Prototype additions: one-word hints, local results, and honest progress.
function renderProgress(){
 const sessions=savedRecitationHistory(),weekAgo=Date.now()-7*86400000,recent=sessions.filter(s=>s.startedAt>=weekAgo),days=new Set(recent.map(s=>new Date(s.startedAt).toLocaleDateString('en-CA'))),stats=sessions.map(sessionStats);
 document.getElementById('progressDays').textContent=`${toArabic(days.size)} أيام تسميع`;
 document.getElementById('progressSessions').textContent=toArabic(sessions.length);
 document.getElementById('progressReview').textContent=toArabic(stats.reduce((n,s)=>n+s.review,0));
 document.getElementById('progressLastPage').textContent=`آخر صفحة فتحتها: ${toArabic(page)}`;
 const dots=document.getElementById('progressDots');dots.replaceChildren();for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const dot=document.createElement('i'),active=days.has(d.toLocaleDateString('en-CA'));dot.classList.toggle('filled',active);dot.title=d.toLocaleDateString('ar-EG');dots.append(dot)}
}
async function revealHint(){
 if(!currentRecitationSession||!recitationQvpGeometry){announce('ابدأ جلسة التسميع أولًا لطلب تلميح.');return}
 const seen=new Map();for(const [key,state]of recitationWordStates){const [surah,ayah,index]=key.split(':').map(Number),printed=getRecitationTokenMap(surah,ayah).get(index);if(printed!=null)seen.set(`${surah}:${ayah}:${printed}`,state)}
 const word=nextHint(recitationQvpGeometry.words,seen,{surah:activeReciteMode==='review'?activeReciteSurah:0,...reciteRange,after:liveCurrentVerse});
 if(!word){announce('لا توجد كلمة مخفية في النطاق على الصفحة الحالية.');return}
 try{await ensureRecitationSurah(word.surah);const entry=[...getRecitationTokenMap(word.surah,word.ayah)].find(([,printed])=>printed===word.word);if(!entry){announce('تعذر مطابقة هذه الكلمة بأمان. استخدم معاينة الصفحة.');return}saveRecitationWord(word.surah,word.ayah,entry[0],'hint','hint');document.getElementById('recitationWaiting').hidden=true;setAwaitingMatch(false);document.getElementById('asrResult').textContent=`تلميح في الآية ${toArabic(word.ayah)} · محفوظ للمراجعة`;}
 catch{announce('تعذر تحميل التلميح. تحقق من الاتصال.');}
}
document.getElementById('hintWord').addEventListener('click',revealHint);
document.getElementById('practiceFromPage').addEventListener('click',async()=>{showView('practice');await loadRecitationCatalog();try{const result=await getQuranJson(`${quranApi}/page/${page}/quran-uthmani`),first=result.data.ayahs[0],same=result.data.ayahs.filter(a=>a.surah.number===first.surah.number);document.getElementById('reviewSurah').value=String(first.surah.number);await ensureRecitationSurah(first.surah.number);const from=document.getElementById('reviewFrom'),to=document.getElementById('reviewTo');from.max=to.max=String(reciteCatalog.find(s=>s.number===first.surah.number)?.numberOfAyahs||286);from.value=first.numberInSurah;to.value=same.at(-1).numberInSurah;document.getElementById('recitationSetupDialog').showModal();if(!asrReady)document.getElementById('reviewSetupStatus').textContent='حمّل المحرك أولًا من شاشة التسميع، ثم ابدأ.';}catch{announce('تعذر تحميل نطاق الصفحة. اختر السورة من التسميع.')}});
document.getElementById('clearSessionHistory').addEventListener('click',()=>document.getElementById('clearHistoryDialog').showModal());
document.getElementById('confirmClearHistory').addEventListener('click',()=>{writeStore('rattil-recitation-history','[]');renderRecitationHistory();renderProgress();updatePracticeSummary();renderMistakesLog();document.getElementById('clearHistoryDialog').close();announce('تم حذف سجل التسميع من هذا الجهاز.');});
renderRecitationHistory();renderProgress();renderMistakesLog();

window.addEventListener('pagehide',()=>{if(liveAudioContext)stopLiveRecording();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&liveAudioContext)stopLiveRecording();});

installAppUpdate({button:document.getElementById('refreshApp'),status:document.getElementById('refreshAppStatus'),setApplying:value=>appUpdating=value,announce,isBusy:()=>Boolean(recitationStarting||liveMediaStream||liveAudioContext||recitationStopping||currentRecitationSession||settledUiTasks.size)});
