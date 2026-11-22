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

// --- Heard-transcript backfill (first-phrase preservation) ---
// These helpers compare the live "we heard you" transcript with verse words so
// the app can restore the beginning of a recitation that happened before the
// engine located the reciter. They never judge correctness; callers mark
// matched words as heard/uncertain only.

// Strip tashkeel, tatweel and Quranic annotation marks; unify letter variants
// that ASR and Uthmani text commonly differ on.
export function normalizeHeard(text) {
  return String(text || '')
    .replace(/[ً-ٰٟۖ-ۭـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^ء-ي]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function compactHeard(text) {
  return normalizeHeard(text).replace(/\s+/g, '');
}
// Reciters pronounce the opening muqatta'at by letter names (كهيعص is read
// "كاف ها يا عين صاد"), often heavily elongated. The recognizer therefore
// emits the letter NAMES, sometimes with repeated letters and U+06BA for ن,
// never the written token. This loose compaction keeps that path usable
// without touching the strict heardCovers tolerance: ں→ن, collapse runs of
// 2+ identical letters (madd), no spaces.
export function compactHeardLoose(text) {
  return normalizeHeard(String(text || '').replace(/[ںۧ]/g, 'ن'))
    .replace(/\s+/g, '')
    .replace(/(.)\1{1,}/g, '$1');
}
const LETTER_NAMES = {
  'ا': 'الف', 'ب': 'با', 'ت': 'تا', 'ث': 'ثا', 'ج': 'جيم', 'ح': 'حا', 'خ': 'خا',
  'د': 'دال', 'ذ': 'ذال', 'ر': 'را', 'ز': 'زاي', 'س': 'سين', 'ش': 'شين',
  'ص': 'صاد', 'ض': 'ضاد', 'ط': 'طا', 'ظ': 'ظا', 'ع': 'عين', 'غ': 'غين',
  'ف': 'فا', 'ق': 'قاف', 'ك': 'كاف', 'ل': 'لام', 'م': 'ميم', 'ن': 'نون',
  'ه': 'ها', 'و': 'واو', 'ي': 'يا',
};
// Written muqatta'at forms (normalized). Only sequences of 3+ letters get the
// letter-name treatment: shorter ones (ص، ق، ن، حم، يس…) are too easy to
// false-positive inside ordinary words, so they stay unrecovered rather than
// guessed.
const MUQATTAAT = new Set(['الم', 'الر', 'المر', 'المص', 'كهيعص', 'طسم', 'عسق']);
export function muqattaatHeard(heardLoose, tokenCompact) {
  if (!heardLoose || !MUQATTAAT.has(tokenCompact) || tokenCompact.length < 3) return false;
  const names = Array.from(tokenCompact).map(letter => LETTER_NAMES[letter] || letter).join('');
  return names.length >= 6 && heardLoose.includes(names);
}
function levRatio(a, b) {
  if (a === b) return 1;
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  for (let i = 1; i <= n; i++) {
    let curr = [i];
    for (let j = 1; j <= m; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return 1 - prev[m] / Math.max(n, m);
}
// True when the heard stream contains the (concatenated) candidate, allowing a
// small edit tolerance for ASR letter drops such as كهعص for كهيعص.
export function heardCovers(heardCompact, candidateCompact) {
  if (!heardCompact || !candidateCompact) return false;
  if (heardCompact.includes(candidateCompact)) return true;
  if (candidateCompact.length < 3 || candidateCompact.length > heardCompact.length + 2) return false;
  const w = candidateCompact.length;
  for (let size = Math.max(3, w - 2); size <= w; size++) {
    for (let i = 0; i + size <= heardCompact.length; i++) {
      if (levRatio(heardCompact.slice(i, i + size), candidateCompact) >= 0.72) return true;
    }
  }
  return false;
}
// verses: ascending [{surah, ayah, words:[uthmani words]}], only ayahs BEFORE
// matchedAyah are considered, walking back at most maxAyahs while whole ayahs
// stay covered. Returns [{surah, ayah, from, to}] word ranges heard before the
// location lock. Contiguity is required: a gap stops the walk.
export function backfillFromHeard(heardText, verses, matchedAyah, { maxAyahs = 2 } = {}) {
  const heard = compactHeard(heardText);
  const heardLoose = compactHeardLoose(heardText);
  const marks = [];
  if (!heard) return marks;
  const previous = verses
    .filter(v => v.ayah < matchedAyah && v.words.length)
    .sort((a, b) => b.ayah - a.ayah)
    .slice(0, maxAyahs);
  for (const verse of previous) {
    const compacts = verse.words.map(compactHeard);
    let start = -1;
    for (let i = 0; i < compacts.length; i++) {
      const tail = compacts.slice(i).join('');
      const singleMuqattaat = i === compacts.length - 1 && muqattaatHeard(heardLoose, tail);
      if ((tail.length >= 3 && heardCovers(heard, tail)) || singleMuqattaat) { start = i; break; }
    }
    if (start === -1) break;
    marks.push({ surah: verse.surah, ayah: verse.ayah, from: start, to: compacts.length - 1 });
    if (start > 0) break; // partial ayah: recitation started inside it
  }
  return marks;
}
// The ayah the engine locked on: the engine confirms from the lock point
// onward, so words it never confirmed stay hidden even though the reciter
// already said them (the كهيعص case). Restore each unconfirmed word with its
// own heard evidence: strict coverage for ordinary words, the full ordered
// letter-name sequence for muqatta'at of 3+ letters. Nothing is inferred
// from position alone; a word with no heard support stays hidden.
// alquran.cloud folds the bismillah into ayah 1 of every surah (except 1,
// where it IS the ayah, and 9, which has none). The recognition corpus counts
// it only where it is the ayah itself. So for opening ayahs the engine's
// word_index 0 is the first real word (كهيعص), while the API token 0 is بسم.
// Map engine indices by this offset; everywhere else it is 0.
export function bismillahOffset(words) {
  const norm = words.map(compactHeard);
  return norm.length > 4 && norm[0] === 'بسم' && norm[1] === 'الله' && norm[2] === 'الرحمن' && norm[3] === 'الرحيم' ? 4 : 0;
}
// Engine word indices count pronounced words only. The display text also
// carries standalone waqf marks (e.g. ۖ) that are never pronounced, so mapping
// an engine word index to a display token must skip tokens without Arabic
// letters, after the basmala offset. Otherwise every word after such a mark
// shifts one token and the ayah's final word never gets a state (19:12/19:13).
const ARABIC_LETTER = /[ء-يٱٰ]/;
export function hasRecitationLetters(token) {
  return ARABIC_LETTER.test(String(token || ''));
}
export function engineTokenMap(tokens) {
  const map = [];
  for (let i = bismillahOffset(tokens); i < tokens.length; i++) {
    if (hasRecitationLetters(tokens[i])) map.push(i);
  }
  return map;
}
export function backfillMatchedAyah(heardText, words, confirmedIndices = new Set()) {
  const heard = compactHeard(heardText);
  const heardLoose = compactHeardLoose(heardText);
  const restored = [];
  if (!heard) return restored;
  const compacts = words.map(compactHeard);
  for (let i = 0; i < compacts.length; i++) {
    if (confirmedIndices.has(i)) continue;
    const word = compacts[i];
    if ((word.length >= 3 && heardCovers(heard, word)) || muqattaatHeard(heardLoose, word)) restored.push(i);
  }
  return restored;
}
