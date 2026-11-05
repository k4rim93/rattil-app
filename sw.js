const CACHE='rattil-visual-redesign-v1';
const CORE=['./','./index.html','./rattil-v2.css'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(CORE);await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('rattil-')&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const u=new URL(event.request.url);if(u.origin!==self.location.origin||u.pathname.endsWith('.onnx'))return;event.respondWith((async()=>{const hit=await caches.match(event.request);if(hit)return hit;const res=await fetch(event.request);if(res.ok){try{await(await caches.open(CACHE)).put(event.request,res.clone());}catch(e){console.warn('Rattil cache skipped',u.href,e);}}return res;})());});
