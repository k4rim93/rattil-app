import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyVerdict, isFlagged, buildSessionSummary, aggregateMistakes, mistakeKindLabel } from '../mistake-core.js';

test('only wrong/unsure with strong acoustic evidence is flagged', () => {
  assert.equal(isFlagged({ state: 'wrong', gop: -9 }), true);
  assert.equal(isFlagged({ state: 'unsure', gop: -5 }), true);
  assert.equal(isFlagged({ state: 'unsure', gop: -4.9 }), false);
  assert.equal(isFlagged({ state: 'wrong', gop: null }), false);
  assert.equal(isFlagged({ state: 'wrong' }), false);
  assert.equal(isFlagged({ state: 'ok', gop: -12 }), false);
  assert.equal(isFlagged(null), false);
});

test('engine doubt without acoustic confirmation is unsure, never wrong', () => {
  assert.deepEqual(classifyVerdict({ state: 'wrong' }), { bucket: 'unsure' });
  assert.deepEqual(classifyVerdict({ state: 'unsure', gop: -1 }), { bucket: 'unsure' });
  assert.deepEqual(classifyVerdict({ state: 'ok' }), { bucket: 'correct' });
  assert.deepEqual(classifyVerdict({ state: 'pending' }), { bucket: 'unclear' });
  assert.deepEqual(classifyVerdict({ state: 'skipped' }), { bucket: 'unclear' });
  assert.deepEqual(classifyVerdict(undefined), { bucket: 'unclear' });
});

test('flagged mistakes are classified from the engine hypotheses', () => {
  assert.deepEqual(classifyVerdict({ state: 'wrong', gop: -9, gopNone: -1 }), { bucket: 'wrong', kind: 'omission' });
  assert.deepEqual(classifyVerdict({ state: 'wrong', gop: -9, repGain: 2.5 }), { bucket: 'wrong', kind: 'repetition' });
  assert.deepEqual(classifyVerdict({ state: 'wrong', gop: -9, vowelErrors: 1 }), { bucket: 'wrong', kind: 'vowel' });
  assert.deepEqual(classifyVerdict({ state: 'wrong', gop: -9 }), { bucket: 'wrong', kind: 'substitution' });
  // omission needs a margin; near-tie stays substitution
  assert.deepEqual(classifyVerdict({ state: 'wrong', gop: -9, gopNone: -8.5 }), { bucket: 'wrong', kind: 'substitution' });
  // omission beats repetition when the silence hypothesis fits best
  assert.deepEqual(classifyVerdict({ state: 'wrong', gop: -9, gopNone: -2, repGain: 1 }), { bucket: 'wrong', kind: 'omission' });
});

test('kind labels are honest possibilities, not verdicts', () => {
  for (const kind of ['omission', 'repetition', 'vowel', 'substitution']) assert.match(mistakeKindLabel(kind), /احتمال|محتمل/);
  assert.equal(mistakeKindLabel(null), 'موضع رصده المحرك للمراجعة');
  assert.equal(mistakeKindLabel('nonsense'), 'موضع رصده المحرك للمراجعة');
});

const word = (key, status, extra = {}) => ({ key, surah: 55, ayah: 3, index: Number(key.split(':')[2]), text: 'كلمة' + key.split(':')[2], status, ...extra });

test('summary counts buckets exclusively and lists mistakes in order', () => {
  const session = {
    startedAt: 1000, endedAt: 2000, mode: 'review',
    words: [
      word('55:3:0', 'correct'),
      word('55:3:1', 'error'),
      word('55:3:2', 'uncertain'),
      word('55:3:3', 'correct', { hinted: true }),
    ],
    verdicts: {
      '55:3:0': { state: 'ok', gop: -0.2 },
      '55:3:1': { state: 'wrong', gop: -9, gopNone: -1 },
      '55:3:2': { state: 'unsure', gop: -1 },
    },
  };
  const summary = buildSessionSummary(session);
  assert.deepEqual(summary.counts, { touched: 4, correct: 1, wrong: 1, unsure: 1, hints: 1, judged: 3 });
  assert.equal(summary.mistakes.length, 1);
  assert.deepEqual(summary.mistakes[0], { surah: 55, ayah: 3, index: 1, text: 'كلمة1', kind: 'omission' });
  assert.equal(summary.rescoreUnavailable, false);
});

test('legacy sessions without verdicts keep working; red words stay mistakes with unknown kind', () => {
  const session = { startedAt: 1, words: [word('55:3:0', 'error'), word('55:3:1', 'correct'), word('55:3:2', 'uncertain')] };
  const summary = buildSessionSummary(session);
  assert.deepEqual(summary.counts, { touched: 3, correct: 1, wrong: 1, unsure: 1, hints: 0, judged: 0 });
  assert.equal(summary.mistakes[0].kind, null);
});

test('verdict doubt on a live-correct word demotes it to unsure, not wrong', () => {
  const session = { words: [word('55:3:0', 'correct')], verdicts: { '55:3:0': { state: 'wrong', gop: -1 } } };
  const summary = buildSessionSummary(session);
  assert.deepEqual(summary.counts, { touched: 1, correct: 0, wrong: 0, unsure: 1, hints: 0, judged: 1 });
  assert.equal(summary.mistakes.length, 0);
});

test('empty session is not a perfect score', () => {
  const summary = buildSessionSummary(null);
  assert.deepEqual(summary.counts, { touched: 0, correct: 0, wrong: 0, unsure: 0, hints: 0, judged: 0 });
  assert.equal(summary.mistakes.length, 0);
});

test('rescore-unavailable flag is surfaced for honest coverage wording', () => {
  assert.equal(buildSessionSummary({ words: [], rescoreUnavailable: true }).rescoreUnavailable, true);
});

test('mistake history aggregates per word across sessions, most recent first', () => {
  const sessions = [
    { startedAt: 1000, endedAt: 2000, words: [word('55:3:1', 'error'), word('19:4:2', 'error')], verdicts: { '55:3:1': { state: 'wrong', gop: -9, gopNone: -1 } } },
    { startedAt: 3000, endedAt: 4000, words: [word('55:3:1', 'error')], verdicts: { '55:3:1': { state: 'wrong', gop: -9, gopNone: -1 } } },
  ];
  const items = aggregateMistakes(sessions);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'كلمة1');
  assert.equal(items[0].sessions, 2);
  assert.equal(items[0].last, 4000);
  assert.equal(items[0].first, 2000); // session timestamps use end time (start as fallback)
  assert.equal(items[0].kind, 'omission');
  assert.equal(items[1].sessions, 1);
});

test('a word flagged twice in one session counts once; limit applies', () => {
  const sessions = [{ startedAt: 1, endedAt: 2, words: [word('55:3:1', 'error'), { ...word('55:3:1', 'error') }] }];
  const items = aggregateMistakes(sessions);
  assert.equal(items.length, 1);
  assert.equal(items[0].sessions, 1);
  assert.equal(aggregateMistakes(sessions, { limit: 0 }).length, 0);
  assert.equal(aggregateMistakes(null).length, 0);
});
