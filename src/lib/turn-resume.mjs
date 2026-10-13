// Exact resume: rebuild a stopped turn from its durable record instead of
// a bare text tail. The engine session (when the link survived) already
// resumes server-side; this block restores what the engine cannot know —
// the original request, the tools that already ran, open todos, and the
// verify outcome — so the new turn continues instead of restarting.
// Everything is capped; absent pieces are skipped, never invented.
export const RESUME_TAIL_CAP = 3000;
export const RESUME_TOOL_CAP = 10;

function sliceOneLine(text, cap) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (s.length <= cap) return s;
  return `${s.slice(0, cap)}…`;
}

function toolLine(t) {
  if (!t || typeof t !== 'object') return '';
  const label = String(t.tool || t.kind || 'tool');
  const target = t.target ? ` ${sliceOneLine(t.target, 120)}` : '';
  const status = t.status ? ` (${t.status}${t.exitCode !== null && t.exitCode !== undefined ? `, exit ${t.exitCode}` : ''})` : '';
  const err = t.error ? ` — ${sliceOneLine(t.error, 120)}` : '';
  return `- ${label}${target}${status}${err}`;
}

function todoLine(t) {
  if (!t || typeof t !== 'object') return '';
  return `- [${t.status || '?'}] ${sliceOneLine(t.text || t.title || '', 120)}`;
}

// MspTodo marks finished work `completed` (`cancelled` is dropped work, not
// open work) — anything else still needs doing.
function isOpenTodo(t) {
  return !!t && typeof t === 'object' && t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'done';
}

function verifyLine(v, en) {
  if (!v || typeof v !== 'object') return '';
  const what = sliceOneLine(v.script || v.command || '', 120);
  const tail = sliceOneLine(v.tail || v.output || v.error || '', 200);
  return `${what || (en ? 'verify' : '검증')} → exit ${v.code ?? '?'}${tail ? ` — ${tail}` : ''}`;
}

export function formatResumeContext(message, request, lang = 'ko') {
  const en = lang === 'en';
  const m = message && typeof message === 'object' ? message : {};
  const lines = [];
  const req = String(request || '').trim();
  if (req) {
    lines.push(en ? '## Original request' : '## 원래 요청');
    lines.push(sliceOneLine(req, 500));
  }
  const tools = Array.isArray(m.tools) ? m.tools.filter(Boolean).slice(0, RESUME_TOOL_CAP) : [];
  if (tools.length > 0) {
    lines.push('', en ? '## Tools already run (do not repeat)' : '## 이미 실행한 도구 (반복하지 마)');
    for (const t of tools) {
      const line = toolLine(t);
      if (line) lines.push(line);
    }
  }
  const todos = Array.isArray(m.todos) ? m.todos.filter(isOpenTodo) : [];
  if (todos.length > 0) {
    lines.push('', en ? '## Still open' : '## 아직 남은 일');
    for (const t of todos.slice(0, 10)) lines.push(todoLine(t));
  }
  // Verify records arrive as an array (one per script); the latest verdict
  // is what the resumed turn must honor.
  const verifies = Array.isArray(m.verify) ? m.verify.filter((v) => v && typeof v === 'object') : [];
  if (verifies.length > 0) {
    lines.push('', en ? '## Last verify' : '## 마지막 검증');
    lines.push(verifyLine(verifies[verifies.length - 1], en));
  }
  const tail = String(m.text || '');
  if (tail.trim()) {
    lines.push('', en ? '## Last output' : '## 마지막 출력');
    const capped = tail.length > RESUME_TAIL_CAP ? `…\n${tail.slice(-RESUME_TAIL_CAP)}` : tail;
    lines.push(capped);
  }
  return lines.join('\n');
}

export function buildExactResumePrompt(message, request, { lang = 'ko', engineSession = false } = {}) {
  const en = lang === 'en';
  const head = engineSession
    ? en ? 'Continue exactly where the stopped turn left off. The session is still linked, so keep its context and proceed.'
      : '중단된 턴이 멈춘 지점부터 정확히 이어서 계속해. 세션 연결은 살아 있으니 그 문맥을 유지하고 진행해.'
    : en ? 'Continue the stopped run. The session link is gone, so the record below is the full handoff — do not restart completed work.'
      : '중단된 실행을 이어서 계속해. 세션 연결은 끊겼으니 아래 기록이 전부야 — 끝낸 작업은 다시 하지 마.';
  const ctx = formatResumeContext(message, request, lang);
  return ctx ? `${head}\n\n${ctx}` : head;
}
