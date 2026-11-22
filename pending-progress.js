// Split buffered word_progress entries when a verse_match arrives.
// Entries for the matched ayah (and still fresh) are replayed. Entries for
// other ayat that are still fresh stay buffered for their own verse_match.
export function splitPending(pending, surah, ayah, now, maxAge = 5000, cap = 30) {
  const early = [], rest = [];
  for (const item of pending || []) {
    if (!item || !item.message || now - item.at >= maxAge) continue;
    if (Number(item.message.surah) === Number(surah) && Number(item.message.ayah) === Number(ayah)) early.push(item);
    else rest.push(item);
  }
  while (rest.length > cap) rest.shift();
  return { early, rest };
}
