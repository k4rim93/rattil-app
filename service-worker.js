const VERSION='__BUILD_ID__';
const CACHE = 'rattil-shell-'+VERSION;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './rattil-wordmark-display.svg', './qvp/lite.mjs', './qvp/lite-path.mjs', ...__BUILD_ASSETS__];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('message',event=>{if(event.data?.type==='GET_VERSION')event.ports[0]?.postMessage({version:VERSION});if(event.data?.type==='APPLY_UPDATE')event.waitUntil(self.skipWaiting())});
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('rattil-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  // Model assets have their own IndexedDB store. Never cache HTML as a model/JS fallback.
  if (/\.onnx(?:$|\.parts\/)/.test(new URL(event.request.url).pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      throw error;
    }
  }));
});
