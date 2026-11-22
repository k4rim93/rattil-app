import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPending } from '../pending-progress.js';
const m = (a, s = 55) => ({ message: { surah: s, ayah: a }, at: 1000 });
test('matching entries replay, other ayat stay buffered', () => {
  const r = splitPending([m(2), m(3)], 55, 1, 2000);
  assert.equal(r.early.length, 0); assert.equal(r.rest.length, 2);
  const r2 = splitPending(r.rest, 55, 2, 2100);
  assert.equal(r2.early.length, 1); assert.equal(r2.early[0].message.ayah, 2); assert.equal(r2.rest.length, 1);
});
test('out-of-order: later ayah matched first keeps earlier-ayah entries until stale', () => {
  const r = splitPending([m(2), m(3)], 55, 3, 2000);
  assert.equal(r.early[0].message.ayah, 3); assert.equal(r.rest[0].message.ayah, 2);
});
test('stale entries (>=5s) are dropped, never replayed', () => {
  const r = splitPending([m(2)], 55, 2, 6000);
  assert.equal(r.early.length, 0); assert.equal(r.rest.length, 0);
});
test('other surah never replays into this ayah', () => {
  const r = splitPending([m(1, 1)], 55, 1, 1500);
  assert.equal(r.early.length, 0); assert.equal(r.rest.length, 1);
});
test('empty/undefined and malformed input are safe; cap bounds the buffer', () => {
  assert.deepEqual(splitPending(undefined, 55, 1, 0), { early: [], rest: [] });
  assert.equal(splitPending([null, {}], 55, 1, 0).rest.length, 0);
  const many = Array.from({ length: 50 }, (_, i) => m(i + 5));
  assert.equal(splitPending(many, 55, 1, 1500).rest.length, 30);
});
test('rewind: entries for earlier ayah replay on its own match', () => {
  const r = splitPending([m(4)], 55, 5, 1500);
  assert.equal(splitPending(r.rest, 55, 4, 1600).early.length, 1);
});
