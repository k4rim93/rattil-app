import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiag, buildDiagReport, renderDiagLines, pct } from '../diag.js';

function fake({holdMs = 0}={}) {
  const t0 = 1_000_000;
  const main = createDiag(); main.reset(t0);
  main.mark('ctx', { sampleRate: 48000, baseLatency: 0.01, state: 'running', ua: 'test' }, t0);
  main.mark('chunk_first', { at: t0 }, t0 + 5);
  for (let i = 0; i < 100; i++) { main.sample('gap', 50); main.sample('deliver', 1); main.sample('loop', 0); main.bucket(t0 + i * 50, 'lvl', 0.05); }
  const worker = createDiag(); worker.reset(t0);
  for (let i = 0; i < 100; i++) { const q = i > 40 && i < 60 ? holdMs : 1; worker.sample('queue', q); worker.bucket(t0 + i * 50, 'queue', q); worker.sample('feed', 3); worker.sample('samples', 800); worker.sample('loop', 0); worker.bucket(t0 + i * 50, 'loop', 0); }
  worker.mark('onset', { a: 100 }, t0 + 100);
  worker.mark('ev', { type: 'raw_transcript', a: 700, chars: 12 }, t0 + 750);
  worker.mark('ev', { type: 'verse_match', a: 3500, ayah: 5 }, t0 + 4200);
  worker.mark('ev', { type: 'word_progress', a: 3500, ayah: 5, matched: 1 }, t0 + 4200);
  worker.mark('scorer_init_start', {}, t0 + 2000); worker.mark('scorer_init_end', { ok: true }, t0 + 3500);
  return { main: main.snapshot(), worker: worker.snapshot() };
}

test('report separates queue wait from capture and computes backlog', () => {
  const { main, worker } = fake({ holdMs: 3000 });
  const r = buildDiagReport(main, worker);
  assert.equal(r.worker.queueMs.max, 3000);
  assert.equal(r.capture.deliveryMs.max, 1);
  assert.equal(r.capture.chunkGapMs.max, 50);
  assert.equal(r.page.loopLagMs.max, 0);
  assert.equal(r.phases.locked.audioMs, 3500);
  assert.equal(r.phases.locked.backlogMs, 4195 - 3500);
  assert.equal(r.scorer.length, 1);
  assert.equal(r.scorer[0].durMs, 1500);
  assert.equal(r.device.sampleRate, 48000);
});

test('report copes with missing worker log and renders lines', () => {
  const { main } = fake();
  const r = buildDiagReport(main, null);
  assert.equal(r.phases.locked, null);
  assert.ok(renderDiagLines(r).length > 5);
});

test('log is bounded and keeps its first entry', () => {
  const d = createDiag(); d.reset(0);
  for (let i = 0; i < 5000; i++) { d.mark('x', { i }, i); d.sample('s', i); d.bucket(i * 1000, 'b', 1, 'sum'); }
  const s = d.snapshot();
  assert.ok(s.events.length <= 700); assert.equal(s.events[0].i, 0);
  assert.ok(s.samples.s.length <= 6000); assert.ok(s.buckets.length <= 1800);
});

test('report carries numbers only: no text or audio fields', () => {
  const { main, worker } = fake();
  const json = JSON.stringify(buildDiagReport(main, worker));
  assert.ok(!/"text"|samples":\[|transcript/.test(json));
});

test('bookkeeping overhead per chunk is far below the 50 ms chunk period', () => {
  const d = createDiag(); d.reset(0);
  const n = 20000, t = process.hrtime.bigint();
  for (let i = 0; i < n; i++) { d.sample('gap', 50); d.sample('deliver', 1); d.bucket(i * 50, 'deliver', 1); d.sample('queue', 1); d.bucket(i * 50, 'queue', 1); d.sample('feed', 3); d.bucket(i * 50, 'feed', 3); }
  const perChunkUs = Number(process.hrtime.bigint() - t) / 1000 / n;
  console.log('overhead per chunk (us):', perChunkUs.toFixed(2));
  assert.ok(perChunkUs < 100);
  assert.equal(pct([1, 2, 3, 4], .5), 3);
});

test('report includes final-pass windows and saved-session counters', () => {
  const { main, worker } = fake();
  worker.events.push({ k: 'final_pass_start', t: 1006000, surah: 19, from: 5, to: 7, samples: 32000 });
  worker.events.push({ k: 'final_pass_end', t: 1006800 });
  const saved = {
    unavailable: false,
    stats: { fails: { empty: 2 }, final: { planned: 3, coveredAyahs: 2, budgetSkipped: 1 } },
    unreviewed: 6,
    unreviewedWords: ['19:5:3', '19:5:4', '19:6:0', '19:6:1', '19:7:10', '19:7:11'],
  };
  const r = buildDiagReport(main, worker, saved);
  const fp = r.scorer.find(w => w.kind === 'final_pass');
  assert.ok(fp, 'final-pass window present');
  assert.equal(fp.durMs, 800);
  assert.equal(fp.audioSec, 2);
  assert.deepEqual(r.savedSession, saved);
  const lines = renderDiagLines(r).join('\n');
  assert.match(lines, /الفحص الختامي المحفوظ/);
  assert.match(lines, /تجاوز الميزانية 1/);
});

test('exported JSON stays numeric/ASCII: no recited text, no audio, no Arabic', () => {
  const { main, worker } = fake();
  worker.events.push({ k: 'ev', type: 'raw_transcript', a: 900, chars: 25, t: 1000900 });
  const saved = { unavailable: false, stats: { fails: {}, final: { planned: 1, coveredAyahs: 1, budgetSkipped: 0 } }, unreviewed: 2, unreviewedWords: ['19:5:3', '19:6:0'] };
  const json = JSON.stringify(buildDiagReport(main, worker, saved));
  assert.ok(!/[؀-ۿ]/.test(json), 'no Arabic text in the export');
  assert.ok(!json.includes('samples":['), 'no raw audio sample arrays');
});
