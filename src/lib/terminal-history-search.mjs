function scoreTerm(term, value) {
  if (value === term) return 1200;
  if (value.startsWith(term)) return 1000 - value.length * 0.1;
  const at = value.indexOf(term);
  if (at >= 0) return 800 - at * 3 - value.length * 0.1;
  let cursor = 0;
  let first = -1;
  let gaps = 0;
  for (const character of term) {
    const found = value.indexOf(character, cursor);
    if (found < 0) return -1;
    if (first < 0) first = found;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return Math.max(1, 500 - first * 4 - gaps * 4 - value.length * 0.1);
}

export function rankTerminalHistory(history, query) {
  const terms = String(query || '').normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return (Array.isArray(history) ? history : [])
    .map((command, index) => {
      const value = String(command || '').normalize('NFKC').toLocaleLowerCase();
      let score = 0;
      for (const term of terms) {
        const termScore = scoreTerm(term, value);
        if (termScore < 0) return null;
        score += termScore;
      }
      return { command, index, score };
    })
    .filter((match) => match !== null)
    .sort((a, b) => b.score - a.score || b.index - a.index);
}
