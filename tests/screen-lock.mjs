// Screen lock / background: the session must pause, not end.
// Run after `npm run build`: node tests/screen-lock.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain' };
const server = createServer(async (req, res) => { try { const path = decodeURIComponent(req.url.split('?')[0]); const name = path === '/' ? 'index.html' : path.slice(1); if (name.includes('..')) { res.writeHead(400).end(); return; } res.setHeader('Content-Type', types[extname(name)] || 'application/octet-stream'); res.end(await readFile(join(root, name))); } catch { res.writeHead(404).end(); } }).listen(4180, '127.0.0.1');

const MOCK_WORKER = `
let n=0,seen=false;
self.onmessage=(e)=>{const m=e.data||{};
 if(m.type==='init'){self.postMessage({type:'ready'});return}
 if(m.type==='audio'){n++;
  if(!seen){seen=true;self.postMessage({type:'event',event:{type:'verse_match',surah:1,ayah:4,surah_name:'الفاتحة'}});}
  if(n%5===0){const k=Math.min(6,Math.floor(n/5));self.postMessage({type:'event',event:{type:'word_progress',surah:1,ayah:4,word_index:k,matched_indices:Array.from({length:k},(_,i)=>i)}});}
  return}
 if(m.type==='stop'){self.postMessage({type:'final_check_started',planned:0});self.postMessage({type:'stopped'});setTimeout(()=>self.postMessage({type:'final_check_done'}),300);return}
 if(m.type==='check_more'){self.postMessage({type:'final_check_started',planned:0});setTimeout(()=>self.postMessage({type:'final_check_done'}),200);return}
};`;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block', permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const W = window.Worker;
    window.__posts = [];
    window.Worker = class extends W { postMessage(m, o) { window.__posts.push((m && m.type) || '?'); return super.postMessage(m, o); } };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async c => { const stream = await gum(c); window.__stream = stream; return stream; };
  });
  await page.route('**/asr-worker-*.js', route => route.fulfill({ contentType: 'text/javascript', body: MOCK_WORKER }));
  await page.goto('http://127.0.0.1:4180/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return { page, errors };
}
const setHidden = (page, hidden) => page.evaluate(h => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
  if (!h) window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
}, hidden);
const count = (page, type) => page.evaluate(t => window.__posts.filter(x => x === t).length, type);
const summaryOpen = page => page.evaluate(() => !!document.getElementById('sessionSummaryDialog')?.open);

async function startSession(page) {
  await page.click('.tabbar [data-view=practice]');
  await page.click('#loadAsr');
  await page.waitForFunction(() => !document.getElementById('startFollow').disabled, { timeout: 15000 });
  await page.click('#followFeatureStart');
  await page.waitForFunction(() => !document.getElementById('stopRec').disabled, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.recitation-mushaf-paper .word-state, .recitation-qvp-canvas').length > 0 || true, { timeout: 5000 });
  await page.waitForTimeout(3000);
}

const results = [];
function check(name, ok, detail = '') { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); }

// --- A: lock -> paused (no summary) -> resume -> continue -> stop -> summary
{
  const { page, errors } = await newPage();
  await startSession(page);
  const audioBefore = await count(page, 'audio');
  const savedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('rattil-recitation-history') || '[]').length);

  await setHidden(page, true);
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({
    paused: document.body.classList.contains('recitation-session-paused'),
    label: document.getElementById('recitationStartLabel').textContent,
    indicator: document.getElementById('reciteLiveIndicator').textContent,
    startDisabled: document.getElementById('startRec').disabled,
    stopDisabled: document.getElementById('stopRec').disabled,
    followDisabled: document.getElementById('startFollow').disabled,
    note: document.getElementById('asrResult').textContent,
  }));
  check('hide does not open the summary', !(await summaryOpen(page)));
  check('hide pauses the session', st.paused, JSON.stringify(st));
  check('resume button is offered and enabled', st.startDisabled === false && st.label.includes('استئناف'), st.label);
  check('finish button stays available', st.stopDisabled === false);
  check('no new session can start while paused', st.followDisabled === true);
  check('note explains the pause', st.note.includes('استئناف'), st.note.slice(0, 60));
  check('worker was not told to stop', (await count(page, 'stop')) === 0);

  const audioAtPause = await count(page, 'audio');
  await page.waitForTimeout(2000);
  check('mic is released while paused (no audio posts)', (await count(page, 'audio')) <= audioAtPause + 1, `${audioBefore} -> ${audioAtPause} -> ${await count(page, 'audio')}`);
  check('session is not saved while paused', (await page.evaluate(() => JSON.parse(localStorage.getItem('rattil-recitation-history') || '[]').length)) === savedBefore);
  await page.screenshot({ path: '/tmp/sl-paused.png' });

  await setHidden(page, false);
  await page.waitForTimeout(400);
  const stillPaused = await page.evaluate(() => document.body.classList.contains('recitation-session-paused') && !document.getElementById('startRec').disabled);
  check('returning to the app keeps the pause and the resume button', stillPaused);

  const postsAtResume = await page.evaluate(() => window.__posts.length);
  await page.click('#startRec');
  await page.waitForFunction(() => document.getElementById('reciteLiveIndicator').textContent.includes('يستمع'), { timeout: 15000 });
  await page.waitForTimeout(2500);
  const after = await page.evaluate(from => ({
    audio: window.__posts.filter(x => x === 'audio').length,
    posts: window.__posts.slice(from),
    paused: document.body.classList.contains('recitation-session-paused'),
    indicator: document.getElementById('reciteLiveIndicator').textContent,
  }), postsAtResume);
  check('resume re-acquires the mic (audio flows again)', after.audio > audioAtPause + 1, `${audioAtPause} -> ${after.audio}`);
  check('resume keeps the engine state (no reset, no stop)', !after.posts.includes('reset') && !after.posts.includes('stop'), JSON.stringify(after.posts.slice(0, 12)));
  check('resume clears the paused state', after.paused === false && after.indicator.includes('يستمع'));
  const wordCount = await page.evaluate(() => JSON.parse(localStorage.getItem('rattil-recitation-history') || '[]').length);
  check('still the same unfinished session', wordCount === savedBefore);
  await page.screenshot({ path: '/tmp/sl-resumed.png' });

  await page.click('#stopRec');
  await page.waitForFunction(() => !!document.getElementById('sessionSummaryDialog')?.open, { timeout: 20000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rattil-recitation-history') || '[]'));
  check('explicit stop still finishes and opens the summary once', saved.length === savedBefore + 1, `sessions=${saved.length} words=${saved.at(-1)?.words?.length}`);
  check('no page errors in the lock/resume flow', errors.length === 0, errors.join(' | '));
  await page.context().close();
}

// --- B: lock -> finish directly from the paused state (summary + saved)
{
  const { page, errors } = await newPage();
  await startSession(page);
  await setHidden(page, true);
  await page.waitForTimeout(1200);
  check('B: paused before finishing', await page.evaluate(() => document.body.classList.contains('recitation-session-paused')));
  await page.click('#stopRec');
  await page.waitForFunction(() => !!document.getElementById('sessionSummaryDialog')?.open, { timeout: 20000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rattil-recitation-history') || '[]'));
  check('B: finishing from the paused state saves the session and shows the summary', saved.length === 1 && saved[0].words.length > 0, `words=${saved[0]?.words?.length}`);
  check('B: no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: '/tmp/sl-finished.png' });
  await page.context().close();
}

// --- C: the mic track dying without a visibility event also pauses
{
  const { page, errors } = await newPage();
  await startSession(page);
  check('C: session live before the mic ends', (await page.evaluate(() => document.body.classList.contains('recitation-session-paused'))) === false);
  await page.evaluate(() => window.__stream.getAudioTracks().forEach(track => track.dispatchEvent(new Event('ended'))));
  await page.waitForTimeout(1200);
  check('C: a dead mic track pauses instead of ending the session', await page.evaluate(() => document.body.classList.contains('recitation-session-paused')));
  check('C: no summary after the mic dies', !(await summaryOpen(page)));
  check('C: no page errors', errors.length === 0, errors.join(' | '));
  await page.context().close();
}

await browser.close();
server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
