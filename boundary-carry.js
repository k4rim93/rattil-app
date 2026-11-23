// Preserve only already-decoded suffix chars after a completed surah.
// This is alignment evidence, not a new acoustic verdict or permission to
// reveal words. The normal fresh search and tracker still decide what matched.
export function completedSurahCarry(tracker, table, alignGlobal) {
  if (!tracker?.reachedEnd || !tracker.heard?.length || !tracker.wordStarts?.length) return [];
  const heard = tracker.heard.slice(-150);
  const ids = table.encode(heard.map(char => char.ch).join(''));
  const from = tracker.wordStarts[Math.max(0, tracker.wordStarts.length - 3)];
  const assignment = alignGlobal(ids, tracker.ref, from, tracker.len, table);
  let last = -1;
  for (let i = 0; i < assignment.length; i++) if (assignment[i] >= 0) last = i;
  // An alignment that never reached the last reference cell is not an end.
  if (last < 0 || assignment[last] !== tracker.len - 1) return [];
  return heard.slice(last + 1);
}
