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
