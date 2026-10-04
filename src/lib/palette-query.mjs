const TAB_ACTION_PREFIX = 'switch-tab-';

export function parsePaletteQuery(value) {
  const trimmed = String(value || '').trim();
  const prefix = trimmed[0];
  const scope = prefix === '>' ? 'commands' : prefix === '#' ? 'sessions' : prefix === '@' ? 'tabs' : 'all';
  return {
    scope,
    query: scope === 'all' ? trimmed : trimmed.slice(1).trim(),
  };
}

export function scopePaletteItems(scope, threads, actions) {
  if (scope === 'commands') return { threads: [], actions };
  if (scope === 'sessions') return { threads, actions: [] };
  if (scope === 'tabs') return { threads: [], actions: actions.filter((action) => action.id.startsWith(TAB_ACTION_PREFIX)) };
  return { threads, actions };
}

export function matchScore(query, candidates) {
  const tokens = String(query || '').normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    let best = -1;
    for (const raw of candidates || []) {
      const candidate = String(raw ?? '').normalize('NFKC').toLocaleLowerCase();
      if (!candidate) continue;
      if (candidate === token) best = Math.max(best, 1000);
      else if (candidate.startsWith(token)) best = Math.max(best, 800 - candidate.length);
      else {
        const at = candidate.indexOf(token);
        if (at >= 0) best = Math.max(best, 600 - at - candidate.length * 0.1);
        else {
          let cursor = 0;
          let gaps = 0;
          let first = -1;
          for (const char of token) {
            const found = candidate.indexOf(char, cursor);
            if (found < 0) { cursor = -1; break; }
            if (first < 0) first = found;
            gaps += found - cursor;
            cursor = found + 1;
          }
          if (cursor >= 0) best = Math.max(best, 300 - first * 2 - gaps - candidate.length * 0.1);
        }
      }
    }
    if (best < 0) return -1;
    score += best;
  }
  return score;
}
