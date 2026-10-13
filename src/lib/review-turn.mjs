// Independent review turns: a separate read-only agent pass over the working
// tree, posted as its own message. Enforcement mirrors plan mode —
// `muse exec/serve --disable-write --disable-shell` plus a namespaced
// `\0review` thread/host — the prompt below only shapes the findings.
// Review turns never touch the main session: fresh review session, no
// checkpoint, no msp-session adoption (same contract as plan turns).
export const REVIEW_THREAD_SUFFIX = '\0review';
export const REVIEW_READONLY_SUFFIX = '\0readonly';

export function reviewThreadKey(threadKey) {
  return `${String(threadKey || '')}${REVIEW_THREAD_SUFFIX}`;
}

export function isReviewThreadKey(key) {
  return typeof key === 'string' && key.endsWith(REVIEW_THREAD_SUFFIX);
}

export function matchesReviewThread(threadKey, sessionId) {
  const id = String(sessionId || '');
  return String(threadKey || '') === id || String(threadKey || '') === reviewThreadKey(id);
}

const REVIEW_PROMPT = {
  ko: '[독립 리뷰] 아래 변경 파일 목록을 읽기 전용으로 검토하고 문제점을 지적해줘.\n규칙: 파일을 만들거나 수정·삭제하지 마. 셸 명령도 실행하지 마. 읽기 전용 도구로 파일을 직접 읽고 판단해.\n출력: 1) 한 줄 총평 2) 지적 사항 (심각도[높음/중간/낮음] · 파일:줄 · 내용) 3) 문제없으면 "문제없음".\n\n변경 파일:\n',
  en: '[Independent review] Review the changed files below read-only and report issues.\nRules: never create, modify, or delete files. Never run shell commands. Read the files yourself with read-only tools.\nOutput: 1) one-line verdict 2) findings ([high/medium/low] · file:line · note) 3) "No issues" when clean.\n\nChanged files:\n',
};

export function buildReviewPrompt(files, lang = 'ko') {
  const prefix = REVIEW_PROMPT[lang === 'en' ? 'en' : 'ko'];
  const list = Array.isArray(files) ? files.filter((f) => typeof f === 'string' && f.trim()).slice(0, 50) : [];
  return `${prefix}${list.length > 0 ? list.join('\n') : (lang === 'en' ? '(no changed files)' : '(변경 파일 없음)')}`;
}
