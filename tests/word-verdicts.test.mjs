import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createSettledWordBridge } from '../settled-words.js';
const source = readFileSync(new URL('../asr-worker.js', import.meta.url), 'utf8');
function harness(factory, verdictList) {
  const events = [];
  const c = vm.createContext({ createSettledWordBridge, console: { warn() {} }, Date, Float32Array, Map, Set, Promise, Number, Math, URL, setTimeout, setInterval() {}, navigator: {}, self: { postMessage: e => events.push(e) }, createRecognitionSession: factory, createDiag: () => ({ reset() {}, mark() {}, sample() {}, bucket() {}, snapshot() { return {} } }) });
  let src = source.replace(/^import .*;\r?\n/gm, '').replace('let appBase = new URL(/* @vite-ignore */ "../", import.meta.url);', 'let appBase=new URL("https://test.invalid/");');
  vm.runInContext(src + `;globalThis.api={rescoreReset,queueRescore,handle,setup(){ortRef={};modelBufferRef={};ioRef={};corpusRef={};quranRef={};session={reset(){},stop:async()=>{}}},seed(){audioTotal=16000;audioChunks=[new Float32Array(16000)];matchLog.push({surah:55,ayah:3,at:8000})},chain:()=>rescoreChain};`, c);
  c.api.setup(); return { a: c.api, events };
}
const VERDICTS = [
  { surah: 55, ayah: 3, word: 0, state: 'ok', gop: -0.3, gopNone: -40, repGain: -1, vowelErrors: 0 },
  { surah: 55, ayah: 3, word: 1, state: 'wrong', gop: -9.2, gopNone: -1.1, repGain: -0.5, vowelErrors: 0 },
  { surah: 55, ayah: 3, word: 2, state: 'unsure', gop: -1.2, gopNone: -30, repGain: 0, vowelErrors: 1 },
];
function scorer() {
  return { feed: async () => {}, zipformer: { setMode() {}, reset() {}, setExpected() {}, engine: { tracer: { verdicts: () => VERDICTS } } } };
}
test('rescore posts full per-word verdicts alongside the red flags', async () => {
  const { a, events } = harness(async () => scorer());
  a.seed(); a.queueRescore(0, 16000); await a.chain();
  const posted = events.filter(x => x.event?.type === 'word_verdicts');
  assert.equal(posted.length, 1);
  const msg = posted[0].event;
  assert.equal(msg.surah, 55); assert.equal(msg.ayah, 3);
  assert.equal(msg.words.length, 3);
  assert.deepEqual({ ...msg.words[0] }, { w: 0, state: 'ok', gop: -0.3, gopNone: -40, repGain: -1, vowelErrors: 0 });
  assert.deepEqual({ ...msg.words[1] }, { w: 1, state: 'wrong', gop: -9.2, gopNone: -1.1, repGain: -0.5, vowelErrors: 0 });
  // red flag behavior unchanged: only the strongly-flagged word is painted
  const issues = events.filter(x => x.event?.type === 'word_issues');
  assert.equal(issues.length, 1);
  assert.deepEqual([...issues[0].event.words], [1]);
});
test('non-finite scores are nulled, not leaked as NaN/Infinity', async () => {
  const bad = [{ surah: 55, ayah: 3, word: 1, state: 'wrong', gop: NaN, gopNone: Infinity, repGain: undefined, vowelErrors: 0 }];
  const { a, events } = harness(async () => ({ feed: async () => {}, zipformer: { setMode() {}, reset() {}, setExpected() {}, engine: { tracer: { verdicts: () => bad } } } }));
  a.seed(); a.queueRescore(0, 16000); await a.chain();
  const msg = events.find(x => x.event?.type === 'word_verdicts')?.event;
  assert.deepEqual({ ...msg.words[0] }, { w: 1, state: 'wrong', gop: null, gopNone: null, repGain: null, vowelErrors: 0 });
  assert.equal(events.filter(x => x.event?.type === 'word_issues').length, 0);
});
test('verdict events arrive before stopped so the summary is complete', async () => {
  const { a, events } = harness(async () => scorer());
  a.seed(); a.queueRescore(0, 16000); await a.handle({ type: 'stop' });
  const verdictIdx = events.findIndex(x => x.event?.type === 'word_verdicts');
  assert.ok(verdictIdx >= 0);
  assert.ok(verdictIdx < events.findIndex(x => x.type === 'stopped'));
});
test('reset drops stale verdicts; only the new session posts', async () => {
  let unblock; let calls = 0;
  const { a, events } = harness(async () => ({ feed: async () => { if (++calls === 1) await new Promise(r => unblock = r); }, zipformer: { setMode() {}, reset() {}, setExpected() {}, engine: { tracer: { verdicts: () => VERDICTS } } } }));
  a.seed(); a.queueRescore(0, 16000);
  while (!unblock) await new Promise(r => setTimeout(r, 1));
  a.rescoreReset(); unblock(); await a.chain();
  assert.equal(events.filter(x => x.event?.type === 'word_verdicts').length, 0);
  a.seed(); a.queueRescore(0, 16000); await a.chain();
  assert.equal(events.filter(x => x.event?.type === 'word_verdicts').length, 1);
});
