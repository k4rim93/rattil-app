import test from 'node:test'
import assert from 'node:assert/strict'

// Minimal Path2D stand-in: buildPath only calls path verbs.
class FakePath2D {
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  closePath() {}
}
globalThis.Path2D = globalThis.Path2D || FakePath2D

const { QvpLitePage } = await import('../qvp/lite.mjs')

const shape = () => ({ ops: [0, 1, 4], pts: [0, 0, 1, 1], rule: 'nonzero' })

function makeCtx() {
  const fills = []
  return {
    fills,
    save() {},
    restore() {},
    setTransform() {},
    set fillStyle(_value) {},
    fill(path) { fills.push(path) }
  }
}

function makePage() {
  // paths 0-1: marker of 19:1 (deco 0); paths 2-3: marker of 19:2 (deco 1);
  // path 4: the single word; path 5: a plain ornament (deco 2).
  return new QvpLitePage({
    width: 100,
    height: 100,
    number: 305,
    paths: [shape(), shape(), shape(), shape(), shape(), shape()],
    words: [{ index: 0, firstPath: 4, nPaths: 1, box: [0, 0, 1, 1], surah: 19, ayah: 1, word: 0 }],
    ayahs: [
      { surah: 19, ayah: 1, ayahMarkDecoration: 0 },
      { surah: 19, ayah: 1, ayahMarkDecoration: 0 }, // second fragment, same marker
      { surah: 19, ayah: 2, ayahMarkDecoration: 1 },
      { surah: 19, ayah: 3, ayahMarkDecoration: -1 } // no marker
    ],
    decorations: [
      { surah: 19, ayah: 1, firstPath: 0, nPaths: 2 },
      { surah: 19, ayah: 2, firstPath: 2, nPaths: 2 },
      { surah: 19, ayah: 0, firstPath: 5, nPaths: 1 }
    ]
  })
}

test('ayah end markers are excluded from always-drawn decorations', () => {
  const page = makePage()
  const ctx = makeCtx()
  page.drawDecorations(ctx)
  // Only the plain ornament (path index 5) may be drawn by the base layer.
  assert.equal(ctx.fills.length, 1)
})

test('drawAyahMarkers draws exactly the marker paths of the requested ayahs', () => {
  const page = makePage()
  const ctx = makeCtx()
  page.drawAyahMarkers(ctx, ['19:1', '19:2'])
  assert.equal(ctx.fills.length, 4) // two 2-path markers, no duplicates from fragments
})

test('ayah without a marker and unknown keys draw nothing', () => {
  const page = makePage()
  const ctx = makeCtx()
  page.drawAyahMarkers(ctx, ['19:3', '19:99'])
  assert.equal(ctx.fills.length, 0)
})

test('ayahMarkerKeys lists each marked ayah once', () => {
  const page = makePage()
  assert.deepEqual(page.ayahMarkerKeys, ['19:1', '19:2'])
})
