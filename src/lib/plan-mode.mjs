// Plan mode: read-only exploration turns that produce an execution plan,
// approved (or refined) before anything runs for real. Enforcement is at
// the engine level — `muse exec/serve --disable-write --disable-shell` —
// the prompt below only directs the shape of the answer.

export const PLAN_FLAGS = ['--disable-write', '--disable-shell'];
// Namespaces shared with electron/main.js + electron/msp.js (CJS, cannot
// import this ESM file): plan-mode-test asserts the literals stay in sync.
export const PLAN_THREAD_SUFFIX = '\0plan';
export const READONLY_HOST_SUFFIX = '\0readonly';

export function planModeKey(sessionId) {
  return `mudex:plan-mode:v1:${String(sessionId || '')}`;
}

export function readPlanMode(storage, sessionId) {
  try {
    return storage ? storage.getItem(planModeKey(sessionId)) === '1' : false;
  } catch {
    return false;
  }
}

export function writePlanMode(storage, sessionId, on) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    if (on) storage.setItem(planModeKey(sessionId), '1');
    else storage.removeItem(planModeKey(sessionId));
    return true;
  } catch {
    return false;
  }
}

export function planThreadKey(threadKey) {
  return `${String(threadKey || '')}${PLAN_THREAD_SUFFIX}`;
}

export function isPlanThreadKey(key) {
  return typeof key === 'string' && key.endsWith(PLAN_THREAD_SUFFIX);
}

export function matchesSessionThread(threadKey, sessionId) {
  const id = String(sessionId || '');
  return String(threadKey || '') === id || String(threadKey || '') === planThreadKey(id);
}

export function readonlyHostKey(cwd) {
  return `${cwd || '__default__'}${READONLY_HOST_SUFFIX}`;
}

const PLAN_PROMPT = {
  ko: '[계획 모드] 아래 요청을 실행하지 말고, 읽기 전용으로 탐색한 뒤 실행 계획을 세워줘.\n규칙: 파일을 만들거나 수정·삭제하지 마. 셸 명령도 실행하지 마. 읽기 전용 도구로만 살펴봐.\n출력: 1) 핵심 발견(관련 파일 경로 포함) 2) 단계별 실행 계획 3) 주의점.\n\n요청:\n',
  en: '[Plan mode] Do NOT carry out the request below. Explore read-only, then write an execution plan.\nRules: never create, modify, or delete files. Never run shell commands. Use read-only tools only.\nOutput: 1) key findings (with relevant file paths) 2) step-by-step plan 3) caveats.\n\nRequest:\n',
};

export function buildPlanPrompt(text, lang = 'ko') {
  const prefix = PLAN_PROMPT[lang === 'en' ? 'en' : 'ko'];
  return `${prefix}${String(text == null ? '' : text)}`;
}

const EXECUTE_PROMPT = {
  ko: '위 계획을 실행해줘. 계획에 없는 변경은 하지 마. 먼저 할 일을 간단히 말하고 시작해.\n\n계획:\n',
  en: 'Execute the plan above. Do not make changes outside the plan. Briefly state what you will do, then start.\n\nPlan:\n',
};

export function buildExecutePrompt(planText, lang = 'ko') {
  const prefix = EXECUTE_PROMPT[lang === 'en' ? 'en' : 'ko'];
  return `${prefix}${String(planText == null ? '' : planText)}`;
}
