// Mistake review helpers: pure logic, no DOM, no microphone.
// Grounded in @tilawa/core WordVerdict fields (recitation/types.d.ts):
//   state: "ok" | "unsure" | "wrong" | "skipped" | "pending"
//   gop: per-token log-likelihood ratio, expected vs free path (<= 0; ~0 fits)
//   gopNone: same ratio forcing silence (omission hypothesis)
//   repGain: gain of forcing the word twice (> 0: repeated)
//   vowelErrors: aligned short-vowel substitutions
// A word is only treated as a mistake when the acoustic rescore confirms it
// (gop <= GOP_FLAG) — the same bar the red highlighting uses — AND one of:
//   - the engine doubted it (state wrong/unsure), or
//   - the tracker skipped it and the silence hypothesis clearly beats the
//     heard one (gopNone > gop + OMISSION_MARGIN): the engine's omission
//     evidence, which is emitted with state 'skipped', or
//   - the repeat hypothesis wins (repGain > 0) even though the engine state
//     stayed ok: the engine's repetition evidence.
// Engine doubt without acoustic confirmation stays "unsure", never "wrong".

export const GOP_FLAG = -5;
// gopNone must beat gop by more than this to call an omission. Both are <= 0;
// the better fit is the one closer to 0.
export const OMISSION_MARGIN = 1;

export function isFlagged(verdict) {
  if (!verdict) return false;
  if (typeof verdict.gop !== 'number' || !Number.isFinite(verdict.gop) || verdict.gop > GOP_FLAG) return false;
  if (verdict.state === 'wrong' || verdict.state === 'unsure') return true;
  if (verdict.state === 'skipped') {
    const gopNone = typeof verdict.gopNone === 'number' && Number.isFinite(verdict.gopNone) ? verdict.gopNone : null;
    if (gopNone !== null && gopNone > verdict.gop + OMISSION_MARGIN) return true;
  }
  if (verdict.state === 'ok' && typeof verdict.repGain === 'number' && Number.isFinite(verdict.repGain) && verdict.repGain > 0) return true;
  return false;
}

// verdict -> { bucket: 'correct' | 'wrong' | 'unsure' | 'unclear', kind? }
// kind: 'omission' | 'repetition' | 'vowel' | 'substitution'
export function classifyVerdict(verdict) {
  if (!verdict || typeof verdict !== 'object') return { bucket: 'unclear' };
  if (!isFlagged(verdict)) {
    if (verdict.state === 'ok') return { bucket: 'correct' };
    if (verdict.state === 'wrong' || verdict.state === 'unsure') return { bucket: 'unsure' };
    return { bucket: 'unclear' };
  }
  // The flag path fixes the kind for the two evidence-only flags: 'skipped'
  // only flags via the omission evidence, 'ok' only via the repetition one.
  if (verdict.state === 'skipped') return { bucket: 'wrong', kind: 'omission' };
  if (verdict.state === 'ok') return { bucket: 'wrong', kind: 'repetition' };
  const gop = verdict.gop;
  const gopNone = typeof verdict.gopNone === 'number' && Number.isFinite(verdict.gopNone) ? verdict.gopNone : null;
  if (gopNone !== null && gopNone > gop + OMISSION_MARGIN) return { bucket: 'wrong', kind: 'omission' };
  if (typeof verdict.repGain === 'number' && Number.isFinite(verdict.repGain) && verdict.repGain > 0) return { bucket: 'wrong', kind: 'repetition' };
  if ((verdict.vowelErrors | 0) > 0) return { bucket: 'wrong', kind: 'vowel' };
  return { bucket: 'wrong', kind: 'substitution' };
}

export const MISTAKE_KIND_LABELS = {
  omission: 'احتمال حذف الكلمة',
  repetition: 'احتمال تكرار الكلمة',
  vowel: 'اختلاف محتمل في الحركة',
  substitution: 'احتمال اختلاف النطق',
};
export function mistakeKindLabel(kind) {
  return MISTAKE_KIND_LABELS[kind] || 'موضع رصده المحرك للمراجعة';
}

// Session shape: { words: [{key,surah,ayah,index,text,status,hinted}],
//   verdicts?: {key: {state,gop,gopNone,repGain,vowelErrors}},
//   rescoreUnavailable?: bool, startedAt, endedAt, mode }
// Buckets are exclusive, per word:
//   wrong    = the live red flag AND the acoustic rescore confirms it
//              (flagged verdict), or a red flag from the word_issues path
//              with no verdict at all: word_issues is GOP-gated inside
//              asr-worker's rescoreRun, so that paint carried acoustic
//              support when shown (this also covers legacy sessions, whose
//              red came from the same path).
//   unsure   = engine doubt the rescore did NOT confirm — including a live
//              red flag whose verdict came back unsure/ok/weak-GOP (stale or
//              overridden paint must not convict a word on its own).
//   correct  = the rescore examined the word and judged it ok. A word the
//              tracker painted correct but the rescore never examined is NOT
//              correct: following along is not acoustic confirmation.
//   hinted   = the user asked for a hint; counted on its own, never as
//              independent correct recitation.
//   unreviewed = no usable acoustic verdict (missing, skipped or pending).
// "correct" never means tajweed-valid and never covers unexamined words.
export function buildSessionSummary(session) {
  const words = Array.isArray(session?.words) ? session.words : [];
  const verdicts = session?.verdicts && typeof session.verdicts === 'object' ? session.verdicts : {};
  const counts = { touched: words.length, correct: 0, hinted: 0, wrong: 0, unsure: 0, unreviewed: 0, judged: 0 };
  const mistakes = [];
  for (const word of words) {
    const verdict = verdicts[word.key] || null;
    const cls = classifyVerdict(verdict);
    if (verdict && cls.bucket !== 'unclear') counts.judged++;
    if (word.status === 'error') {
      if (verdict && cls.bucket !== 'wrong') {
        counts.unsure++;
      } else if (!verdict && word.errorSource === 'correction') {
        // Correction-panel red comes from the live tracker (similar-verse /
        // missed-word suspicion), not the GOP rescore. Without a verdict it
        // carries no acoustic confirmation, so it is doubt, not a mistake.
        counts.unsure++;
      } else {
        counts.wrong++;
        mistakes.push({
          surah: word.surah, ayah: word.ayah, index: word.index, text: word.text,
          kind: cls.bucket === 'wrong' ? cls.kind : null,
        });
      }
    } else if (word.hinted || word.status === 'hint') {
      counts.hinted++;
    } else if (verdict && cls.bucket === 'correct') {
      counts.correct++;
    } else if (verdict && cls.bucket !== 'unclear') {
      counts.unsure++;
    } else {
      counts.unreviewed++;
    }
  }
  mistakes.sort((a, b) => (a.surah - b.surah) || (a.ayah - b.ayah) || (a.index - b.index));
  return {
    counts,
    mistakes,
    rescoreUnavailable: Boolean(session?.rescoreUnavailable),
    mode: session?.mode || null,
    startedAt: session?.startedAt || 0,
  };
}

// Aggregate mistakes across saved sessions: one row per word, counting how
// many sessions flagged it. A word flagged twice in one session counts once.
export function aggregateMistakes(sessions, { limit = 20 } = {}) {
  const map = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const summary = buildSessionSummary(session);
    const at = Number(session?.endedAt || session?.startedAt) || 0;
    const seen = new Set();
    for (const mistake of summary.mistakes) {
      const key = `${mistake.surah}:${mistake.ayah}:${mistake.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = map.get(key) || { ...mistake, sessions: 0, first: at, last: 0 };
      current.sessions++;
      current.kind = mistake.kind || current.kind;
      current.text = mistake.text || current.text;
      if (!current.first || (at && at < current.first)) current.first = at;
      if (at > current.last) current.last = at;
      map.set(key, current);
    }
  }
  return [...map.values()]
    .sort((a, b) => (b.last - a.last) || (b.sessions - a.sessions))
    .slice(0, limit);
}
