// Screen lock / background: the session must pause, not end.
// Run after `npm run build`: node tests/screen-lock.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain' };
const server = createServer(async (req, res) => { try { const path = decodeURIComponent(req.url.split('?')[0]); const name = path === '/' ? 'index.html' : path.slice(1); if (name.includes('..')) { res.writeHead(400).end(); return; } res.setHeader('Content-Type', types[extname(name)] || 'application/octet-stream'); res.end(await readFile(join(root, name))); } catch { res.writeHead(404).end(); } }).listen(4181, '127.0.0.1');


const MOCK_WORKER = `
let seen=false,n=0;
self.onmessage=(e)=>{const m=e.data||{};
 if(m.type==='init'){self.postMessage({type:'ready'});return}
 if(m.type==='audio'){n++;if(!seen){seen=true;self.postMessage({type:'event',event:{type:'verse_match',surah:1,ayah:4,surah_name:'الفاتحة'}});setTimeout(()=>self.postMessage({type:'event',event:{type:'word_progress',surah:1,ayah:4,word_index:2,matched_indices:[0,1,2]}}),300)}return}
 if(m.type==='stop'){self.postMessage({type:'final_check_started',planned:1});self.postMessage({type:'stopped'});setTimeout(()=>{self.postMessage({type:'event',event:{type:'word_verdicts',surah:1,ayah:4,words:[{w:0,state:'ok',gop:.9,gopNone:.1,repGain:0,vowelErrors:0},{w:1,state:'ok',gop:.8,gopNone:.2,repGain:0,vowelErrors:0}]}});self.postMessage({type:'event',event:{type:'rescore_done',reason:'final',planned:1,coveredAyahs:1,budgetSkipped:0,round:1}});self.postMessage({type:'final_check_done'})},800);return}
 if(m.type==='check_more'){self.postMessage({type:'final_check_started',planned:0});setTimeout(()=>self.postMessage({type:'final_check_done'}),600);return}
};`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block', permissions: ['microphone'] });
const page = await ctx.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.route('**/asr-worker-*.js', r => r.fulfill({ contentType: 'text/javascript', body: MOCK_WORKER }));
await page.goto('http://127.0.0.1:4181/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
const results=[]; const check=(n,ok,d='')=>{results.push(ok);console.log((ok?'PASS ':'FAIL ')+n+(d?' - '+d:''))};
await page.click('.tabbar [data-view=practice]'); await page.click('#loadAsr');
await page.waitForFunction(()=>!document.getElementById('startFollow').disabled,{timeout:15000});
await page.click('#followFeatureStart'); await page.waitForFunction(()=>!document.getElementById('stopRec').disabled,{timeout:15000}); await page.waitForTimeout(3000);
const pg=()=>page.evaluate(()=>document.getElementById('recitationPageNumber').textContent);
check('no page buttons in the UI', await page.evaluate(()=>!document.getElementById('recitationPageNav')));
await page.click('#stopRec');
await page.waitForFunction(()=>document.getElementById('sessionSummaryDialog')?.open,{timeout:15000});
// continue-check: button, then honest note when nothing changes
await page.waitForFunction(()=>!document.querySelector('#sessionSummaryContent .session-bg-note'),{timeout:15000});
const btn=()=>page.evaluate(()=>[...document.querySelectorAll('#sessionSummaryContent button')].some(x=>x.textContent.includes('أكمل فحص')));
check('continue-check button offered', await btn());
await page.evaluate(()=>[...document.querySelectorAll('#sessionSummaryContent button')].find(x=>x.textContent.includes('أكمل فحص')).click());
await page.waitForFunction(()=>!document.querySelector('#sessionSummaryContent .session-bg-note'),{timeout:15000}); await page.waitForTimeout(500);
const note=await page.evaluate(()=>[...document.querySelectorAll('#sessionSummaryContent .session-summary-note')].map(x=>x.textContent).join('|'));
check('no-progress check explains itself and hides the button', !(await btn()) && note.includes('مفيش جديد'), note.slice(0,80));
await page.screenshot({path:'/tmp/pn-stuck.png'});
await page.evaluate(()=>document.getElementById('sessionSummaryDialog').close());
await page.waitForTimeout(400);
const p0=await pg();

await page.evaluate(()=>{const el=document.querySelector('.recitation-mushaf-paper');const mk=(t,x)=>new Touch({identifier:1,target:el,clientX:x,clientY:300});el.dispatchEvent(new TouchEvent('touchstart',{changedTouches:[mk(0,100)],bubbles:true}));el.dispatchEvent(new TouchEvent('touchend',{changedTouches:[mk(0,260)],bubbles:true}))});
await page.waitForTimeout(1500);
const p2=await pg(); check('swipe right goes to next page', p2!==p0, p0+' -> '+p2);
await page.evaluate(()=>{const el=document.querySelector('.recitation-mushaf-paper');const mk=x=>new Touch({identifier:1,target:el,clientX:x,clientY:300});el.dispatchEvent(new TouchEvent('touchstart',{changedTouches:[mk(260)],bubbles:true}));el.dispatchEvent(new TouchEvent('touchend',{changedTouches:[mk(100)],bubbles:true}))});
await page.waitForTimeout(1500);check('swipe left goes back', (await pg())===p0);
await page.evaluate(()=>{const el=document.querySelector('.recitation-mushaf-paper');const mk=(x,y)=>new Touch({identifier:1,target:el,clientX:x,clientY:y});el.dispatchEvent(new TouchEvent('touchstart',{changedTouches:[mk(100,100)],bubbles:true}));el.dispatchEvent(new TouchEvent('touchend',{changedTouches:[mk(160,400)],bubbles:true}))});
await page.waitForTimeout(800);check('mostly vertical drag does not turn the page', (await pg())===p0);
await page.screenshot({path:'/tmp/pn-nav.png'});
check('no page errors', errors.length===0, errors.join('|'));
await browser.close(); server.close();
console.log(results.filter(Boolean).length+'/'+results.length); if(results.includes(false)) process.exitCode=1;
