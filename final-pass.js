// Stop-time persistence planning: pure logic, no audio, no DOM.
//
// The live per-run rescore (word_issues red paint) only covers VAD speech
// runs whose window happens to contain a verse_match emission time. On a slow
// device the match can be emitted after its window closed, leaving matched,
// recited words with no acoustic verdict in the saved session. The final pass
// re-scores those gaps at stop time from the tracker's progress trail:
// every word_progress event is stamped with the audio offset the tracker had
// consumed when it fired, so the audio segment that actually contains an ayah
// is bounded by that ayah's first and last progress times.
//
// Hard rules (do not relax):
// - A group is only planned for an ayah the live tracker actually reached
//   (it appears in the progress trail). No progress, no plan: we never infer
//   recitation from a verse_match alone.
// - The expected passage is exactly the grouped ayah range and the audio fed
//   is exactly the bounded segment, so words the user never recited (partial
//   ayah tails) simply produce no verdicts: the engine only emits verdicts
//   inside its aligned span, and interior "skipped" verdicts stay its own
//   acoustic omission evidence. Nothing here fabricates coverage.
// - Ayahs already covered by the live per-run rescore are not re-scored.

const LEAD = 0.8 * 16000;   // samples before an ayah's first progress event
const TRAIL = 0.6 * 16000;  // samples after its last progress event
// Adjacent-ayah join threshold: the tracker can take several seconds to
// confirm the next ayah while the user recites on, so this is much wider than
// a speech pause. Joining is only an efficiency: it merges stretches into one
// scorer pass; correctness never depends on it.
const JOIN_GAP = 12 * 16000;

export function planFinalPass(progressLog, coveredAyahs, audioTotal, opts = {}) {
  const lead = opts.lead ?? LEAD, trail = opts.trail ?? TRAIL, joinGap = opts.joinGap ?? JOIN_GAP;
  const total = Number.isFinite(audioTotal) ? audioTotal : 0;
  if (!Array.isArray(progressLog) || !progressLog.length || total <= 0) return [];
  const covered = coveredAyahs instanceof Set ? coveredAyahs : new Set(coveredAyahs || []);
  // One stretch per recited ayah. Consecutive entries for the same ayah
  // extend its stretch; an ayah that reappears after another one was
  // re-recited, so it keeps only its latest stretch and moves to the back of
  // the recitation order.
  const order = [], byAyah = new Map();
  let lastKey = null;
  for (const p of progressLog) {
    const surah = Number(p?.surah), ayah = Number(p?.ayah), at = Number(p?.at);
    if (!Number.isInteger(surah) || !Number.isInteger(ayah) || !Number.isFinite(at)) continue;
    const key = `${surah}:${ayah}`;
    if (covered.has(key)) { lastKey = null; continue; }
    let cur = byAyah.get(key);
    if (!cur) { cur = { key, surah, ayah, first: at, last: at }; byAyah.set(key, cur); order.push(cur); }
    else if (key === lastKey) { if (at > cur.last) cur.last = at; if (at < cur.first) cur.first = at; }
    else {
      cur.first = at; cur.last = at;
      const i = order.indexOf(cur); if (i >= 0) order.splice(i, 1);
      order.push(cur);
    }
    lastKey = key;
  }
  // Join contiguous same-surah ayahs whose audio nearly touches.
  const groups = [];
  for (const entry of order) {
    const prev = groups[groups.length - 1];
    if (prev && prev.surah === entry.surah && entry.ayah === prev.to + 1 && entry.first - prev.lastAt <= joinGap) {
      prev.to = entry.ayah;
      prev.firstAt = Math.min(prev.firstAt, entry.first);
      prev.lastAt = Math.max(prev.lastAt, entry.last);
    } else {
      groups.push({ surah: entry.surah, from: entry.ayah, to: entry.ayah, firstAt: entry.first, lastAt: entry.last });
    }
  }
  return groups
    .map(g => ({ surah: g.surah, from: g.from, to: g.to, audioFrom: Math.max(0, Math.round(g.firstAt - lead)), audioTo: Math.min(total, Math.round(g.lastAt + trail)) }))
    .filter(g => g.audioTo > g.audioFrom);
}
