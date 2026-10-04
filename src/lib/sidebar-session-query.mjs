const SUPPORTED = new Set(['is:pinned', 'is:running', 'is:failed', 'is:archived', 'has:draft', 'has:queued']);

export function parseSidebarSessionQuery(value) {
  const tokens = String(value || '').match(/[^\s"]+:"[^"]*"|[^\s']+:'[^']*'|"[^"]*"|'[^']*'|\S+/g) || [];
  const text = [];
  const filters = [];
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
    const match = token.match(/^(in|is|has):(.*)$/i);
    if (!match) {
      text.push(token);
      continue;
    }
    const key = match[1].toLowerCase();
    const rawValue = match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
    const normalized = `${key}:${rawValue.toLowerCase()}`;
    if (key === 'is' || key === 'has') {
      if (SUPPORTED.has(normalized)) filters.push({ type: key, value: rawValue.toLowerCase() });
      else text.push(rawToken);
    } else if (key === 'in') {
      if (rawValue.trim()) filters.push({ type: 'in', value: rawValue.replace(/\\/g, '/').toLowerCase() });
    } else text.push(rawToken);
  }
  return { text: text.join(' ').trim(), filters };
}

export function matchesSidebarSessionQuery(session, filters, state = {}) {
  return filters.every(({ type, value }) => {
    if (type === 'in') return String(session?.cwd || '').replace(/\\/g, '/').toLowerCase().includes(value);
    if (type === 'is') {
      if (value === 'pinned') return !!session?.pinned;
      if (value === 'archived') return !!session?.archived;
      if (value === 'running') return (state.runningIds || []).includes(session?.id);
      if (value === 'failed') return (state.failedIds || []).includes(session?.id);
    }
    if (type === 'has') {
      if (value === 'draft') return (state.draftIds || []).includes(session?.id);
      if (value === 'queued') return (state.queuedIds || []).includes(session?.id);
    }
    return false;
  });
}
