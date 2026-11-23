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

test('skipped word with clear omission evidence is an omission mistake', () => {
  // measured on a full-word-omission fixture: gop -13.73, gopNone -3.1
  assert.deepEqual(classifyVerdict({ state: 'skipped', gop: -13.73, gopNone: -3.1 }), { bucket: 'wrong', kind: 'omission' });
  // without the silence-hypothesis margin a skip stays doubt, never a mistake
  assert.deepEqual(classifyVerdict({ state: 'skipped', gop: -13.73 }), { bucket: 'unclear' });
  // a partially-read word (tail cut) sits inside clean variation: not separable
  assert.deepEqual(classifyVerdict({ state: 'unsure', gop: -1.8, gopNone: -5.09 }), { bucket: 'unsure' });
});

test('repetition evidence flags even when the engine state stays ok', () => {
  // measured on a duplicated-word fixture: gop -7.21, repGain +5.29
  assert.deepEqual(classifyVerdict({ state: 'ok', gop: -7.21, repGain: 5.29 }), { bucket: 'wrong', kind: 'repetition' });
  // clean words can drift slightly above repGain 0 with a mild gop: the
  // acoustic bar (gop <= -5) keeps them correct
  assert.deepEqual(classifyVerdict({ state: 'ok', gop: -2.9, repGain: 0.19 }), { bucket: 'correct' });
  assert.deepEqual(classifyVerdict({ state: 'ok', gop: -7, repGain: -3 }), { bucket: 'correct' });
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
  assert.deepEqual(summary.counts, { touched: 4, correct: 1, hinted: 1, wrong: 1, unsure: 1, unreviewed: 0, judged: 3 });
  assert.equal(summary.mistakes.length, 1);
  assert.deepEqual(summary.mistakes[0], { surah: 55, ayah: 3, index: 1, text: 'كلمة1', kind: 'omission' });
  assert.equal(summary.rescoreUnavailable, false);
});

test('legacy sessions without verdicts: red stays a mistake, tracker paint alone is unreviewed', () => {
  const session = { startedAt: 1, words: [word('55:3:0', 'error'), word('55:3:1', 'correct'), word('55:3:2', 'uncertain')] };
  const summary = buildSessionSummary(session);
  assert.deepEqual(summary.counts, { touched: 3, correct: 0, hinted: 0, wrong: 1, unsure: 0, unreviewed: 2, judged: 0 });
  assert.equal(summary.mistakes[0].kind, null);
});

test('stale red paint never convicts: error status with weak/no-GOP verdict is unsure', () => {
  const weakUnsure = buildSessionSummary({ words: [word('55:3:0', 'error')], verdicts: { '55:3:0': { state: 'unsure', gop: -1.2 } } });
  assert.deepEqual(weakUnsure.counts, { touched: 1, correct: 0, hinted: 0, wrong: 0, unsure: 1, unreviewed: 0, judged: 1 });
  assert.equal(weakUnsure.mistakes.length, 0);
  const noGop = buildSessionSummary({ words: [word('55:3:0', 'error')], verdicts: { '55:3:0': { state: 'wrong', gop: null } } });
  assert.deepEqual(noGop.counts, { touched: 1, correct: 0, hinted: 0, wrong: 0, unsure: 1, unreviewed: 0, judged: 1 });
  assert.equal(noGop.mistakes.length, 0);
  const rescoreOk = buildSessionSummary({ words: [word('55:3:0', 'error')], verdicts: { '55:3:0': { state: 'ok', gop: -0.3 } } });
  assert.deepEqual(rescoreOk.counts, { touched: 1, correct: 0, hinted: 0, wrong: 0, unsure: 1, unreviewed: 0, judged: 1 });
  const skipped = buildSessionSummary({ words: [word('55:3:0', 'error')], verdicts: { '55:3:0': { state: 'skipped' } } });
  assert.deepEqual(skipped.counts, { touched: 1, correct: 0, hinted: 0, wrong: 0, unsure: 1, unreviewed: 0, judged: 0 });
});

test('correction-panel red without a verdict is tracker suspicion, not a mistake', () => {
  const session = { words: [{ ...word('55:3:0', 'error'), errorSource: 'correction' }, word('55:3:1', 'error')] };
  const summary = buildSessionSummary(session);
  assert.deepEqual(summary.counts, { touched: 2, correct: 0, hinted: 0, wrong: 1, unsure: 1, unreviewed: 0, judged: 0 });
  assert.equal(summary.mistakes.length, 1);
  assert.equal(summary.mistakes[0].index, 1);
});

test('scorer failure or missing verdicts never produce reassuring correct counts', () => {
  const session = { rescoreUnavailable: true, words: [word('55:3:0', 'correct'), word('55:3:1', 'correct')] };
  const summary = buildSessionSummary(session);
  assert.deepEqual(summary.counts, { touched: 2, correct: 0, hinted: 0, wrong: 0, unsure: 0, unreviewed: 2, judged: 0 });
  assert.equal(summary.mistakes.length, 0);
  assert.equal(summary.rescoreUnavailable, true);
});

test('verdict doubt on a live-correct word demotes it to unsure, not wrong', () => {
  const session = { words: [word('55:3:0', 'correct')], verdicts: { '55:3:0': { state: 'wrong', gop: -1 } } };
  const summary = buildSessionSummary(session);
  assert.deepEqual(summary.counts, { touched: 1, correct: 0, hinted: 0, wrong: 0, unsure: 1, unreviewed: 0, judged: 1 });
  assert.equal(summary.mistakes.length, 0);
});

test('empty session is not a perfect score', () => {
  const summary = buildSessionSummary(null);
  assert.deepEqual(summary.counts, { touched: 0, correct: 0, hinted: 0, wrong: 0, unsure: 0, unreviewed: 0, judged: 0 });
  assert.equal(summary.mistakes.length, 0);
});

test('rescore-unavailable flag is surfaced for honest coverage wording', () => {
  assert.equal(buildSessionSummary({ words: [], rescoreUnavailable: true }).rescoreUnavailable, true);
});

test('a session with no saved verdicts is a legacy record, not known-unreviewed', () => {
  const legacy = buildSessionSummary({ words: [word('55:1:0', 'correct'), word('55:2:0', 'correct')] });
  assert.equal(legacy.savedVerdicts, false);
  assert.equal(legacy.counts.unreviewed, 2);
  const current = buildSessionSummary({ words: [word('55:1:0', 'correct'), word('55:2:0', 'correct')], verdicts: { '55:1:0': { state: 'ok', gop: -0.1 } } });
  assert.equal(current.savedVerdicts, true);
  assert.equal(current.counts.correct, 1);
  assert.equal(current.counts.unreviewed, 1);
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

test('a fresh session with an empty verdicts object is known-zero-coverage, not legacy', () => {
  const words = [{ key: '55:1:0', surah: 55, ayah: 1, index: 0, text: 'x', status: 'correct' }];
  assert.equal(buildSessionSummary({ words, verdicts: {}, startedAt: 1 }).savedVerdicts, true);
  assert.equal(buildSessionSummary({ words, startedAt: 1 }).savedVerdicts, false);
});

test('remediation: a later session with an acoustically-correct verdict marks the mistake reviewed', () => {
  const flagSession = { startedAt: 1000, endedAt: 2000, words: [
    { key: '55:2:1', surah: 55, ayah: 2, index: 1, text: 'ٱلْقُرْءَانَ', status: 'error' },
  ], verdicts: {} };
  const reviewSession = { startedAt: 5000, endedAt: 6000, words: [
    { key: '55:2:1', surah: 55, ayah: 2, index: 1, text: 'ٱلْقُرْءَانَ', status: 'correct' },
  ], verdicts: { '55:2:1': { state: 'ok', gop: -0.3, gopNone: -40, repGain: -1, vowelErrors: 0 } } };
  const [item] = aggregateMistakes([flagSession, reviewSession]);
  assert.equal(item.sessions, 1, 'the historical flag is preserved, not rewritten');
  assert.equal(item.reviewed, 6000);
});

test('remediation requires a verdict: tracker-correct paint alone never reviews a mistake', () => {
  const flagSession = { startedAt: 1000, endedAt: 2000, words: [
    { key: '55:2:1', surah: 55, ayah: 2, index: 1, text: 'x', status: 'error' },
  ], verdicts: {} };
  const trackerOnly = { startedAt: 5000, endedAt: 6000, words: [
    { key: '55:2:1', surah: 55, ayah: 2, index: 1, text: 'x', status: 'correct' },
  ], verdicts: {} };
  const [item] = aggregateMistakes([flagSession, trackerOnly]);
  assert.equal(item.reviewed, 0);
});

test('remediation requires a LATER session and a correct verdict, not doubt', () => {
  const flagSession = { startedAt: 1000, endedAt: 2000, words: [
    { key: '55:2:1', surah: 55, ayah: 2, index: 1, text: 'x', status: 'error' },
  ], verdicts: {} };
  const unsureLater = { startedAt: 5000, endedAt: 6000, words: [], verdicts: { '55:2:1': { state: 'unsure', gop: -1.2, gopNone: -30, repGain: 0, vowelErrors: 0 } } };
  const correctEarlier = { startedAt: 100, endedAt: 200, words: [], verdicts: { '55:2:1': { state: 'ok', gop: -0.3, gopNone: -40, repGain: -1, vowelErrors: 0 } } };
  assert.equal(aggregateMistakes([flagSession, unsureLater])[0].reviewed, 0);
  assert.equal(aggregateMistakes([flagSession, correctEarlier])[0].reviewed, 0, 'an earlier session cannot remediate a later flag');
});

test('reviewed mistakes sort after open ones, history intact', () => {
  const flagBoth = { startedAt: 1000, endedAt: 2000, words: [
    { key: '55:2:1', surah: 55, ayah: 2, index: 1, text: 'a', status: 'error' },
    { key: '55:3:0', surah: 55, ayah: 3, index: 0, text: 'b', status: 'error' },
  ], verdicts: {} };
  const reviewOne = { startedAt: 5000, endedAt: 6000, words: [], verdicts: { '55:2:1': { state: 'ok', gop: -0.3, gopNone: -40, repGain: -1, vowelErrors: 0 } } };
  const items = aggregateMistakes([flagBoth, reviewOne]);
  assert.equal(items.length, 2);
  assert.equal(items[0].key ?? items[0].text, 'b');
  assert.equal(items[0].reviewed, 0);
  assert.equal(items[1].reviewed, 6000);
});

test('a fresh flag after an acoustically-confirmed review reopens the mistake', () => {
  const ok = { state: 'ok', gop: -0.3, gopNone: -40, repGain: -1, vowelErrors: 0 };
  const flag1 = { startedAt: 1000, endedAt: 2000, words: [
    { key: '55:2:1', surah: 55, ayah: 2, index: 1, text: 'x', status: 'error' }], verdicts: {} };
  const correct2 = { startedAt: 5000, endedAt: 6000, words: [], verdicts: { '55:2:1': ok } };
  const flag3 = { startedAt: 9000, endedAt: 10000, words: [
    { key: '55:2:1', surah: 55, ayah: 2, index: 1, text: 'x', status: 'error' }], verdicts: {} };
  const items = aggregateMistakes([flag1, correct2, flag3]);
  assert.equal(items.length, 1);
  assert.equal(items[0].reviewed, 0, 'a later flag must reopen: the old correct review must not hide a fresh mistake');
  assert.equal(items[0].sessions, 2, 'both flagging sessions stay in the history');
  const correct4 = { startedAt: 12000, endedAt: 13000, words: [], verdicts: { '55:2:1': ok } };
  const again = aggregateMistakes([flag1, correct2, flag3, correct4]);
  assert.equal(again[0].reviewed, 13000, 'a correct review after the latest flag marks it reviewed again');
});
