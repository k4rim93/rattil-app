// Real app + real worker + real engine in headless Chrome, fake microphone fed from a fixture WAV.
// Injects two KNOWN delays and checks the diagnostics report them in the right phase:
//  (a) main thread blocked ~1500 ms at +10 s  -> page loop lag, chunk gap/delivery
//  (b) audio held back from the worker 3000 ms at +25 s -> worker queue wait (and backlog), NOT page loop lag
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const WAV=process.env.WAV||'/tmp/fixtures/rahman46.wav';
const root=new URL('../dist/',import.meta.url).pathname;
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.json':'application/json','.wasm':'application/wasm','.onnx':'application/octet-stream'};
const server=createServer(async(req,res)=>{try{const name=decodeURIComponent(req.url.split('?')[0]).replace(/^\/rattil-app\//,'')||'index.html';if(name.includes('..'))throw Error();res.setHeader('Content-Type',types[extname(name)]||'application/octet-stream');res.end(await readFile(join(root,name)))}catch{res.writeHead(404).end()}}).listen(4178,'127.0.0.1');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+WAV]});
const ctx=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:2,permissions:['microphone']});
const page=await ctx.newPage();
page.on('pageerror',e=>console.log('PAGEERROR',e.message));
await page.addInitScript(()=>{
  const orig=Worker.prototype.postMessage;let held=[],holding=false;
  window.__holdWorker=ms=>{holding=true;setTimeout(()=>{holding=false;const q=held;held=[];for(const [w,a,t] of q)orig.call(w,a,t)},ms)};
  Worker.prototype.postMessage=function(msg,transfer){if(holding&&msg&&msg.type==='audio'){held.push([this,msg,transfer]);return}return orig.call(this,msg,transfer)};
});
await page.goto('http://127.0.0.1:4178/rattil-app/?diag=1');
await page.locator('.tabbar [data-view=practice]').click();
await page.locator('#loadAsr').click();
await page.waitForFunction(()=>document.querySelector('#loadAsr').textContent==='المحرك جاهز',null,{timeout:180000});
const t0=Date.now();
await page.locator('#followFeatureStart').click();
await page.waitForFunction(()=>!document.querySelector('#stopRec').disabled);
await page.evaluate(t0=>{window.__cv=[];let last='';setInterval(()=>{const c=document.querySelector('.recitation-qvp-canvas');if(!c||!c.width)return;try{const x=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=0;for(let i=0;i<x.length;i+=97)h=(h*31+x[i])|0;const k=c.width+':'+h;if(k!==last){last=k;window.__cv.push(Date.now()-t0)}}catch{}},50)},t0);
const at=ms=>page.waitForTimeout(Math.max(0,ms-(Date.now()-t0)));
if(!process.env.NOINJECT){await at(10000);await page.evaluate(()=>{const e=performance.now()+1500;while(performance.now()<e);});console.log('blocked main 1500ms at +10s');}
if(!process.env.NOINJECT){await at(25000);await page.evaluate(()=>window.__holdWorker(3000));console.log('held worker audio 3000ms at +25s');}
await at(44000);
await page.screenshot({path:'/downloads/diag-live.png'});
await page.locator('#stopRec').click();
await page.waitForFunction(()=>window.__rattilDiag,null,{timeout:60000});
await page.waitForTimeout(500);
const r=await page.evaluate(()=>window.__rattilDiag);const cv=await page.evaluate(()=>window.__cv);console.log('CANVAS_CHANGES_MS',JSON.stringify(cv.filter(x=>x>6000&&x<13000)));
console.log(JSON.stringify(r,null,1));if(process.env.RAW){const raw=await page.evaluate(()=>window.__rattilDiagRaw);const t0=raw.main.events.find(e=>e.k==='chunk_first').t;console.log('RAW',JSON.stringify(raw.main.events.filter(e=>['ev_recv','wp_paint','replay'].includes(e.k)).slice(0,16).map(e=>[e.k,e.type,e.t-t0,e.ms,e.a,e.n,e.rest])));console.log('RAWW',JSON.stringify(raw.worker.events.filter(e=>e.k==='ev').slice(0,10).map(e=>[e.type,e.t-t0,e.a])));}
await page.evaluate(()=>{document.getElementById('diagPanel').open=true;document.getElementById('diagPanel').scrollIntoView({block:'start'})});
await page.waitForTimeout(300);
await page.screenshot({path:'/downloads/diag-panel.png'});
await ctx.close();await browser.close();server.close();
