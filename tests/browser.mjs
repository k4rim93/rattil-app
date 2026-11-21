import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
const root=new URL('../dist/',import.meta.url).pathname;
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.json':'application/json','.wasm':'application/wasm','.onnx':'application/octet-stream'};
const server=createServer(async(req,res)=>{try{const path=decodeURIComponent(req.url.split('?')[0]);if(!path.startsWith('/rattil-app/')){res.writeHead(404).end();return}const name=path.slice('/rattil-app/'.length)||'index.html';if(name.includes('..')){res.writeHead(400).end();return}res.setHeader('Content-Type',types[extname(name)]||'application/octet-stream');res.end(await readFile(join(root,name)));}catch{res.writeHead(404).end()}}).listen(4173,'127.0.0.1');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
try{
 const context=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:2,permissions:['microphone']});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Synthetic worker messages test UI state only, not model accuracy.
 if(!process.env.REAL_ASR)await page.addInitScript(()=>{window.Worker=class{constructor(){window.__engine=this}postMessage(m){if(m.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),50);if(m.type==='stop')setTimeout(()=>this.onmessage?.({data:{type:'stopped'}}),50)}emit(event){this.onmessage?.({data:{type:'event',event}})}terminate(){}}});
 await page.goto('http://127.0.0.1:4173/rattil-app/');
 await page.locator('.tabbar [data-view=quran]').click();
 await page.waitForSelector('.mushaf-svg',{timeout:45000});
 await page.screenshot({path:'/downloads/rattil-mushaf.png',fullPage:true});
 assert.equal(await page.locator('#appManifest').getAttribute('href'),'http://127.0.0.1:4173/rattil-app/manifest.webmanifest');
 await page.locator('#pagePickerButton').click();await page.locator('#pageInput').fill('1');await page.locator('#goToPageButton').click();await page.waitForFunction(()=>document.querySelector('.mushaf-svg')?.getAttribute('aria-label')?.endsWith('١'));
 await page.screenshot({path:'/downloads/rattil-fatiha.png',fullPage:true});
 await page.locator('.tabbar [data-view=practice]').click();await page.locator('#loadAsr').click();
 await page.waitForFunction(()=>document.querySelector('#loadAsr').textContent==='المحرك جاهز',{timeout:process.env.REAL_ASR?180000:10000});
 if(process.env.REAL_ASR){console.log('REAL MODEL INITIALIZED at non-root path');await page.screenshot({path:'/downloads/rattil-model-ready.png',fullPage:true});}
 else{
 await page.locator('#reviewFeatureStart').click();await page.waitForFunction(()=>document.querySelector('#reviewSurah').options.length===114);await page.locator('#reviewSurah').selectOption('1');await page.waitForTimeout(600);await page.locator('#reviewTo').fill('7');await page.locator('#startReview').click();await page.waitForSelector('.recitation-qvp-canvas');
 await page.waitForFunction(()=>!document.querySelector('#stopRec').disabled);
 await page.locator('#hintWord').click();await page.waitForFunction(()=>document.querySelector('#asrResult').textContent.includes('تلميح في'));
 await page.screenshot({path:'/downloads/rattil-hint.png',fullPage:true});
 await page.evaluate(()=>{window.__engine.emit({type:'verse_match',surah:1,ayah:1});window.__engine.emit({type:'word_progress',surah:1,ayah:1,matched_indices:[0,1],word_index:2});window.__engine.emit({type:'correction',state:{phase:'error',issue:{surah:1,ayah:1,word:2,words:1,kind:'possible_omission'}}})});
 await page.screenshot({path:'/downloads/rattil-recite.png',fullPage:true});
 await page.locator('#stopRec').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rattil-recitation-history')||'[]').length===1);
 await page.locator('#exitRecitation').click();await page.locator('.recitation-history-entry').click();await page.screenshot({path:'/downloads/rattil-results.png',fullPage:true});
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rattil-recitation-history')));assert.equal(saved.length,1);assert.equal(saved[0].words[0].hinted,true);assert.equal(saved[0].words.find(w=>w.index===2).status,'uncertain');
 await page.reload();await page.locator('.tabbar [data-view=progress]').click();assert.equal(await page.locator('#progressSessions').textContent(),'١');await page.screenshot({path:'/downloads/rattil-progress.png',fullPage:true});
 // Regression: last two surahs are on page 604, not page 1.
 await page.locator('.tabbar [data-view=quran]').click();await page.locator('#indexButton').click();await page.waitForSelector('.surah-option');
 for(const name of ['الفلق','الناس']){await page.locator('#surahSearch').fill(name);const row=page.locator('#surahList .surah-option');await row.waitFor();assert.match(await row.textContent(),/٦٠٤/)}
 await page.locator('#closeMushafIndex').click();await page.locator('.tabbar [data-view=practice]').click();await page.locator('#clearSessionHistory').click();await page.locator('#clearHistoryDialog [value=cancel]').click();assert.equal(await page.locator('.recitation-history-entry').count(),1);await page.locator('#clearSessionHistory').click();await page.locator('#confirmClearHistory').click();assert.equal(await page.locator('.recitation-history-entry').count(),0);
 }
 await page.evaluate(async()=>{await navigator.serviceWorker.ready});await page.reload();await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));await context.setOffline(true);await page.reload();await page.locator('.tabbar [data-view=quran]').click();await page.waitForSelector('.mushaf-svg');await context.setOffline(false);console.log('PASS: built shell and previously opened mushaf work offline.');
 assert.deepEqual(errors,[]);
 console.log(process.env.REAL_ASR?'PASS: real model boot and correct non-root asset loading (not an accuracy benchmark).':'PASS: visual captures, subpath manifest, selected recitation, hints, uncertain review, persistence, progress, final-surah page lookup, delete/cancel.');
 await context.close();
}finally{await browser.close();server.close();}
