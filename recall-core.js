// Helpers deliberately independent of the microphone and UI.
export function referencePage(references, surah, ayah) {
  let page = 1;
  references.forEach((ref, index) => {
    if (ref.surah < surah || (ref.surah === surah && ref.ayah <= ayah)) page = index + 1;
  });
  return page;
}
export function sessionStats(session) {
  const words = Array.isArray(session.words) ? session.words : [];
  return {
    followed: words.filter(word => word.status === 'correct' && !word.hinted).length,
    hints: words.filter(word => word.hinted || word.status === 'hint').length,
    review: words.filter(word => word.hinted || ['hint', 'error', 'uncertain'].includes(word.status)).length,
    touched: words.length,
  };
}
export function nextHint(words, states, { surah = 0, from = 1, to = 286, after = null } = {}) {
  return words.find(word => {
    if (surah && (word.surah !== surah || word.ayah < from || word.ayah > to)) return false;
    if (after && (word.surah < after.surah || (word.surah === after.surah && word.ayah < after.ayah))) return false;
    return !states.has(`${word.surah}:${word.ayah}:${word.word}`);
  });
}
export function mergeWord(previous, incoming) {
  return { ...previous, ...incoming, hinted: Boolean(previous?.hinted || incoming.hinted || incoming.status === 'hint') };
}
