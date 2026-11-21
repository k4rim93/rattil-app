import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadModel, MODEL_BYTES, BLOCK_BYTES, MODEL_KEY, PART_PREFIX } from '../model-download.js';
function harness() {
  const data = new Map();
  return { data, get: async key => data.get(key), put: async (key, value) => data.set(key, value.slice(0)) };
}
function response(url, { incomplete = false } = {}) {
  const index = Number(/\/(\d+)\.bin$/.exec(url)[1]);
  const size = Math.min(BLOCK_BYTES, MODEL_BYTES - index * BLOCK_BYTES);
  // Deliberately wrong Content-Length models gzip: decoded bytes are what count.
  return new Response(new Uint8Array(size - (incomplete ? 1 : 0)).fill(index), { headers: { 'content-length': Math.floor(size * .8) } });
}
test('interrupted transfer keeps committed blocks; fresh instance requests only missing blocks', async () => {
  const h = harness(), progress = [];
  await assert.rejects(downloadModel({ ...h, url: 'model', progress: p => progress.push(p.saved), fetcher: async url => { if (url.endsWith('/3.bin')) throw Error('closed'); return response(url); } }));
  assert.equal(h.data.size, 3); assert.equal(progress.at(-1), 3 * BLOCK_BYTES);
  const requests = [];
  const output = await downloadModel({ ...h, url: 'model', fetcher: async url => { requests.push(url); return response(url); } });
  assert.equal(requests[0], 'model.parts/3.bin'); assert.equal(output.byteLength, MODEL_BYTES);
  assert.equal(new Uint8Array(output)[10 * BLOCK_BYTES], 10);
  await downloadModel({ ...h, url: 'model', fetcher: () => { throw Error('completed cache must not use network'); } });
});
test('previous complete single-buffer cache is reused without fetching', async () => {
  const h = harness(); h.data.set(MODEL_KEY, new ArrayBuffer(MODEL_BYTES));
  const output = await downloadModel({ ...h, url: 'model', fetcher: () => { throw Error('network'); } });
  assert.equal(output.byteLength, MODEL_BYTES);
});
test('storage failure is visible and never reports unsaved progress', async () => {
  const h = harness(), saved = [];
  await assert.rejects(downloadModel({ ...h, put: async () => { throw Error('quota'); }, progress: p => saved.push(p.saved), url: 'model', fetcher: async url => response(url) }), /تعذر حفظ/);
  assert.deepEqual(saved, [0]); assert.equal(h.data.size, 0);
});
test('incomplete network block is not committed', async () => {
  const h = harness();
  await assert.rejects(downloadModel({ ...h, url: 'model', fetcher: async url => response(url, { incomplete: true }) }), /غير مكتمل/);
  assert.equal(h.data.size, 0);
});
test('compressed transfer size cannot produce over 100 percent', async () => {
  const h = harness(), percents = [];
  await downloadModel({ ...h, progress: p => percents.push(p.saved / p.total * 100), url: 'model', fetcher: async url => response(url) });
  assert.equal(Math.max(...percents), 100); assert.equal(percents.at(-1), 100);
});
