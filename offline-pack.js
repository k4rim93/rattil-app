// Optional offline packs. Files go into the same caches the app already reads from
// (recitation pages: rattil-qvp-v0.5.0 via cache.match(url); fonts: rattil-qpc2-fonts via the service worker).
const QVP_CACHE = 'rattil-qvp-v0.5.0', FONT_CACHE = 'rattil-qpc2-fonts';
const QVP = 'https://cdn.quran.ws/qvp/v0.5.0/', FONTS = 'https://fonts.quran.ws/assets/fonts/qpc-hafs-v2/';
const pad = n => String(n).padStart(3, '0');
const pages = Array.from({ length: 604 }, (_, i) => pad(i + 1));
const PACKS = {
  recite: { cache: QVP_CACHE, urls: pages.flatMap(p => [QVP + p + '.qvp', QVP + p + '.words.json']), mb: 92 },
  fonts: { cache: FONT_CACHE, urls: pages.map(p => FONTS + 'QCF2' + p + '.ttf'), mb: 208 },
};
const ar = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
async function countCached(pack) {
  if (!('caches' in window)) return 0;
  const cache = await caches.open(pack.cache), have = new Set((await cache.keys()).map(r => r.url));
  return pack.urls.filter(u => have.has(u)).length;
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
export function initOfflinePack({ announce }) {
  const anchor = document.getElementById('offlineButton');
  if (!anchor || !('caches' in window)) return;
  const box = document.createElement('div');
  box.className = 'list-row offline-pack';
  box.style.cssText = 'display:block;height:auto';
  box.innerHTML = `<strong>تحميل المصحف للعمل دون إنترنت</strong>
<small style="display:block;max-width:none;margin:4px 0 10px">التحميل بيتعمل مرة واحدة، وإنت على واي فاي. سيب الشاشة مفتوحة أثناء التحميل. الصوت والتفسير يحتاجون إنترنت دايمًا.</small>
<div class="offline-row" data-pack="recite"><div><b>التسميع</b> <span class="op-size">حوالي ${ar(92)} ميجا</span><br><small class="op-status" role="status">...</small></div><button type="button" class="gold-button op-btn">تحميل</button></div>
<div class="offline-row" data-pack="fonts" style="margin-top:12px"><div><b>القراءة من المصحف (الخطوط)</b> <span class="op-size">حوالي ${ar(208)} ميجا</span><br><small class="op-status" role="status">...</small></div><button type="button" class="gold-button op-btn">تحميل</button></div>
<small class="op-store" style="display:block;max-width:none;margin-top:10px"></small>`;
  const st = document.createElement('style');
  st.textContent = '.offline-pack .offline-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.offline-pack .op-size{font-size:11px;opacity:.75}.offline-pack .op-btn{min-width:84px;flex:0 0 auto}.offline-pack .op-status{max-width:none}';
  document.head.append(st);
  anchor.after(box);
  const jobs = {};
  const refresh = async key => {
    const row = box.querySelector(`[data-pack=${key}]`), pack = PACKS[key], n = await countCached(pack), total = pack.urls.length;
    const label = row.querySelector('.op-status'), btn = row.querySelector('.op-btn');
    if (n === total) { label.textContent = 'تم التحميل. شغّال دون إنترنت ✓'; btn.textContent = 'تم'; btn.disabled = true; }
    else { label.textContent = n ? `محمّل ${ar(n)} من ${ar(total)} ملف. اضغط استكمال.` : 'لسه ما اتحمّلش'; btn.textContent = n ? 'استكمال' : 'تحميل'; btn.disabled = false; }
  };
  const showStore = async () => {
    const el = box.querySelector('.op-store');
    try {
      const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
      el.textContent = persisted ? 'التخزين محمي من الحذف التلقائي.' : persisted === false ? 'ممكن الجهاز يمسح التخزين لو مساحته قلّت. فتح التطبيق من الشاشة الرئيسية بيقلل ده.' : '';
    } catch { el.textContent = ''; }
  };
  box.querySelectorAll('.offline-row').forEach(row => {
    const key = row.dataset.pack, btn = row.querySelector('.op-btn'), label = row.querySelector('.op-status');
    btn.addEventListener('click', async () => {
      if (jobs[key]) { jobs[key].stop = true; return; }
      if (!navigator.onLine) { label.textContent = 'مفيش إنترنت دلوقتي. جرّب لما تتصل.'; return; }
      try { await navigator.storage?.persist?.(); } catch {}
      if (key === 'recite') for (const f of ['sky-dawn.webp','sky-day.webp','sky-sunset.webp','sky-night.webp','cloud-alpha.webp','cloud-drift.webp','sky-portrait.jpg']) fetch(new URL(f, document.baseURI)).catch(() => {}); // service worker keeps same-origin files
      const signal = { stop: false }; jobs[key] = signal; btn.textContent = 'إيقاف'; btn.disabled = false;
      const { done, failed } = await download(PACKS[key], (d, t) => { label.textContent = `بيتحمّل… ${ar(d)} من ${ar(t)} (${ar(Math.round(d / t * 100))}٪)`; }, signal);
      delete jobs[key];
      await refresh(key); await showStore();
      if (failed && !signal.stop) { label.textContent += ` · ${ar(failed)} ملف فشل، اضغط استكمال.`; announce('التحميل وقف قبل ما يخلص. اضغط استكمال.'); }
      else if (!signal.stop) announce('اتحمّل بنجاح. هيشتغل دون إنترنت.');
    });
    refresh(key);
  });
  showStore();
}
