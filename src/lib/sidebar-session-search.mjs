function scoreCandidate(term, candidate) {
  const value = String(candidate || '').normalize('NFKC').toLocaleLowerCase();
  if (!value) return -1;
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

export function scoreSidebarSession(session, query) {
  const terms = String(query || '').normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const candidates = [session?.title, session?.cwd];
  let score = 0;
  for (const term of terms) {
    let best = Math.max(...candidates.map((candidate) => scoreCandidate(term, candidate)));
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const text = String(message?.text || '').normalize('NFKC').toLocaleLowerCase();
      const at = text.indexOf(term);
      if (at >= 0) {
        best = Math.max(best, 650 - at * 0.05 - Math.min(text.length, 5000) * 0.001);
        break;
      }
    }
    if (best < 0) return -1;
    score += best;
  }
  return score;
}

export function fuzzyMatchIndexes(value, query) {
  const chars = Array.from(String(value || ''));
  const normalizedChars = chars.map((character) => character.normalize('NFKC').toLocaleLowerCase());
  const terms = String(query || '').normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const indexes = new Set();
  for (const term of terms) {
    let cursor = 0;
    const hits = [];
    for (const character of Array.from(term)) {
      let found = -1;
      for (let index = cursor; index < normalizedChars.length; index += 1) {
        if (normalizedChars[index].includes(character)) { found = index; break; }
      }
      if (found < 0) { hits.length = 0; break; }
      hits.push(found);
      cursor = found + 1;
    }
    hits.forEach((index) => indexes.add(index));
  }
  return [...indexes].sort((a, b) => a - b);
}
