// Codex-style composer slash commands. Every entry maps to an affordance
// that already exists (palette action, view, or dialog) — the popup is a
// shortcut, not a new backend.
export const SLASH_COMMANDS = [
  { id: 'new', name: '/new', title: '새 스레드', hint: '대화 새로 시작', keywords: ['new chat', 'new thread', '새 대화'] },
  { id: 'model', name: '/model', title: '모델·권한·추론 설정', hint: '튜닝 팝오버 열기', keywords: ['model tune', 'reasoning', 'approval', '모델 변경', '추론'] },
  { id: 'usage', name: '/usage', title: '사용량 보기', hint: '구독 할당량과 토큰', keywords: ['usage', 'quota', 'tokens', '사용량', '할당량'] },
  { id: 'settings', name: '/settings', title: '설정 열기', hint: 'CLI·테마·단축키', keywords: ['settings', 'preferences', '설정'] },
  { id: 'shortcuts', name: '/shortcuts', title: '단축키 도움말', hint: '키보드 단축키 보기', keywords: ['shortcuts', 'keys', '단축키'] },
  { id: 'schedule', name: '/schedule', title: '예약된 프롬프트 관리', hint: '예약 목록과 취소', keywords: ['schedule', 'reservation', 'timer', '예약'] },
  { id: 'export', name: '/export', title: '대화 내보내기', hint: 'Markdown으로 저장', keywords: ['export', 'markdown', '내보내기'] },
  { id: 'diff', name: '/diff', title: '변경 사항 보기', hint: '파일 탐색기 열기', keywords: ['diff', 'changes', 'git', '변경', '차이'] },
  { id: 'terminal', name: '/terminal', title: '터미널 열기', hint: '새 터미널 탭', keywords: ['terminal', 'shell', '터미널', '셸'] },
];

// Fires only when the input itself starts with '/' and the caret is still
// inside that first token (no whitespace crossed).
export function findSlashCommand(input, caret) {
  const text = String(input || '');
  const pos = Number.isInteger(caret) ? caret : text.length;
  if (!text.startsWith('/') || pos < 1 || pos > text.length) return null;
  const head = text.slice(0, pos);
  if (/[\s]/.test(head)) return null;
  return { query: head.slice(1) };
}

function slashScore(cmd, q) {
  if (!q) return 0;
  const name = cmd.name.slice(1).toLowerCase();
  if (name.startsWith(q)) return 300 - name.length;
  const haystacks = [cmd.title, cmd.hint, ...(cmd.keywords || [])].map((s) => String(s || '').toLowerCase());
  if (name.includes(q)) return 200 - name.indexOf(q);
  for (const hay of haystacks) {
    if (hay.includes(q)) return 100 - hay.indexOf(q) * 0.1;
  }
  return -1;
}

export function matchSlashCommands(query, limit = 16) {
  const q = String(query || '').trim().toLowerCase();
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 16;
  return SLASH_COMMANDS.map((cmd, order) => ({ cmd, order, score: slashScore(cmd, q) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, cap)
    .map((item) => item.cmd);
}
