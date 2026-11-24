import { createSettledWordBridge } from './settled-words.js';
import { planFinalPass } from './final-pass.js';
import { downloadModel } from "./model-download.js";
import * as ort from "onnxruntime-web/wasm";
import { createRecognitionSession } from "@tilawa/core";
import { createDiag } from "./diag.js";

let appBase = new URL(/* @vite-ignore */ "../", import.meta.url);
const asset = (path) => new URL(path, appBase).href;
const modelUrl = () => asset("models/zipformer_a0w_ep1_a05.int8.onnx");
const ioUrl = () => asset("models/zipformer_a0w_ep1_a05.io.json");
const corpusUrl = () => asset("zipformer_quran.json");
const quranUrl = () => asset("quran.json");
const DB = "rattil-zipformer-assets";
const KEYS = { model: "zipformer-a0w-ep1-a05-int8", corpus: "zipformer-quran-v03", quran: "quran-display-v02" };
let session = null;
const settledBridge=createSettledWordBridge();let settledDirty=false;
function flushSettledWords(){if(!settledDirty)return;settledDirty=false;for(const event of settledBridge.collect(session?.zipformer?.engine?.tracer?.verdicts(true)||[]))post("event",{event,wt:Date.now(),a:(audioTotal+feedingLen)/16});}
let engineConfig = null;
let queue = Promise.resolve();
let stage = "worker-start";
// Private timing diagnostics (numbers only, never audio or text). See diag.js.
const diag = createDiag(); diag.reset();
let feedingLen = 0, seenDecode = false, seenCand = false, lastWpKey = "", onsetSeen = false, hbLast = Date.now();
setInterval(() => { const n = Date.now(), late = Math.max(0, n - hbLast - 50); hbLast = n; diag.sample("loop", late); diag.bucket(n, "loop", late); }, 50);
function diagEngine(e) {
  const a = (audioTotal + feedingLen) / 16;
  if (e.type === "raw_transcript") { const chars = String(e.text || "").length; if (chars > 0 && !seenDecode) { seenDecode = true; diag.mark("ev", { type: "raw_transcript", a, chars }); } }
  else if (e.type === "verse_candidate") { if (!seenCand) { seenCand = true; diag.mark("ev", { type: "verse_candidate", a, stable: !!e.stable }); } }
  else if (e.type === "verse_match") diag.mark("ev", { type: "verse_match", a, ayah: e.ayah });
  else if (e.type === "word_progress") { const key = e.ayah + ":" + (e.matched_indices || []).length + ":" + e.word_index; if (key !== lastWpKey) { lastWpKey = key; diag.mark("ev", { type: "word_progress", a, ayah: e.ayah, matched: (e.matched_indices || []).length, idx: e.word_index }); } }
}
let sessionMode = "tracking";
// Completed-ayah rescoring: the live tracker follows recitation; when a speech
// run ends (natural pause) or the session stops, the run's audio is re-scored
// against the ayahs the tracker matched inside it, in a separate correction
// session whose posteriors give per-word GOP. Only settled words with strong
// acoustic evidence are flagged: engine doubt (wrong/unsure) AND GOP <= -5,
// or the tracker-skip omission evidence (skipped AND gopNone beats gop by
// OMISSION_MARGIN), or the repetition evidence (repGain > 0 with GOP <= -5).
// Interim live
// verdicts are never flagged (they oscillate; measured on clean takes).
// Keep in sync with isFlagged() in mistake-core.js.
const GOP_FLAG = -5;
const OMISSION_MARGIN = 1;
let scorer = null;
let scorerPromise = null;
let scorerAttempts = 0;
const SCORER_MAX_ATTEMPTS = 3;
let rescoreUnavailablePosted = false;
let ortRef = null, modelBufferRef = null, ioRef = null, corpusRef = null, quranRef = null;
let rescoreChain = Promise.resolve();
let rescoreEpoch = 0; // bumped on reset so a run still slicing from an earlier session can never post its verdicts
function queueRescore(a, b) { const e = rescoreEpoch; rescoreChain = rescoreChain.then(() => rescoreRun(a, b, e)).catch(() => {}); }
let audioChunks = [];
let audioTotal = 0;
let audioDropped = 0; // samples trimmed off the front of audioChunks; chunk offsets are absolute (audioTotal based)
const matchLog = [];
// word_progress trail, stamped with the audio offset the tracker had consumed
// when each event fired. The stop-time final pass derives the real audio
// segment of each recited ayah from this, so persisted verdict coverage does
// not depend on verse_match landing inside a VAD window (it can lag on slow
// devices). Capped; entries are tiny.
const progressLog = [];
// surah:ayah keys the live per-run rescore already posted verdicts for; the
// final pass skips them.
const postedVerdictAyahs = new Set();
const postedVerdictWords = new Map();
const flaggedWords = new Map(); // surah:ayah -> Set(engine word indices)
let vadSpeech = false, vadRunStart = 0, vadLastSpeech = 0, vadEnergy = 0, vadHopCount = 0;
const VAD_HOP = 800, VAD_GAP = 0.6 * 16000, VAD_THR = 0.01, VAD_PAD = 0.3 * 16000;
function rescoreReset() { rescoreEpoch++; audioChunks = []; audioTotal = 0; audioDropped = 0; matchLog.length = 0; progressLog.length = 0; postedVerdictAyahs.clear(); postedVerdictWords.clear(); flaggedWords.clear(); vadSpeech = false; vadRunStart = 0; vadLastSpeech = 0; vadEnergy = 0; vadHopCount = 0; scorerAttempts = 0; rescoreUnavailablePosted = false; }
function audioSlice(from, to) {
  const out = new Float32Array(Math.max(0, to - from));
  let pos = 0, base = audioDropped;
  for (const c of audioChunks) {
    const cEnd = base + c.length;
    if (cEnd > from && base < to) { const a = Math.max(from, base) - base, b = Math.min(to, cEnd) - base; out.set(c.subarray(a, b), pos); pos += b - a; }
    base = cEnd;
  }
  return out.subarray(0, pos);
}
function feedVad(chunk) {
  for (let i = 0; i + VAD_HOP <= chunk.length; i += VAD_HOP) {
    let e = 0;
    for (let j = i; j < i + VAD_HOP; j++) e += chunk[j] * chunk[j];
    const speech = Math.sqrt(e / VAD_HOP) > VAD_THR;
    const hopStart = audioTotal - chunk.length + i;
    if (speech) { if (!vadSpeech) { vadSpeech = true; vadRunStart = hopStart; } vadLastSpeech = hopStart + VAD_HOP; }
    else if (vadSpeech && hopStart - vadLastSpeech > VAD_GAP) {
      const run = [vadRunStart, vadLastSpeech];
      vadSpeech = false;
      return run;
    }
  }
  return null;
}
// Create the correction scorer once. It is built before the engine reports ready (not lazily at the first
// speech pause) so its multi-hundred-millisecond blocking init never lands inside a live recording.
async function ensureScorer() {
  if (!scorer && !scorerPromise && ortRef && scorerAttempts < SCORER_MAX_ATTEMPTS) {
    scorerAttempts++;
    diag.mark("scorer_init_start");
    scorerPromise = Promise.resolve().then(() => createRecognitionSession({
      ort: ortRef, model: () => modelBufferRef, io: () => ioRef, corpus: () => corpusRef, quran: () => quranRef,
      executionProviders: ["wasm"], structural: false, onEvent: () => {},
    })).then((s) => { diag.mark("scorer_init_end", { ok: true }); s.zipformer?.setMode("correction"); return s; }).catch((error) => { diag.mark("scorer_init_end", { ok: false }); console.warn("rescore scorer init failed", error); scorerPromise = null; return null; });
  }
  if (!scorer && scorerPromise) scorer = await scorerPromise;
  return scorer;
}
const yieldToQueue = () => new Promise((resolve) => setTimeout(resolve, 0));
const RESCORE_SLICE = 4000; // 0.25 s of audio per scorer step, so live audio is never queued behind a whole run
async function rescoreRun(runStart, runEnd, epoch) {
  if (epoch !== rescoreEpoch) return;
  await ensureScorer();
  if (epoch !== rescoreEpoch) return;
  if (!scorer) {
    if (scorerAttempts >= SCORER_MAX_ATTEMPTS && !rescoreUnavailablePosted) {
      rescoreUnavailablePosted = true;
      console.warn("rescore unavailable after", scorerAttempts, "attempts");
      post("event", { event: { type: "rescore_unavailable" } });
    }
    rescoreDone("no_scorer");
    return;
  }
  const lo = Math.max(0, runStart - VAD_PAD), hi = Math.min(audioTotal, runEnd + VAD_PAD);
  // Preserve the established match-scoped pass. A repeated ayah can produce
  // fresh word_progress without another verse_match, so use it only as fallback.
  let inRun = matchLog.filter(m => m.at >= lo && m.at <= hi);
  if(!inRun.length){
    inRun=progressLog.filter(m=>m.at>=lo&&m.at<=hi);
    if(!inRun.length){const prior=progressLog.filter(m=>m.at<=hi).at(-1);if(prior&&lo-prior.at<=2*16000)inRun=[prior];}
  }
  if (!inRun.length) { rescoreDone("no_match"); return; }
  const surah = inRun[0].surah;
  if (!inRun.every(m => m.surah === surah)) { rescoreDone("cross_surah"); return; }
  const from = Math.min(...inRun.map(m => m.ayah)), to = Math.max(...inRun.map(m => m.ayah));
  try {
    diag.mark("rescore_start", { samples: hi - lo });
    scorer.zipformer?.reset();
    scorer.zipformer?.setExpected({ surah, ayah: from, ayahEnd: to });
    const slice = audioSlice(lo, hi);
    for (let i = 0; i < slice.length; i += RESCORE_SLICE) { await scorer.feed(slice.subarray(i, Math.min(slice.length, i + RESCORE_SLICE))); await yieldToQueue(); if (epoch !== rescoreEpoch) { diag.mark("rescore_end", { aborted: true }); return; } }
    diag.mark("rescore_end");
    const vs = (scorer.zipformer?.engine?.tracer?.verdicts?.(true) || []).filter(v => v.surah === surah && v.ayah >= from && v.ayah <= to);
    const byAyah = new Map();
    for (const v of vs) {
      const gopOk = typeof v.gop === "number" && Number.isFinite(v.gop) && v.gop <= GOP_FLAG;
      const gopNone = typeof v.gopNone === "number" && Number.isFinite(v.gopNone) ? v.gopNone : null;
      const bad = gopOk && (
        v.state === "wrong" || v.state === "unsure"
        || (v.state === "skipped" && gopNone !== null && gopNone > v.gop + OMISSION_MARGIN)
        || (v.state === "ok" && typeof v.repGain === "number" && Number.isFinite(v.repGain) && v.repGain > 0)
      );
      const key = v.surah + ":" + v.ayah;
      if (!byAyah.has(key)) byAyah.set(key, { surah: v.surah, ayah: v.ayah, flagged: new Set(), clearable: new Set() });
      if (bad) byAyah.get(key).flagged.add(v.word);
      else if(v.state==='ok')byAyah.get(key).clearable.add(v.word);
    }
    for (const [key, cur] of byAyah) {
      const prev = flaggedWords.get(key) || new Set();
      const add = [...cur.flagged].filter(w => !prev.has(w));
      const cleared = [...prev].filter(w => cur.clearable.has(w));
      for(const w of prev)if(!cur.clearable.has(w))cur.flagged.add(w);
      if (add.length) post("event", { event: { type: "word_issues", surah: cur.surah, ayah: cur.ayah, words: add } });
      if (cleared.length) post("event", { event: { type: "word_issues", surah: cur.surah, ayah: cur.ayah, cleared } });
      flaggedWords.set(key, cur.flagged);
    }
    // Full per-word verdicts for the rescored range, so the app can build an
    // honest session summary (correct/wrong-kind/unsure/coverage). These never
    // change live highlighting; word_issues above owns the paint.
    if (!postVerdicts(vs)) rescoreDone("empty");
  } catch (error) { diag.mark("rescore_end", { err: true }); console.warn("rescore failed", error); rescoreDone("error"); }
}

// Persist per-word verdicts for scored verdict rows. Returns how many rows
// were posted. Never touches live highlighting.
function postVerdicts(vs) {
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
  const verdictAyahs = new Map();
  for (const v of vs) {
    const key = v.surah + ":" + v.ayah;
    if (!verdictAyahs.has(key)) verdictAyahs.set(key, { surah: v.surah, ayah: v.ayah, words: [] });
    verdictAyahs.get(key).words.push({ w: v.word, state: v.state, gop: num(v.gop), gopNone: num(v.gopNone), repGain: num(v.repGain), vowelErrors: v.vowelErrors | 0 });
  }
  for (const cur of verdictAyahs.values()) {
    const key = cur.surah + ":" + cur.ayah;
    postedVerdictAyahs.add(key);
    let set = postedVerdictWords.get(key);
    if (!set) { set = new Set(); postedVerdictWords.set(key, set); }
    for (const word of cur.words) if (Number.isFinite(word?.w)) set.add(word.w);
    post("event", { event: { type: "word_verdicts", surah: cur.surah, ayah: cur.ayah, words: cur.words } });
  }
  return verdictAyahs.size;
}

// Provenance for the saved session: why a rescore produced nothing. 'final'
// is the stop-time summary; the rest are live-run failure exits.
function rescoreDone(reason, extra = {}) { post("event", { event: { type: "rescore_done", reason, ...extra } }); }

// Stop-time persistence pass: re-score every recited ayah the live per-run
// rescore did not cover, using the audio segment bounded by the tracker's own
// progress trail (see final-pass.js). Persist-only: no word_issues paint.
// Bounded by FINAL_PASS_BUDGET_MS so saving the session never hangs; anything
// cut by the budget is reported, and those words stay honestly unreviewed.
const FINAL_PASS_BUDGET_MS = 20000;
async function finalPass(epoch) {
  if (epoch !== rescoreEpoch) return;
  const groups = planFinalPass(progressLog, { ayahs: postedVerdictAyahs, words: postedVerdictWords }, audioTotal);
  let covered = 0, words = 0, budgetSkipped = 0;
  const deadline = Date.now() + FINAL_PASS_BUDGET_MS;
  for (const g of groups) {
    if (epoch !== rescoreEpoch) return;
    if (Date.now() > deadline) { budgetSkipped++; continue; }
    const posted = await finalPassGroup(g, epoch);
    if (posted > 0) { covered += posted; }
  }
  rescoreDone("final", { planned: groups.length, coveredAyahs: covered, budgetSkipped });
}

// Score one planned group; returns the number of ayahs that got verdicts.
async function finalPassGroup(g, epoch) {
  try {
    await ensureScorer();
    if (epoch !== rescoreEpoch) return 0;
    if (!scorer) return 0;
    scorer.zipformer?.reset();
    scorer.zipformer?.setExpected({ surah: g.surah, ayah: g.from, ayahEnd: g.to });
    const slice = audioSlice(g.audioFrom, g.audioTo);
    if (!slice.length) return 0;
    diag.mark("final_pass_start", { surah: g.surah, from: g.from, to: g.to, samples: slice.length });
    for (let i = 0; i < slice.length; i += RESCORE_SLICE) { await scorer.feed(slice.subarray(i, Math.min(slice.length, i + RESCORE_SLICE))); await yieldToQueue(); if (epoch !== rescoreEpoch) { diag.mark("final_pass_end", { aborted: true }); return 0; } }
    diag.mark("final_pass_end");
    const vs = (scorer.zipformer?.engine?.tracer?.verdicts?.(true) || []).filter(v => v.surah === g.surah && v.ayah >= g.from && v.ayah <= g.to);
    return postVerdicts(vs);
  } catch (error) { diag.mark("final_pass_end", { err: true }); console.warn("final pass failed", error); return 0; }
}

function post(type, data = {}) { self.postMessage({ type, ...data }); }
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("assets")) request.result.createObjectStore("assets"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("تعذّر فتح التخزين المحلي"));
  });
}
async function get(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("assets", "readonly"), request = tx.objectStore("assets").get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function put(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("assets", "readwrite");
    tx.objectStore("assets").put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const error = tx.error; db.close(); reject(error || Error("تعذّر حفظ الملف")); };
  });
}
async function json(url, key) {
  stage = "fetch:" + url;
  const cached = await get(key).catch(() => null);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw Error("HTTP " + response.status + " أثناء تنزيل بيانات التسميع");
  const value = await response.json();
  await put(key, value).catch((error) => console.warn("ASR JSON cache write failed", error));
  return value;
}
async function model() {
  stage = "model-download-or-cache";
  return downloadModel({ url: modelUrl(), get, put,
    status: (state) => post("loading_status", { message: state === "checking" ? "فحص النموذج والأجزاء المحفوظة على الجهاز…" : state === "cached" ? "تجهيز النموذج المحفوظ، دون إعادة تنزيله…" : state === "resuming" ? "استكمال التحميل من آخر جزء محفوظ…" : "تنزيل نموذج التسميع (حوالي 66 ميغابايت)…" }),
    progress: ({ saved, total }) => post("loading", { percent: Math.floor(saved / total * 100), saved, total }),
  });
}
async function init() {
  try {
    stage = "wasm-config";
    post("loading_status", { message: "تهيئة محرك التعرّف…" });
    ort.env.wasm.numThreads = 1;
    stage = "load-assets";
    const tInit0 = performance.now();
    const [modelBuffer, corpus, quran, io] = await Promise.all([
      model(), json(corpusUrl(), KEYS.corpus), json(quranUrl(), KEYS.quran), json(ioUrl(), "zipformer-io-a0w-v1"),
    ]);
    if (navigator.storage?.persist) try { await navigator.storage.persist(); } catch { /* Storage permission is optional. */ }
    const tAssets = performance.now();
    stage = "create-session";
    post("loading_status", { message: "بدء المحرك محليًا على الجهاز…" });
    session = await createRecognitionSession({
      ort, model: () => modelBuffer, io: () => io, corpus: () => corpus, quran: () => quran,
      executionProviders: ["wasm"], ...(engineConfig ? { config: engineConfig } : {}), structural: { timing: "stop" }, onEvent: (event) => { if(["word_progress","verse_match"].includes(event?.type))settledDirty=true; if (event?.type === "verse_match") matchLog.push({ surah: Number(event.surah), ayah: Number(event.ayah), at: audioTotal }); if (event?.type === "word_progress") { const wi = Number(event.word_index); progressLog.push({ surah: Number(event.surah), ayah: Number(event.ayah), at: audioTotal, w: Number.isFinite(wi) ? Math.trunc(wi) : null }); if (progressLog.length > 4000) progressLog.shift(); } try { diagEngine(event); } catch {} post("event", { event, wt: Date.now(), a: (audioTotal + feedingLen) / 16 }); },
    });
    diag.setStatic("init", { assetsMs: Math.round(tAssets - tInit0), createSessionMs: Math.round(performance.now() - tAssets) });
    session.zipformer.correction.thresholds = { ...session.zipformer.correction.thresholds, gopFlag: -5 };
    session.zipformer?.setMode("tracking");
    ortRef = ort; modelBufferRef = modelBuffer; ioRef = io; corpusRef = corpus; quranRef = quran;
    await ensureScorer();
    post("ready");
  } catch (error) {
    console.error("Rattil ASR init failed at", stage, error);
    post("error", { message: /fetch|network|load failed/i.test(error?.message || "") ? "انقطع الاتصال. الأجزاء المحفوظة موجودة؛ اضغط استكمال وحاول مرة أخرى." : (error?.message || String(error)), stage });
  }
}
async function handle(message) {
  if (message.type === "init") { if(message.baseUrl) appBase = new URL("./", message.baseUrl); engineConfig = message.config || null; return init(); }
  if (message.type === "reset") { session?.reset(); settledBridge.reset(); settledDirty=false; rescoreReset(); diag.reset(); seenDecode = seenCand = onsetSeen = false; lastWpKey = ""; }
  if (message.type === "get_audio") { const n = audioChunks.reduce((t, c) => t + c.length, 0), pcm = new Int16Array(n); let o = 0; for (const c of audioChunks) for (let i = 0; i < c.length; i++) pcm[o++] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))); const head = new DataView(new ArrayBuffer(44)); const W = (p, t) => { for (let i = 0; i < t.length; i++) head.setUint8(p + i, t.charCodeAt(i)); }; W(0, "RIFF"); head.setUint32(4, 36 + n * 2, true); W(8, "WAVE"); W(12, "fmt "); head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true); head.setUint32(24, 16000, true); head.setUint32(28, 32000, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true); W(36, "data"); head.setUint32(40, n * 2, true); post("audio_export", { blob: n ? new Blob([head.buffer, pcm.buffer], { type: "audio/wav" }) : null }); return; }
  if (message.type === "set_expected") { session?.zipformer?.setExpected(message.passage || null); return; }
  if (message.type === "set_mode") { sessionMode = message.mode === "correction" ? "correction" : "tracking"; session?.zipformer?.setMode(sessionMode); return; }
  if (message.type === "correction_action") { session?.zipformer?.correct(message.action); return; }
  if (message.type === "audio" && session) { const began = performance.now(), nowE = Date.now(), q = nowE - (message.mt || message.sentAt || nowE); diag.sample("queue", q); diag.bucket(nowE, "queue", q); feedingLen = message.samples.length;
    if (!onsetSeen) { let e = 0; for (let i = 0; i < message.samples.length; i++) e += message.samples[i] * message.samples[i]; if (Math.sqrt(e / message.samples.length) > VAD_THR) { onsetSeen = true; diag.mark("onset", { a: audioTotal / 16 }); } }
    await session.feed(message.samples); flushSettledWords(); const feedMs = performance.now() - began; feedingLen = 0; diag.sample("feed", feedMs); diag.sample("samples", message.samples.length); diag.bucket(Date.now(), "feed", feedMs); post("perf", { ms: feedMs, samples: message.samples.length, lagMs: Date.now() - (message.sentAt || Date.now()) });
    audioTotal += message.samples.length; audioChunks.push(message.samples);
    if (audioTotal - audioDropped > 5 * 60 * 16000) { let drop = audioTotal - audioDropped - 5 * 60 * 16000; while (drop > 0 && audioChunks.length) { const c = audioChunks[0]; if (c.length <= drop) { audioChunks.shift(); drop -= c.length; audioDropped += c.length; } else { audioChunks[0] = c.subarray(drop); audioDropped += drop; drop = 0; } } }
    const closed = feedVad(message.samples);
    if (closed) queueRescore(closed[0], closed[1]); }
  if (message.type === "stop" && session) { await session.stop(); settledDirty=true; flushSettledWords();
    if (vadSpeech) { vadSpeech = false; queueRescore(vadRunStart, vadLastSpeech); }
    { const e = rescoreEpoch; rescoreChain = rescoreChain.then(() => finalPass(e)).catch(() => {}); }
    await rescoreChain;
    // Honesty at save time: the tracker did recite something this session but
    // no acoustic scoring could run at all (scorer never initialised, short
    // of the live retry cap) — the record must say unavailable, not nothing.
    if (!postedVerdictAyahs.size && progressLog.length && !scorer && !rescoreUnavailablePosted) {
      rescoreUnavailablePosted = true;
      post("event", { event: { type: "rescore_unavailable" } });
    }
    post("diag", { log: diag.snapshot() });
    post("stopped"); }
}
self.onmessage = (event) => {
  queue = queue.then(() => handle(event.data || {})).catch((error) => post("error", { message: error?.message || String(error), stage: "message-handler" }));
};
