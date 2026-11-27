// Stop-time persistence pass: the fresh-session zero-verdict failure.
// The live per-run rescore only covers VAD windows containing a verse_match
// emission; on a slow device that match can arrive late and nothing persists.
// These tests drive the real asr-worker source in a vm harness with a mock
// scorer. Instant summary: 'stopped' posts first so the app can save and show
// the session; the stop drain then lands verdicts BEFORE 'final_check_done'.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createSettledWordBridge } from '../settled-words.js';
import { planFinalPass } from '../final-pass.js';
const source = readFileSync(new URL('../asr-worker.js', import.meta.url), 'utf8');
function harness(factory, verdictList) {
  const events = [];
  const c = vm.createContext({ createSettledWordBridge, planFinalPass, console: { warn() {} }, Date, Float32Array, Map, Set, Promise, Number, Math, URL, setTimeout, setInterval() {}, navigator: {}, self: { postMessage: e => events.push(e) }, createRecognitionSession: factory, createDiag: () => ({ reset() {}, mark() {}, sample() {}, bucket() {}, snapshot() { return {} } }) });
  let src = source.replace(/^import .*;\r?\n/gm, '').replace('let appBase = new URL(/* @vite-ignore */ "../", import.meta.url);', 'let appBase=new URL("https://test.invalid/");');
  vm.runInContext(src + `;globalThis.api={rescoreReset,queueRescore,handle,setup(){ortRef={};modelBufferRef={};ioRef={};corpusRef={};quranRef={};session={reset(){},stop:async()=>{}}},seed(dropped){audioTotal=16000;audioChunks=[new Float32Array(16000)];audioDropped=dropped||0;matchLog.push({surah:55,ayah:3,at:8000})},seedProgress(list){for(const p of list)progressLog.push(p)},chain:()=>rescoreChain};`, c);
  c.api.setup(); return { a: c.api, events };
}
const VERDICTS = [
  { surah: 55, ayah: 3, word: 0, state: 'ok', gop: -0.3, gopNone: -40, repGain: -1, vowelErrors: 0 },
  { surah: 55, ayah: 3, word: 1, state: 'wrong', gop: -9.2, gopNone: -1.1, repGain: -0.5, vowelErrors: 0 },
  { surah: 55, ayah: 3, word: 2, state: 'unsure', gop: -1.2, gopNone: -30, repGain: 0, vowelErrors: 1 },
];
function scorer(feed = async () => {}, list = VERDICTS) {
  return { feed, zipformer: { setMode() {}, reset() {}, setExpected() {}, engine: { tracer: { verdicts: () => list } } } };
}

test('late verse_match (outside every VAD window): stop drain still persists verdicts', async () => {
  const { a, events } = harness(async () => scorer());
  a.seed(); // audio exists, one match — but no VAD run ever closes, vadSpeech false
  a.seedProgress([{ surah: 55, ayah: 3, at: 4000 }, { surah: 55, ayah: 3, at: 8000 }]);
  await a.handle({ type: 'stop' });
  const verdictIdx = events.findIndex(x => x.event?.type === 'word_verdicts');
  assert.ok(verdictIdx >= 0, 'final pass must post verdicts');
  assert.ok(events.findIndex(x => x.type === 'stopped') < verdictIdx, 'stopped posts first so the summary opens instantly');
  assert.ok(verdictIdx < events.findIndex(x => x.type === 'final_check_done'), 'verdicts land before final_check_done');
  const final = events.find(x => x.event?.type === 'rescore_done' && x.event.reason === 'final')?.event;
  assert.equal(final.planned, 1);
  assert.equal(final.coveredAyahs, 1);
});

test('final pass is persist-only: it never paints word_issues', async () => {
  const { a, events } = harness(async () => scorer());
  a.seed();
  a.seedProgress([{ surah: 55, ayah: 3, at: 4000 }]);
  await a.handle({ type: 'stop' });
  assert.equal(events.filter(x => x.event?.type === 'word_issues').length, 0);
  assert.equal(events.filter(x => x.event?.type === 'word_verdicts').length, 1);
});

test('scorer down, short session, tracker DID recite: stop posts rescore_unavailable before final_check_done', async () => {
  const { a, events } = harness(() => { throw Error('init failure'); });
  a.seed();
  a.seedProgress([{ surah: 55, ayah: 3, at: 4000 }]);
  await a.handle({ type: 'stop' });
  const unavail = events.findIndex(x => x.event?.type === 'rescore_unavailable');
  assert.ok(unavail >= 0, 'unavailable must be posted even below the live retry cap');
  assert.ok(unavail < events.findIndex(x => x.type === 'final_check_done'));
  assert.equal(events.filter(x => x.event?.type === 'word_verdicts').length, 0);
});

test('reset clears the progress trail and covered-ayah marks: nothing stale persists', async () => {
  const { a, events } = harness(async () => scorer());
  a.seed();
  a.seedProgress([{ surah: 55, ayah: 3, at: 4000 }]);
  a.rescoreReset();
  await a.handle({ type: 'stop' });
  assert.equal(events.filter(x => x.event?.type === 'word_verdicts').length, 0);
  assert.equal(events.filter(x => x.event?.type === 'rescore_unavailable').length, 0);
});

test('ayahs already covered by the live rescore are not re-scored at stop', async () => {
  let feeds = 0;
  const { a, events } = harness(async () => scorer(async () => { feeds++; }));
  a.seed();
  a.queueRescore(0, 16000); // live run covers 55:3
  await a.chain();
  const afterLive = feeds;
  a.seedProgress([{ surah: 55, ayah: 3, at: 4000 }]); // same ayah in the trail
  await a.handle({ type: 'stop' });
  assert.equal(feeds, afterLive, 'no extra scoring feed for a covered ayah');
  const final = events.find(x => x.event?.type === 'rescore_done' && x.event.reason === 'final')?.event;
  assert.equal(final.planned, 0);
  assert.equal(events.filter(x => x.event?.type === 'word_verdicts').length, 1);
});

test('empty scorer output on the final pass posts nothing but reports the plan', async () => {
  const { a, events } = harness(async () => scorer(async () => {}, []));
  a.seed();
  a.seedProgress([{ surah: 55, ayah: 3, at: 4000 }]);
  await a.handle({ type: 'stop' });
  assert.equal(events.filter(x => x.event?.type === 'word_verdicts').length, 0);
  const final = events.find(x => x.event?.type === 'rescore_done' && x.event.reason === 'final')?.event;
  assert.equal(final.planned, 1);
  assert.equal(final.coveredAyahs, 0);
});

test('partial verdicts that never grow: pass retries once, then reports the ayah uncheckable (no_alignment)', async () => {
  const partial = [{ surah: 55, ayah: 3, word: 0, state: 'ok', gop: -0.3, gopNone: -40, repGain: -1, vowelErrors: 0 }];
  const { a, events } = harness(async () => scorer(async () => {}, partial));
  a.seed();
  a.seedProgress([{ surah: 55, ayah: 3, at: 4000, w: 0 }, { surah: 55, ayah: 3, at: 8000, w: 2 }]);
  await a.handle({ type: 'stop' });
  const rounds = events.filter(x => x.event?.type === 'rescore_done' && x.event.reason === 'final');
  assert.equal(rounds.length, 2, 'one productive round plus one no-progress round, then the loop stops');
  const uncheck = events.find(x => x.event?.type === 'final_check_uncheckable')?.event;
  assert.ok(uncheck, 'uncheckable must be reported once the pass gives up');
  assert.deepEqual(JSON.parse(JSON.stringify(uncheck.items)), [{ reason: 'no_alignment', ayahs: [{ surah: 55, ayah: 3 }] }]);
});

test('audio already trimmed from the ring buffer: ayah reported audio_expired, scorer never fed', async () => {
  let feeds = 0;
  const { a, events } = harness(async () => scorer(async () => { feeds++; }));
  a.seed(16000); // the whole first second of audio is already gone
  a.seedProgress([{ surah: 55, ayah: 3, at: 4000, w: 0 }]);
  await a.handle({ type: 'stop' });
  assert.equal(feeds, 0, 'no scoring feed without audio');
  const uncheck = events.find(x => x.event?.type === 'final_check_uncheckable')?.event;
  assert.deepEqual(JSON.parse(JSON.stringify(uncheck.items)), [{ reason: 'audio_expired', ayahs: [{ surah: 55, ayah: 3 }] }]);
  const final = events.find(x => x.event?.type === 'rescore_done' && x.event.reason === 'final')?.event;
  assert.equal(final.planned, 1);
  assert.equal(final.coveredAyahs, 0);
});

test('no progress trail at stop: no plan, no verdicts, no unavailable flag', async () => {
  const { a, events } = harness(async () => scorer());
  a.seed();
  await a.handle({ type: 'stop' });
  assert.equal(events.filter(x => x.event?.type === 'word_verdicts').length, 0);
  assert.equal(events.filter(x => x.event?.type === 'rescore_unavailable').length, 0);
  const final = events.find(x => x.event?.type === 'rescore_done' && x.event.reason === 'final')?.event;
  assert.equal(final.planned, 0);
});
