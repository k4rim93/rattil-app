// Settings screen layout. Presentation only: every control keeps its id, listeners and storage keys.
// Native selects stay in the DOM (hidden or invisible overlays) so app.js and unified.js behave as before.
const CSS = `
#view-settings{--st-card:rgba(255,255,255,.055);--st-edge:rgba(255,255,255,.13);--st-gold:#f7dc8e;--st-mut:#9fb0c4;--st-txt:#eef3f9;--st-sep:rgba(255,255,255,.10);--st-btn:#eec96f;--st-btnt:#14243c;--st-sel:rgba(247,220,142,.10);--st-bg:rgba(255,255,255,.05)}
body.light #view-settings{--st-card:rgba(255,255,255,.72);--st-edge:rgba(18,41,61,.10);--st-gold:#8a6d2f;--st-mut:#5f7488;--st-txt:#12293d;--st-sep:rgba(18,41,61,.10);--st-btn:#dcb85f;--st-btnt:#3a2c07;--st-sel:rgba(138,109,47,.12);--st-bg:rgba(255,255,255,.55)}
#view-settings [hidden]{display:none!important}
#view-settings .page-heading{padding:22px 2px 4px}#view-settings .page-heading p{display:none}
#view-settings .st-wrap{padding-bottom:140px;color:var(--st-txt)}
#view-settings .st-sec{font-size:13px;color:var(--st-gold);margin:22px 6px 9px;display:flex;align-items:center;gap:8px}
#view-settings .st-sec:after{content:'';flex:1;height:1px;background:var(--st-sep)}
#view-settings .st-card{background:var(--st-card);border:1px solid var(--st-edge);border-radius:18px;overflow:hidden;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
#view-settings .st-seg{display:flex;background:var(--st-card);border:1px solid var(--st-edge);border-radius:16px;padding:4px;gap:4px}
#view-settings .st-seg button{flex:1;border:0;background:transparent;color:var(--st-mut);padding:10px 0;border-radius:12px;font:inherit;font-size:14px;min-height:44px}
#view-settings .st-seg button.on{background:var(--st-btn);color:var(--st-btnt);font-weight:700}
#view-settings .st-eds{display:flex;gap:10px}
#view-settings .st-ed{flex:1;background:var(--st-card);border:1px solid var(--st-edge);border-radius:16px;padding:10px;text-align:center;font:inherit;font-size:13px;color:var(--st-txt);position:relative}
#view-settings .st-ed.on{border:1.5px solid var(--st-gold);background:var(--st-sel)}
#view-settings .st-ed.on:after{content:'✓';position:absolute;top:8px;left:10px;color:var(--st-gold);font-size:13px}
#view-settings .st-pg{height:78px;border-radius:8px;border:1px solid var(--st-edge);margin-bottom:8px;padding:9px 12px;display:flex;flex-direction:column;gap:5px;background:var(--st-bg)}
#view-settings .st-pg i{display:block;height:3px;border-radius:2px;background:var(--st-mut);opacity:.7}
#view-settings .st-pg i:nth-child(3n){width:70%}
#view-settings .st-ed.on .st-pg i{background:var(--st-gold);opacity:1}
#view-settings .st-ed:not(.on) .st-pg i{height:4px;opacity:.45}
#view-settings .st-chips{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#view-settings .st-chip{display:flex;align-items:center;gap:8px;padding:6px 12px 6px 10px;min-height:48px;border:1px solid var(--st-edge);border-radius:16px;background:var(--st-card);font:inherit;font-size:13px;line-height:1.5;text-align:start;color:var(--st-txt)}
#view-settings .st-chip b{flex:0 0 26px;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--st-bg);border:1px solid var(--st-edge);font-size:12px;color:var(--st-gold);font-weight:600}
#view-settings .st-chip.on{background:var(--st-btn);color:var(--st-btnt);border-color:var(--st-btn);font-weight:700}
#view-settings .st-chip.on b{background:#0002;border-color:#0003;color:var(--st-btnt)}
#view-settings .st-row{display:flex;align-items:center;gap:12px;padding:0 16px;min-height:54px;width:100%;margin:0;background:transparent;border:0;border-top:1px solid var(--st-sep);border-radius:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;color:var(--st-txt);font:inherit;font-size:15px;text-align:start;position:relative}
#view-settings .st-card>.st-row:first-child,#view-settings .st-card>.st-pk:first-child{border-top:0}
#view-settings .st-row .list-icon,#view-settings .st-row .st-g{width:22px;height:auto;flex:0 0 22px;border:0;background:none;border-radius:0;color:var(--st-gold);font-size:17px;text-align:center;display:block}
#view-settings .st-row>span:nth-child(2){flex:1;min-width:0}
#view-settings .st-row strong,#view-settings .st-row .st-t{font-weight:400;font-size:15px;color:var(--st-txt)}
#view-settings .st-row small{display:none}
#view-settings .st-row .st-v{margin-inline-start:auto;color:var(--st-gold);font-size:14px;white-space:nowrap;max-width:48%;overflow:hidden;text-overflow:ellipsis}
#view-settings .st-row .st-v:after{content:' ‹';color:var(--st-mut)}
#view-settings .st-row .chevron{margin-inline-start:auto;color:var(--st-mut);font-size:18px}
#view-settings .st-row .st-v+.chevron{display:none}
#view-settings .st-sel select{position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px;margin:0;border:0}
#view-settings .st-about details{border-top:1px solid var(--st-sep)}
#view-settings .st-about summary{display:flex;align-items:center;gap:12px;min-height:54px;padding:0 16px;font-size:15px;color:var(--st-txt);list-style:none}
#view-settings .st-about summary::-webkit-details-marker{display:none}
#view-settings .st-about summary:before{content:'❋';color:var(--st-gold);width:22px;text-align:center}
#view-settings .st-about details p{margin:0;padding:0 16px 14px;font-size:12px;line-height:1.9;color:var(--st-mut)}
#view-settings .st-note{padding:10px 16px;font-size:12px;line-height:1.7;color:var(--st-mut);border-top:1px solid var(--st-sep)}
#view-settings .st-note:empty{display:none}
#view-settings .st-note #refreshAppStatus{margin:0;padding:0}
#view-settings .st-note .quiet-link{display:none}
#view-settings .st-about #readerCredits{border:0;background:none;border-radius:0;margin:0;padding:0;box-shadow:none}
#view-settings .st-about #readerCredits summary{background:none;border:0}
#view-settings .st-meter{padding:14px 16px 4px}
#view-settings .st-top{display:flex;justify-content:space-between;font-size:13px;color:var(--st-mut)}.st-top b{color:var(--st-gold);font-weight:600}
#view-settings .st-bar{height:8px;border-radius:8px;background:var(--st-sep);margin:9px 0 10px;overflow:hidden;direction:ltr}
#view-settings .st-bar i{display:block;height:100%;width:0;background:var(--st-gold);transition:width .3s}
#view-settings .st-pk{display:flex;align-items:center;gap:12px;padding:0 16px;min-height:60px;border-top:1px solid var(--st-sep)}
#view-settings .st-pk .n{flex:1;font-size:15px;color:var(--st-txt)}
#view-settings .st-pk .n small{display:block;color:var(--st-mut);font-size:11.5px;margin-top:1px}
#view-settings .st-btn{border:0;border-radius:10px;padding:8px 16px;min-height:38px;min-width:76px;font:600 13px inherit;font-family:inherit;background:var(--st-btn);color:var(--st-btnt)}
#view-settings .st-btn.ok{background:transparent;border:1px solid var(--st-edge);color:var(--st-gold)}
#view-settings .st-hint{font-size:11.5px;color:var(--st-mut);margin:9px 8px 0;line-height:1.8}
body[data-view=settings] #backToTop{display:none!important}
`;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export function initSettingsUi() {
  const $ = id => document.getElementById(id), view = $('view-settings');
  if (!view || document.getElementById('st-style')) return {};
  const st = document.createElement('style'); st.id = 'st-style'; st.textContent = CSS; document.head.append(st);
  const wrap = el('div', 'st-wrap'), hold = el('div'); hold.hidden = true;
  const sec = t => wrap.append(el('div', 'st-sec', t));
  const card = cls => { const c = el('div', 'st-card' + (cls ? ' ' + cls : '')); wrap.append(c); return c; };
  const syncs = [];
  // Theme: 3-way switch driving the existing toggle (it cycles auto, light, night).
  const toggle = $('themeToggle'); hold.append(toggle);
  const modes = [['auto', 'تلقائي'], ['light', 'نهاري'], ['night', 'ليلي']];
  const mode = () => { const v = localStorage.getItem('rattil-theme-mode'); return modes.some(m => m[0] === v) ? v : 'auto'; };
  sec('المظهر');
  const seg = el('div', 'st-seg');
  for (const [k, l] of modes) { const b = el('button', '', l); b.type = 'button'; b.dataset.mode = k; b.addEventListener('click', () => { for (let i = 0; i < 3 && mode() !== k; i++) toggle.click(); sync(); }); seg.append(b); }
  const syncTheme = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode()));
  syncs.push(syncTheme); wrap.append(seg);
  new MutationObserver(syncTheme).observe(toggle, { subtree: true, childList: true, characterData: true });
  // Edition: two page-preview cards.
  const edSel = $('editionSelect'); hold.append(edSel.closest('.list-row') || edSel);
  sec('المصحف');
  const eds = el('div', 'st-eds');
  for (const [v, l] of [['qpc2', 'مصحف المدينة ١٤٢١'], ['classic', 'الطبعة الحالية']]) {
    const b = el('button', 'st-ed', `<div class="st-pg"><i></i><i></i><i></i><i></i><i></i><i></i></div>${l}`); b.type = 'button'; b.dataset.v = v;
    b.addEventListener('click', () => { edSel.value = v; edSel.dispatchEvent(new Event('change', { bubbles: true })); sync(); }); eds.append(b);
  }
  syncs.push(() => eds.querySelectorAll('.st-ed').forEach(b => b.classList.toggle('on', b.dataset.v === edSel.value))); wrap.append(eds);
  // Reciter: pills built from the default-reciter select.
  const recSel = $('defaultReciter'); if (recSel) {
    hold.append(recSel.closest('.list-row') || recSel);
    sec('القارئ الافتراضي');
    const chips = el('div', 'st-chips');
    for (const o of [...recSel.options].sort((a, b) => (b.value === 'mp3-yasser') - (a.value === 'mp3-yasser'))) {
      const name = o.textContent, last = name.split(' · ')[0].trim().split(/\s+/).pop().replace(/^ال/, '');
      const b = el('button', 'st-chip', `<b>${last[0] || ''}</b>${name}`); b.type = 'button'; b.dataset.v = o.value;
      b.addEventListener('click', () => { recSel.value = o.value; recSel.dispatchEvent(new Event('change', { bubbles: true })); sync(); }); chips.append(b);
    }
    recSel.addEventListener('change', () => sync());
    syncs.push(() => chips.querySelectorAll('.st-chip').forEach(b => b.classList.toggle('on', b.dataset.v === recSel.value))); wrap.append(chips);
  }
  // Prayer times: location button, manual city, calculation method.
  sec('المواقيت');
  const times = card(), locBtn = $('locationButton'), label = $('settingsLocationLabel');
  locBtn.classList.remove('list-row'); locBtn.classList.add('st-row'); locBtn.querySelector('strong').textContent = 'الموقع';
  const locVal = el('span', 'st-v'); locBtn.querySelector('.chevron')?.before(locVal);
  const syncLoc = () => { const t = (label.textContent || '').split(' · ')[0].replace(' (افتراضي)', '').trim(); locVal.textContent = /^اختر|^اضغط/.test(t) ? 'غير محددة' : t; };
  syncs.push(syncLoc); new MutationObserver(syncLoc).observe(label, { subtree: true, childList: true, characterData: true });
  times.append(locBtn);
  const selectRow = (sel, icon, title) => {
    const r = el('label', 'st-row st-sel', `<span class="st-g">${icon}</span><span class="st-t">${title}</span><span class="st-v"></span>`);
    r.append(sel); const v = r.querySelector('.st-v'), upd = () => { v.textContent = (sel.selectedOptions[0]?.textContent || '').replace('…', ''); };
    sel.addEventListener('change', upd); syncs.push(upd); return r;
  };
  const citySel = $('citySelect'), methodSel = $('methodSelect');
  const cityOld = citySel.closest('.list-row'), methodOld = methodSel.closest('.list-row');
  times.append(selectRow(citySel, '◈', 'المدينة'), selectRow(methodSel, '۩', 'طريقة الحساب'));
  cityOld?.remove(); methodOld?.remove();
  // Offline: filled by offline-pack.js.
  sec('دون إنترنت');
  const offline = card(); $('offlineButton').hidden = true; hold.append($('offlineButton'));
  // About.
  sec('عن رتل');
  const about = card('st-about'), refresh = $('refreshApp');
  refresh.classList.remove('list-row'); refresh.classList.add('st-row'); refresh.querySelector('strong').textContent = 'تحديث النسخة';
  const note = el('div', 'st-note'); note.append($('refreshAppStatus')); const dismiss = view.querySelector('.un-dismiss-update'); if (dismiss) note.append(dismiss);
  about.append(refresh, note); const credits = $('readerCredits'); if (credits) about.append(credits);
  // Replace the old list.
  view.querySelector('.simple-list')?.setAttribute('hidden', ''); view.querySelector('.un-settings-title')?.setAttribute('hidden', '');
  view.querySelector('.un-settings-group')?.setAttribute('hidden', '');
  wrap.append(hold); view.querySelector('.page-heading').after(wrap);
  function sync() { syncs.forEach(f => f()); }
  sync(); view.addEventListener('pointerdown', () => setTimeout(sync, 0)); document.querySelector('.tabbar [data-view=settings]')?.addEventListener('click', () => setTimeout(sync, 200));
  return { offline };
}
