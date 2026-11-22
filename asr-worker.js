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
// acoustic evidence (wrong/unsure AND GOP <= -5) are flagged. Interim live
// verdicts are never flagged (they oscillate; measured on clean takes).
const GOP_FLAG = -5;
let scorer = null;
let scorerPromise = null;
let scorerAttempts = 0;
const SCORER_MAX_ATTEMPTS = 3;
let rescoreUnavailablePosted = false;
let ortRef = null, modelBufferRef = null, ioRef = null, corpusRef = null, quranRef = null;
let rescoreChain = Promise.resolve();
function queueRescore(a, b) { rescoreChain = rescoreChain.then(() => rescoreRun(a, b)).catch(() => {}); }
let audioChunks = [];
let audioTotal = 0;
const matchLog = [];
const flaggedWords = new Map(); // surah:ayah -> Set(engine word indices)
let vadSpeech = false, vadRunStart = 0, vadLastSpeech = 0, vadEnergy = 0, vadHopCount = 0;
const VAD_HOP = 800, VAD_GAP = 0.6 * 16000, VAD_THR = 0.01, VAD_PAD = 0.3 * 16000;
function rescoreReset() { audioChunks = []; audioTotal = 0; matchLog.length = 0; flaggedWords.clear(); vadSpeech = false; vadRunStart = 0; vadLastSpeech = 0; vadEnergy = 0; vadHopCount = 0; scorerAttempts = 0; rescoreUnavailablePosted = false; }
function audioSlice(from, to) {
  const out = new Float32Array(Math.max(0, to - from));
  let pos = 0, base = 0;
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
async function rescoreRun(runStart, runEnd) {
  if (!scorer && !scorerPromise && ortRef && scorerAttempts < SCORER_MAX_ATTEMPTS) {
    scorerAttempts++;
    diag.mark("scorer_init_start");
    scorerPromise = createRecognitionSession({
      ort: ortRef, model: () => modelBufferRef, io: () => ioRef, corpus: () => corpusRef, quran: () => quranRef,
      executionProviders: ["wasm"], structural: false, onEvent: () => {},
    }).then((s) => { diag.mark("scorer_init_end", { ok: true }); s.zipformer?.setMode("correction"); return s; }).catch((error) => { diag.mark("scorer_init_end", { ok: false }); console.warn("rescore scorer init failed", error); scorerPromise = null; return null; });
  }
  if (!scorer && scorerPromise) scorer = await scorerPromise;
  if (!scorer) {
    if (scorerAttempts >= SCORER_MAX_ATTEMPTS && !rescoreUnavailablePosted) {
      rescoreUnavailablePosted = true;
      console.warn("rescore unavailable after", scorerAttempts, "attempts");
      post("event", { event: { type: "rescore_unavailable" } });
    }
    return;
  }
  const lo = Math.max(0, runStart - VAD_PAD), hi = Math.min(audioTotal, runEnd + VAD_PAD);
  const inRun = matchLog.filter(m => m.at >= lo && m.at <= hi);
  if (!inRun.length) return;
  const surah = inRun[0].surah, from = inRun[0].ayah, to = inRun[inRun.length - 1].ayah;
  if (!inRun.every(m => m.surah === surah)) return;
  try {
    diag.mark("rescore_start", { samples: hi - lo });
    scorer.zipformer?.reset();
    scorer.zipformer?.setExpected({ surah, ayah: from, ayahEnd: to });
    await scorer.feed(audioSlice(lo, hi));
    diag.mark("rescore_end");
    const vs = (scorer.zipformer?.engine?.tracer?.verdicts?.(true) || []).filter(v => v.surah === surah && v.ayah >= from && v.ayah <= to);
    const byAyah = new Map();
    for (const v of vs) {
      const bad = (v.state === "wrong" || v.state === "unsure") && typeof v.gop === "number" && Number.isFinite(v.gop) && v.gop <= GOP_FLAG;
      const key = v.surah + ":" + v.ayah;
      if (!byAyah.has(key)) byAyah.set(key, { surah: v.surah, ayah: v.ayah, flagged: new Set() });
      if (bad) byAyah.get(key).flagged.add(v.word);
    }
    for (const [key, cur] of byAyah) {
      const prev = flaggedWords.get(key) || new Set();
      const add = [...cur.flagged].filter(w => !prev.has(w));
      const cleared = [...prev].filter(w => !cur.flagged.has(w));
      if (add.length) post("event", { event: { type: "word_issues", surah: cur.surah, ayah: cur.ayah, words: add } });
      if (cleared.length) post("event", { event: { type: "word_issues", surah: cur.surah, ayah: cur.ayah, cleared } });
      flaggedWords.set(key, cur.flagged);
    }
  } catch (error) { diag.mark("rescore_end", { err: true }); console.warn("rescore failed", error); }
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
      executionProviders: ["wasm"], ...(engineConfig ? { config: engineConfig } : {}), structural: { timing: "stop" }, onEvent: (event) => { if (event?.type === "verse_match") matchLog.push({ surah: Number(event.surah), ayah: Number(event.ayah), at: audioTotal }); try { diagEngine(event); } catch {} post("event", { event, wt: Date.now(), a: (audioTotal + feedingLen) / 16 }); },
    });
    diag.setStatic("init", { assetsMs: Math.round(tAssets - tInit0), createSessionMs: Math.round(performance.now() - tAssets) });
    session.zipformer.correction.thresholds = { ...session.zipformer.correction.thresholds, gopFlag: -5 };
    session.zipformer?.setMode("tracking");
    ortRef = ort; modelBufferRef = modelBuffer; ioRef = io; corpusRef = corpus; quranRef = quran;
    post("ready");
  } catch (error) {
    console.error("Rattil ASR init failed at", stage, error);
    post("error", { message: /fetch|network|load failed/i.test(error?.message || "") ? "انقطع الاتصال. الأجزاء المحفوظة موجودة؛ اضغط استكمال وحاول مرة أخرى." : (error?.message || String(error)), stage });
  }
}
async function handle(message) {
  if (message.type === "init") { if(message.baseUrl) appBase = new URL("./", message.baseUrl); engineConfig = message.config || null; return init(); }
  if (message.type === "reset") { session?.reset(); rescoreReset(); diag.reset(); seenDecode = seenCand = onsetSeen = false; lastWpKey = ""; }
  if (message.type === "set_expected") { session?.zipformer?.setExpected(message.passage || null); return; }
  if (message.type === "set_mode") { sessionMode = message.mode === "correction" ? "correction" : "tracking"; session?.zipformer?.setMode(sessionMode); return; }
  if (message.type === "correction_action") { session?.zipformer?.correct(message.action); return; }
  if (message.type === "audio" && session) { const began = performance.now(), nowE = Date.now(), q = nowE - (message.mt || message.sentAt || nowE); diag.sample("queue", q); diag.bucket(nowE, "queue", q); feedingLen = message.samples.length;
    if (!onsetSeen) { let e = 0; for (let i = 0; i < message.samples.length; i++) e += message.samples[i] * message.samples[i]; if (Math.sqrt(e / message.samples.length) > VAD_THR) { onsetSeen = true; diag.mark("onset", { a: audioTotal / 16 }); } }
    await session.feed(message.samples); const feedMs = performance.now() - began; feedingLen = 0; diag.sample("feed", feedMs); diag.sample("samples", message.samples.length); diag.bucket(Date.now(), "feed", feedMs); post("perf", { ms: feedMs, samples: message.samples.length, lagMs: Date.now() - (message.sentAt || Date.now()) });
    audioTotal += message.samples.length; audioChunks.push(message.samples);
    if (audioTotal > 5 * 60 * 16000) { let drop = audioTotal - 5 * 60 * 16000; while (drop > 0 && audioChunks.length) { const c = audioChunks[0]; if (c.length <= drop) { audioChunks.shift(); drop -= c.length; } else { audioChunks[0] = c.subarray(drop); drop = 0; } } }
    const closed = feedVad(message.samples);
    if (closed) queueRescore(closed[0], closed[1]); }
  if (message.type === "stop" && session) { await session.stop();
    if (vadSpeech) { vadSpeech = false; queueRescore(vadRunStart, vadLastSpeech); }
    await rescoreChain;
    post("diag", { log: diag.snapshot() });
    post("stopped"); }
}
self.onmessage = (event) => {
  queue = queue.then(() => handle(event.data || {})).catch((error) => post("error", { message: error?.message || String(error), stage: "message-handler" }));
};
