import test from 'node:test';
import assert from 'node:assert/strict';
import { planFinalPass } from '../final-pass.js';

const S = 16000; // samples per second

test('no progress trail means no plan: recitation is never inferred', () => {
  assert.deepEqual(planFinalPass([], new Set(), 60 * S), []);
  assert.deepEqual(planFinalPass(null, new Set(), 60 * S), []);
  assert.deepEqual(planFinalPass([{ surah: 55, ayah: 1, at: 8000 }], new Set(), 0), []);
});

test('single ayah segment is bounded by its own progress times plus pads', () => {
  const log = [{ surah: 55, ayah: 3, at: 10 * S }, { surah: 55, ayah: 3, at: 20 * S }];
  const [g] = planFinalPass(log, new Set(), 60 * S);
  assert.equal(g.surah, 55); assert.equal(g.from, 3); assert.equal(g.to, 3);
  assert.equal(g.audioFrom, 10 * S - 0.8 * S);
  assert.equal(g.audioTo, 20 * S + 0.6 * S);
});

test('segment start and end clamp to the recorded audio', () => {
  const log = [{ surah: 55, ayah: 1, at: 100 }, { surah: 55, ayah: 1, at: 59.9 * S }];
  const [g] = planFinalPass(log, new Set(), 60 * S);
  assert.equal(g.audioFrom, 0);
  assert.equal(g.audioTo, 60 * S);
});

test('contiguous same-surah ayahs join into one group; jumps stay separate', () => {
  const log = [
    { surah: 55, ayah: 1, at: 5 * S }, { surah: 55, ayah: 2, at: 12 * S }, { surah: 55, ayah: 3, at: 18 * S },
    { surah: 55, ayah: 7, at: 30 * S },
  ];
  const groups = planFinalPass(log, new Set(), 90 * S);
  assert.equal(groups.length, 2);
  assert.deepEqual([groups[0].from, groups[0].to], [1, 3]);
  assert.deepEqual([groups[1].from, groups[1].to], [7, 7]);
});

test('different surahs never join', () => {
  const log = [{ surah: 55, ayah: 1, at: 5 * S }, { surah: 56, ayah: 1, at: 10 * S }];
  assert.equal(planFinalPass(log, new Set(), 60 * S).length, 2);
});

test('a long silence splits ayahs into separate groups', () => {
  const log = [{ surah: 55, ayah: 1, at: 5 * S }, { surah: 55, ayah: 2, at: 30 * S }];
  assert.equal(planFinalPass(log, new Set(), 90 * S).length, 2);
});

test('ayahs already covered by the live rescore are skipped', () => {
  const log = [{ surah: 55, ayah: 1, at: 5 * S }, { surah: 55, ayah: 2, at: 12 * S }];
  const groups = planFinalPass(log, new Set(['55:1']), 60 * S);
  assert.equal(groups.length, 1);
  assert.deepEqual([groups[0].from, groups[0].to], [2, 2]);
});

test('a re-recited ayah keeps only its latest stretch', () => {
  const log = [
    { surah: 55, ayah: 3, at: 5 * S }, { surah: 55, ayah: 4, at: 12 * S },
    { surah: 55, ayah: 3, at: 40 * S }, { surah: 55, ayah: 3, at: 46 * S },
  ];
  const groups = planFinalPass(log, new Set(), 90 * S);
  const ayah3 = groups.filter(g => g.from <= 3 && g.to >= 3);
  assert.equal(ayah3.length, 1);
  assert.equal(ayah3[0].audioFrom, 40 * S - 0.8 * S);
  assert.equal(ayah3[0].audioTo, 46 * S + 0.6 * S);
});

test('malformed entries are ignored', () => {
  const log = [{ surah: 'x', ayah: 1, at: 5 }, { ayah: 1, at: 5 }, { surah: 55, ayah: 1, at: NaN }, { surah: 55, ayah: 2, at: 8 * S }];
  const groups = planFinalPass(log, new Set(), 60 * S);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].ayah ?? groups[0].from, 2);
});
