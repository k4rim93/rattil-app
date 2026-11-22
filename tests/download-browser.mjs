import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
const root = new URL('../dist/', import.meta.url).pathname;
const live = process.env.LIVE_URL;
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.webmanifest':'application/manifest+json', '.wasm':'application/wasm' };
const server = live ? null : createServer(async(req,res) => { try { const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/rattil-app\//,'') || 'index.html'; if(name.includes('..'))throw Error();res.setHeader('Content-Type', types[extname(name)] || 'application/octet-stream');res.end(await readFile(join(root,name))); } catch {res.writeHead(404).end();} }).listen(4173,'127.0.0.1');
const browser = await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
const url = live || 'http://127.0.0.1:4173/rattil-app/';
try {
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
  let page = await context.newPage();
  const requests=[];
  await context.route('**/*.onnx.parts/*.bin',async route => {
    requests.push(route.request().url());
    if(route.request().url().endsWith('/3.bin') && !context.__resumed) {
      // Simulate an interrupted network transfer. Blocks 0..2 have committed already.
      await route.abort('failed');
    } else await route.continue();
  });
  await page.goto(url); await page.locator('.tabbar [data-view=practice]').click();await page.locator('#loadAsr').click();
  await page.waitForFunction(()=>document.querySelector('#asrStatus').textContent.includes('تعذر تشغيل'),null,{timeout:180000});
  const keys=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('rattil-zipformer-assets',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('assets').objectStore('assets').getAllKeys();q.onsuccess=()=>{db.close();resolve(q.result)};q.onerror=reject}}));
  assert.equal(keys.filter(k=>k.includes(':part-v1:')).length,3);
  await page.screenshot({path:'/downloads/rattil-download-interrupted.png',fullPage:true});
  await page.close();context.__resumed=true;requests.length=0;page=await context.newPage();await page.goto(url);await page.locator('.tabbar [data-view=practice]').click();
  await page.waitForFunction(()=>document.querySelector('#loadAsr').textContent==='المحرك جاهز',null,{timeout:180000});
  assert.ok(requests[0].endsWith('/3.bin'));assert.ok(!requests.some(r=>/\/[012]\.bin$/.test(r)));
  console.log('PASS real browser close/reopen: 3 saved blocks retained; first request is block 3; real ONNX session ready.');
  await page.screenshot({path:'/downloads/rattil-download-ready.png',fullPage:true});
  await page.evaluate(async()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  await page.waitForFunction(()=>document.querySelector('#loadAsr').textContent==='المحرك جاهز',null,{timeout:180000});
  requests.length=0;await context.setOffline(true);await page.reload();await page.locator('.tabbar [data-view=practice]').click();
  await page.waitForFunction(()=>document.querySelector('#loadAsr').textContent==='المحرك جاهز',null,{timeout:180000});assert.equal(requests.length,0);
  console.log('PASS completed cache reused after reload, including real model initialization offline, with zero model requests.');
  await page.screenshot({path:'/downloads/rattil-download-offline.png',fullPage:true});
  await context.close();
}finally {await browser.close();server?.close();}
