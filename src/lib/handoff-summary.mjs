// Handoff summaries: a compact, dedicated work-transfer note built from the
// live session — title, linked goal, todos in flight, changed files, verify
// outcomes, and the latest exchange. It is a generated artifact for
// copy/composer/external agents, never a rewrite of history: every line is
// labeled with where it came from, and the whole note is hard-capped.
export const HANDOFF_CAP = 4000;

function sliceText(text, cap) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (s.length <= cap) return s;
  return `${s.slice(0, cap)}…`;
}

function lastMessage(messages, role) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m && typeof m === 'object' && m.role === role && typeof m.text === 'string' && m.text.trim()) return m;
  }
  return null;
}

export function buildHandoffSummary(session, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ko';
  const en = lang === 'en';
  const s = session && typeof session === 'object' ? session : {};
  const messages = Array.isArray(s.messages) ? s.messages : [];
  const lines = [];
  lines.push(en ? `# Handoff: ${s.title || 'untitled'}` : `# 인계: ${s.title || '제목 없음'}`);
  if (s.cwd) lines.push(`${en ? 'Project' : '프로젝트'}: ${s.cwd}`);
  if (opts.goalTitle) lines.push(`${en ? 'Goal' : '목표'}: ${opts.goalTitle}`);
  lines.push(`${en ? 'Messages' : '메시지'}: ${messages.length}`);
  const lastUser = lastMessage(messages, 'user');
  const lastAi = lastMessage(messages, 'assistant');
  if (lastAi && Array.isArray(lastAi.todos) && lastAi.todos.length > 0) {
    lines.push('', en ? '## Todos' : '## 할 일');
    for (const t of lastAi.todos.slice(0, 10)) {
      if (!t || typeof t !== 'object') continue;
      lines.push(`- [${t.status || '?'}] ${sliceText(t.text || t.title || '', 120)}`);
    }
  }
  const withStats = messages.filter((m) => m && m.role === 'assistant' && m.changedStats);
  if (withStats.length > 0) {
    const latest = withStats[withStats.length - 1].changedStats;
    lines.push('', en ? '## Latest changes' : '## 최근 변경');
    lines.push(`+${latest.added || 0} -${latest.deleted || 0}${latest.files ? ` (${latest.files} files)` : ''}`);
    const files = messages
      .filter((m) => m && Array.isArray(m.changedFiles))
      .flatMap((m) => m.changedFiles)
      .filter((f, i, arr) => typeof f === 'string' && arr.indexOf(f) === i)
      .slice(-15);
    for (const f of files) lines.push(`- ${f}`);
  }
  const verified = messages.filter((m) => m && m.role === 'assistant' && m.verify && typeof m.verify === 'object');
  if (verified.length > 0) {
    const v = verified[verified.length - 1].verify;
    lines.push('', en ? '## Latest verify' : '## 최근 검증');
    lines.push(`${v.command || ''} → exit ${v.code ?? '?'}${v.output ? ` — ${sliceText(v.output, 200)}` : ''}`);
  }
  if (lastUser) {
    lines.push('', en ? '## Last user request' : '## 마지막 요청');
    lines.push(sliceText(lastUser.text, 500));
  }
  if (lastAi) {
    lines.push('', en ? '## Last assistant reply' : '## 마지막 답변');
    lines.push(sliceText(lastAi.text, 800));
  }
  const note = lines.join('\n');
  return note.length <= HANDOFF_CAP ? note : `${note.slice(0, HANDOFF_CAP)}…`;
}
