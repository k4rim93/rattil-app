// Private on-device timing diagnostics. Numbers only: no audio, no transcripts,
// nothing leaves the device. Bounded: capped event list, per-second buckets and
// capped sample reservoirs. Both the page and the ASR worker use one log each;
// the page merges the worker's log when a session stops.
export const DIAG_VERSION = 1;
const EVENT_CAP = 700, BUCKET_CAP = 1800, SAMPLE_CAP = 6000;

export function createDiag() {
  let events = [], buckets = new Map(), samples = {}, statics = {}, t0 = 0;
  return {
    reset(now = Date.now()) { events = []; buckets = new Map(); samples = {}; t0 = now; },
    get t0() { return t0; },
    setStatic(key, value) { statics[key] = value; },
    mark(kind, data = {}, now = Date.now()) {
      if (events.length >= EVENT_CAP) events.splice(1, 1); // keep the first entry
      events.push({ k: kind, t: now, ...data });
    },
    bucket(now, field, value, mode = 'max') {
      const key = Math.floor(now / 1000);
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= BUCKET_CAP) buckets.delete(buckets.keys().next().value);
        b = {}; buckets.set(key, b);
      }
      if (mode === 'max') b[field] = b[field] === undefined ? value : Math.max(b[field], value);
      else b[field] = (b[field] || 0) + value;
    },
    sample(name, value) {
      const a = samples[name] || (samples[name] = []);
      if (a.length >= SAMPLE_CAP) a.shift();
      a.push(value);
    },
    snapshot() {
      return { v: DIAG_VERSION, t0, statics: { ...statics }, events: events.slice(), buckets: [...buckets].map(([s, b]) => ({ s, ...b })), samples: { ...samples } };
    },
  };
}

export function pct(values, p) {
  if (!values || !values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
const r0 = v => v == null ? null : Math.round(v);
const dist = values => values && values.length ? { n: values.length, p50: r1(pct(values, .5)), p95: r1(pct(values, .95)), max: r1(Math.max(...values)) } : null;

// Builds the phase report. main/worker are diag snapshots (worker may be null).
export function buildDiagReport(main, worker, saved = null) {
  const me = main?.events || [], we = worker?.events || [];
  const firstChunk = me.find(e => e.k === 'chunk_first');
  const t0 = firstChunk ? firstChunk.t : (main?.t0 || 0);
  const rel = t => t == null ? null : r0(t - t0);
  const ctx = me.find(e => e.k === 'ctx') || {};
  const findW = (type, nonEmpty) => we.find(e => e.k === 'ev' && e.type === type && (!nonEmpty || e.chars > 0));
  const onset = we.find(e => e.k === 'onset');
  const phase = (e, label) => e ? { label, audioMs: r0(e.a), wallMs: rel(e.t), backlogMs: e.a == null ? null : rel(e.t) - r0(e.a) } : null;
  const firstDecode = findW('raw_transcript', true), firstCand = findW('verse_candidate'), firstMatch = findW('verse_match'), firstWp = findW('word_progress');
  const recvWp = me.find(e => e.k === 'ev_recv' && e.type === 'word_progress');
  const paint = me.find(e => e.k === 'wp_paint');
  const wpList = we.filter(e => e.k === 'ev' && e.type === 'word_progress').slice(0, 60).map(e => ({ audioMs: r0(e.a), wallMs: rel(e.t), ayah: e.ayah, matched: e.matched }));
  // Scorer windows and what the live path saw inside them.
  const windows = [];
  const bucketsW = worker?.buckets || [];
  const maxIn = (from, to, field) => { let m = null; for (const b of bucketsW) { const s = b.s * 1000; if (s + 999 >= from && s <= to && b[field] != null) m = m == null ? b[field] : Math.max(m, b[field]); } return m; };
  let open = null;
  for (const e of we) {
    if (e.k === 'scorer_init_start') open = { kind: 'scorer_init', from: e.t };
    else if (e.k === 'scorer_init_end' && open) { windows.push({ ...open, to: e.t, ok: e.ok }); open = null; }
    else if (e.k === 'rescore_start') open = { kind: 'rescore', from: e.t, audioSec: r1(e.samples / 16000) };
    else if (e.k === 'rescore_end' && open) { windows.push({ ...open, to: e.t, err: e.err || undefined }); open = null; }
    else if (e.k === 'final_pass_start') open = { kind: 'final_pass', from: e.t, audioSec: r1(e.samples / 16000), surah: e.surah, ayahFrom: e.from, ayahTo: e.to };
    else if (e.k === 'final_pass_end' && open) { windows.push({ ...open, to: e.t, aborted: e.aborted || undefined, err: e.err || undefined }); open = null; }
  }
  if (open) windows.push({ ...open, to: null, open: true });
  const scorer = windows.map(w => {
    const to = w.to == null ? (worker?.buckets?.length ? worker.buckets[worker.buckets.length - 1].s * 1000 + 999 : w.from) : w.to;
    return { kind: w.kind, atMs: rel(w.from), durMs: r0(to - w.from), ok: w.ok, audioSec: w.audioSec, liveMaxQueueMs: r0(maxIn(w.from, to, 'queue')), liveMaxLoopLagMs: r0(maxIn(w.from, to, 'loop')), liveMaxFeedMs: r0(maxIn(w.from, to, 'feed')) };
  });
  const mb = main?.buckets || [];
  const gapDrops = me.filter(e => e.k === 'chunk_gap').slice(0, 12).map(e => ({ atMs: rel(e.t), gapMs: r0(e.gap) }));
  const ws = worker?.samples || {}, mss = main?.samples || {};
  const feedMs = ws.feed || [];
  const audioSec = (ws.samples || []).reduce((a, b) => a + b, 0) / 16000;
  const totalFeed = feedMs.reduce((a, b) => a + b, 0);
  const vis = me.filter(e => e.k === 'visibility').map(e => ({ atMs: rel(e.t), state: e.state }));
  return {
    v: DIAG_VERSION,
    device: { sampleRate: ctx.sampleRate ?? null, baseLatencyMs: r1((ctx.baseLatency ?? 0) * 1000) || null, ctxState: ctx.state ?? null, ua: ctx.ua ?? null },
    init: worker?.statics?.init || null,
    session: { audioSec: r1(audioSec), engineSpeed: totalFeed ? r1(audioSec * 1000 / totalFeed) : null },
    phases: {
      speechOnset: phase(onset, 'first speech energy (audio time)'),
      firstDecoded: phase(firstDecode, 'first decoded text'),
      firstCandidate: phase(firstCand, 'first verse candidate'),
      locked: phase(firstMatch, 'locked verse (verse_match)'),
      firstCursor: phase(firstWp, 'first word_progress emitted by engine'),
      firstCursorReceived: recvWp ? { wallMs: rel(recvWp.t), workerToPageMs: r0(recvWp.t - recvWp.wt) } : null,
      firstPaint: paint ? { wallMs: rel(paint.t), receivedToPaintMs: r0(paint.ms) } : null,
    },
    capture: { chunkGapMs: dist(mss.gap), deliveryMs: dist(mss.deliver), dropouts: gapDrops, levelPeakDb: (() => { const l = mb.map(b => b.lvl).filter(v => v != null); return l.length ? r1(20 * Math.log10(Math.max(...l) || 1e-9)) : null; })(), visibility: vis },
    worker: { queueMs: dist(ws.queue), feedMs: dist(feedMs), loopLagMs: dist(ws.loop), transportToPageMs: dist(mss.transport) },
    page: { loopLagMs: dist(mss.loop), paintMs: dist(mss.paint) },
    appReveal: (() => { const first = k => { const e = me.find(x => x.k === k && x.t >= t0); return e ? rel(e.t) : null; }; return { revealStartMs: first('reveal_start'), surahListReadyMs: first('reveal_verses'), pageLoadStartMs: first('page_load_start'), pageLoadedMs: first('page_loaded') }; })(),
    scorer,
    wordProgress: wpList,
    // Counters of the last saved (or just-finished) session, passed in by the
    // app from its local record: digits and reason keys only, never text.
    savedSession: saved,
    unobservable: [
      'per-word reveal delay against the actual spoken word (no ground-truth timing of speech)',
      'engine confirmation wait versus decoder wait (the engine reports no internal state)',
      'phone CPU throttling or iOS audio-session changes beyond chunk gaps and loop lag',
    ],
  };
}

const f = v => v == null ? 'غير متاح' : String(v);
const s = ms => ms == null ? 'غير متاح' : (Math.round(ms / 100) / 10) + ' ث';
// Short Arabic summary lines for the diagnostic panel.
export function renderDiagLines(report) {
  const L = [];
  const p = report.phases;
  const line = (label, ph) => L.push(`${label}: ${ph ? `${s(ph.audioMs)} من الصوت · ${s(ph.wallMs)} من بدء الجلسة · تراكم ${ph.backlogMs == null ? 'غير متاح' : ph.backlogMs + ' م.ث'}` : 'لم يحدث'}`);
  L.push(`الجهاز: عيّنة ${f(report.device.sampleRate)} هرتز · ${f(report.device.ctxState)}`);
  L.push(`مدة الصوت ${f(report.session.audioSec)} ث · سرعة المحرك ${f(report.session.engineSpeed)}×`);
  if (report.init) L.push(`تهيئة المحرك: تحميل الملفات ${report.init.assetsMs} م.ث · إنشاء الجلسة ${report.init.createSessionMs} م.ث`);
  line('بداية الصوت', p.speechOnset);
  line('أول نص مسموع', p.firstDecoded);
  line('أول مرشّح آية', p.firstCandidate);
  line('تحديد الآية', p.locked);
  line('أول تقدّم كلمة من المحرك', p.firstCursor);
  if (p.firstCursorReceived) L.push(`وصول أول كلمة للصفحة: ${s(p.firstCursorReceived.wallMs)} (نقل العامل→الصفحة ${p.firstCursorReceived.workerToPageMs} م.ث)`);
  if (p.firstPaint) L.push(`أول رسم مُسجَّل بعد وصول تحديث (قد يكون أبعد من أول رسم فعلي): ${s(p.firstPaint.wallMs)} (من الوصول للرسم ${p.firstPaint.receivedToPaintMs} م.ث)`);
  const d = x => x ? `وسيط ${x.p50} · 95٪ ${x.p95} · أقصى ${x.max} م.ث` : 'غير متاح';
  L.push(`التقاط: فجوة بين الأجزاء ${d(report.capture.chunkGapMs)} · وصول ${d(report.capture.deliveryMs)}`);
  if (report.capture.dropouts.length) L.push(`انقطاعات التقاط: ${report.capture.dropouts.map(x => `${s(x.atMs)}:${x.gapMs}م.ث`).join(' · ')}`);
  if (report.capture.levelPeakDb != null) L.push(`أعلى مستوى صوت ${report.capture.levelPeakDb} ديسيبل`);
  L.push(`العامل: انتظار ${d(report.worker.queueMs)} · معالجة ${d(report.worker.feedMs)} · توقف الحلقة ${d(report.worker.loopLagMs)}`);
  L.push(`الصفحة: توقف الحلقة ${d(report.page.loopLagMs)} · من وصول تقدّم الكلمة إلى ظهورها ${d(report.page.paintMs)}`);
  const ar = report.appReveal; if (ar) L.push(`تجهيز المصحف بعد تحديد الآية: بدء ${s(ar.revealStartMs)} · قائمة الآيات جاهزة ${s(ar.surahListReadyMs)} · بدء تحميل الصفحة ${s(ar.pageLoadStartMs)} · الصفحة جاهزة ${s(ar.pageLoadedMs)}`);
  if (!report.scorer.length) L.push('المصحّح الصوتي: لم يعمل في هذه الجلسة');
  for (const w of report.scorer) L.push(`المصحّح ${w.kind === 'scorer_init' ? 'تهيئة' : w.kind === 'final_pass' ? 'فحص ختامي' : 'إعادة تقييم'} عند ${s(w.atMs)} لمدة ${w.durMs} م.ث${w.ok === false || w.err ? ' (فشل)' : ''}${w.aborted ? ' (أُجهض)' : ''} · أقصى انتظار للصوت الحي خلالها ${f(w.liveMaxQueueMs)} · توقف ${f(w.liveMaxLoopLagMs)} م.ث`);
  const ss = report.savedSession;
  if (ss) {
    if (ss.unavailable) L.push('الفحص المحفوظ: غير متاح في هذه الجلسة');
    const fin = ss.stats?.final;
    if (fin) L.push(`الفحص الختامي المحفوظ: خُطّط ${fin.planned} · غطّى ${fin.coveredAyahs} · تجاوز الميزانية ${fin.budgetSkipped}`);
    const fails = ss.stats?.fails || {};
    const failKeys = Object.keys(fails);
    if (failKeys.length) L.push(`خروجات الفحص المباشر المحفوظة: ${failKeys.map(k => `${k}×${fails[k]}`).join(' · ')}`);
    if (ss.unreviewed) L.push(`كلمات بلا فحص محفوظ: ${ss.unreviewed}${ss.unreviewedWords?.length ? ` (${ss.unreviewedWords.join('، ')})` : ''}`);
  }
  L.push('غير قابل للقياس هنا: تأخر ظهور كل كلمة مقارنة بنطقها الفعلي؛ وسبب انتظار التأكيد داخل المحرك.');
  return L;
    }
