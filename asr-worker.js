import { downloadModel } from "./model-download.js";
import * as ort from "onnxruntime-web/wasm";
import { createRecognitionSession } from "@tilawa/core";

let appBase = new URL(/* @vite-ignore */ "../", import.meta.url);
const asset = (path) => new URL(path, appBase).href;
const modelUrl = () => asset("models/zipformer_a0w_ep1_a05.int8.onnx");
const ioUrl = () => asset("models/zipformer_a0w_ep1_a05.io.json");
const corpusUrl = () => asset("zipformer_quran.json");
const quranUrl = () => asset("quran.json");
const DB = "rattil-zipformer-assets";
const KEYS = { model: "zipformer-a0w-ep1-a05-int8", corpus: "zipformer-quran-v03", quran: "quran-display-v02" };
let session = null;
let queue = Promise.resolve();
let stage = "worker-start";

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
    const [modelBuffer, corpus, quran, io] = await Promise.all([
      model(), json(corpusUrl(), KEYS.corpus), json(quranUrl(), KEYS.quran), json(ioUrl(), "zipformer-io-a0w-v1"),
    ]);
    if (navigator.storage?.persist) try { await navigator.storage.persist(); } catch { /* Storage permission is optional. */ }
    stage = "create-session";
    post("loading_status", { message: "بدء المحرك محليًا على الجهاز…" });
    session = await createRecognitionSession({
      ort, model: () => modelBuffer, io: () => io, corpus: () => corpus, quran: () => quran,
      executionProviders: ["wasm"], structural: { timing: "stop" }, onEvent: (event) => post("event", { event }),
    });
    session.zipformer?.setMode("tracking");
    post("ready");
  } catch (error) {
    console.error("Rattil ASR init failed at", stage, error);
    post("error", { message: /fetch|network|load failed/i.test(error?.message || "") ? "انقطع الاتصال. الأجزاء المحفوظة موجودة؛ اضغط استكمال وحاول مرة أخرى." : (error?.message || String(error)), stage });
  }
}
async function handle(message) {
  if (message.type === "init") { if(message.baseUrl) appBase = new URL("./", message.baseUrl); return init(); }
  if (message.type === "reset") session?.reset();
  if (message.type === "set_expected") { session?.zipformer?.setExpected(message.passage || null); return; }
  if (message.type === "set_mode") { session?.zipformer?.setMode(message.mode === "correction" ? "correction" : "tracking"); return; }
  if (message.type === "correction_action") { session?.zipformer?.correct(message.action); return; }
  if (message.type === "audio" && session) await session.feed(message.samples);
  if (message.type === "stop" && session) { await session.stop(); post("stopped"); }
}
self.onmessage = (event) => {
  queue = queue.then(() => handle(event.data || {})).catch((error) => post("error", { message: error?.message || String(error), stage: "message-handler" }));
};
