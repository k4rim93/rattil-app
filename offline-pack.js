// Optional offline packs. Files go into the same caches the app already reads from
// (recitation pages: rattil-qvp-v0.5.0 via cache.match(url); fonts: rattil-qpc2-fonts via the service worker).
import { MODEL_KEY, PART_PREFIX, MODEL_BYTES, BLOCK_BYTES } from './model-download.js';
const QVP_CACHE = 'rattil-qvp-v0.5.0', FONT_CACHE = 'rattil-qpc2-fonts';
const QVP = 'https://cdn.quran.ws/qvp/v0.5.0/', FONTS = 'https://fonts.quran.ws/assets/fonts/qpc-hafs-v2/';
const pad = n => String(n).padStart(3, '0');
const pages = Array.from({ length: 604 }, (_, i) => pad(i + 1));
const PACKS = {
  recite: { cache: QVP_CACHE, urls: pages.flatMap(p => [QVP + p + '.qvp', QVP + p + '.words.json']) },
  fonts: { cache: FONT_CACHE, urls: pages.map(p => FONTS + 'QCF2' + p + '.ttf') },
};
const FULL_MB = 366;
const ar = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
async function countCached(pack) {
  if (!('caches' in window)) return 0;
  const cache = await caches.open(pack.cache), have = new Set((await cache.keys()).map(r => r.url));
  return pack.urls.filter(u => have.has(u)).length;
}
// Read-only check of the engine store. Never creates the database: the worker owns its schema.
function engineReady() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open('rattil-zipformer-assets', 1);
      req.onupgradeneeded = () => { try { req.transaction.abort(); } catch {} };
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('assets', 'readonly'), ks = tx.objectStore('assets').getAllKeys();
          ks.onsuccess = () => { const keys = ks.result.map(String); db.close(); resolve(keys.includes(MODEL_KEY) || keys.filter(k => k.startsWith(PART_PREFIX)).length >= Math.ceil(MODEL_BYTES / BLOCK_BYTES)); };
          ks.onerror = () => { db.close(); resolve(false); };
        } catch { db.close(); resolve(false); }
      };
    } catch { resolve(false); }
  });
}
async function download(pack, onProgress, signal) {
  const cache = await caches.open(pack.cache), have = new Set((await cache.keys()).map(r => r.url));
  const todo = pack.urls.filter(u => !have.has(u));
  let done = pack.urls.length - todo.length, failed = 0, next = 0;
  onProgress(done, pack.urls.length);
  const worker = async () => {
    while (next < todo.length && !signal.stop) {
      const url = todo[next++];
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok && !signal.stop; attempt++) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw Error('HTTP ' + res.status);
          await res.clone().arrayBuffer(); // full body must arrive before it is stored
          await cache.put(url, res); ok = true;
        } catch { await new Promise(r => setTimeout(r, 400 * (attempt + 1))); }
      }
      if (ok) onProgress(++done, pack.urls.length); else failed++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { done, failed };
}
export function initOfflinePack({ announce, mount }) {
  if (!mount || !('caches' in window)) return;
  mount.innerHTML = `<div class="st-meter"><div class="st-top"><span>المحفوظ على جهازك</span><b class="mv">...</b></div><div class="st-bar"><i></i></div></div>
<div class="st-pk" data-pack="engine"><span class="n">المحرك<small>٦٦ ميجا</small></span><button type="button" class="st-btn ok op-btn" disabled>...</button></div>
<div class="st-pk" data-pack="recite"><span class="n">صفحات التسميع<small>٩٢ ميجا<span class="op-status"></span></small></span><button type="button" class="st-btn op-btn">تحميل</button></div>
<div class="st-pk" data-pack="fonts"><span class="n">خطوط المصحف<small>٢٠٨ ميجا · اختياري<span class="op-status"></span></small></span><button type="button" class="st-btn op-btn">تحميل</button></div>`;
  const hint = document.createElement('div');
  hint.className = 'st-hint';
  hint.textContent = 'التحميل مرة واحدة على واي فاي، وسيب الشاشة مفتوحة. الصوت والتفسير محتاجين إنترنت دايمًا.';
  mount.after(hint);
  const jobs = {}, q = (key, s) => mount.querySelector(`[data-pack=${key}] ${s}`);
  const meter = async () => {
    try {
      const { usage = 0 } = await navigator.storage.estimate(), mb = Math.round(usage / 1048576);
      mount.querySelector('.mv').textContent = `${ar(mb)} ميجا من ${ar(FULL_MB)}`;
      mount.querySelector('.st-bar i').style.width = Math.min(100, mb / FULL_MB * 100) + '%';
    } catch { mount.querySelector('.mv').textContent = ''; }
  };
  const refreshEngine = async () => {
    const btn = q('engine', '.op-btn'), ok = await engineReady();
    btn.className = 'st-btn op-btn' + (ok ? ' ok' : '');
    btn.disabled = ok; btn.textContent = ok ? '✓ جاهز' : 'من التسميع';
    btn.onclick = ok ? null : () => document.querySelector('.tabbar [data-view=practice]')?.click();
  };
  const refresh = async key => {
    const pack = PACKS[key], n = await countCached(pack), total = pack.urls.length;
    const status = q(key, '.op-status'), btn = q(key, '.op-btn');
    if (n === total) { status.textContent = ''; btn.textContent = '✓ تم'; btn.className = 'st-btn ok op-btn'; btn.disabled = true; }
    else { status.textContent = n ? ` · محمّل ${ar(Math.round(n / total * 100))}٪` : ''; btn.textContent = n ? 'استكمال' : 'تحميل'; btn.className = 'st-btn op-btn'; btn.disabled = false; }
  };
  const refreshAll = () => { refreshEngine(); refresh('recite'); refresh('fonts'); meter(); };
  for (const key of ['recite', 'fonts']) {
    const btn = q(key, '.op-btn'), status = q(key, '.op-status');
    btn.addEventListener('click', async () => {
      if (jobs[key]) { jobs[key].stop = true; return; }
      if (!navigator.onLine) { status.textContent = ' · مفيش إنترنت دلوقتي'; return; }
      try { await navigator.storage?.persist?.(); } catch {}
      if (key === 'recite') for (const f of ['sky-dawn.webp', 'sky-day.webp', 'sky-sunset.webp', 'sky-night.webp', 'cloud-alpha.webp', 'cloud-drift.webp', 'sky-portrait.jpg']) fetch(new URL(f, document.baseURI)).catch(() => {}); // service worker keeps same-origin files
      const signal = { stop: false }; jobs[key] = signal; btn.textContent = 'إيقاف'; btn.disabled = false;
      const { failed } = await download(PACKS[key], (d, t) => { status.textContent = ` · بيتحمّل ${ar(Math.round(d / t * 100))}٪`; }, signal);
      delete jobs[key];
      await refresh(key); meter();
      if (failed && !signal.stop) { status.textContent = ` · ${ar(failed)} ملف فشل`; announce('التحميل وقف قبل ما يخلص. اضغط استكمال.'); }
      else if (!signal.stop) announce('اتحمّل بنجاح. هيشتغل دون إنترنت.');
    });
  }
  document.querySelector('.tabbar [data-view=settings]')?.addEventListener('click', () => setTimeout(refreshAll, 300));
  refreshAll();
}
