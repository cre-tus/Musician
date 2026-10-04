import type { ChatMessage, CliSettings, MudexApi, Session } from '../types';
import { normalizePathForComparison } from './path-utils.mjs';
export { normalizeCommitMessage, porcelainPath, porcelainStaged, porcelainStatus } from './git-status.mjs';

export function hasBridge(): boolean {
  return typeof window !== 'undefined' && !!window.mudex;
}

export function api(): MudexApi {
  if (!window.mudex) throw new Error('Musician bridge missing — run inside the Electron app (npm run dev).');
  return window.mudex;
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Mirrors electron/main.js splitArgs plus electron/spawn-cli.js quoteArg and
// needsShell (modulo the platform check — the app ships win-only).
// Keep the copies in sync: argv = ['exec', ...extraArgs, --model?, prompt-LAST].
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of String(s || '')) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function quoteArg(a: string): string {
  const s = String(a);
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

export function needsShell(file: string): boolean {
  return /\.(cmd|bat)$/i.test(String(file || ''));
}

export function buildCmdPreview(s: CliSettings, prompt: string, cliPath?: string): string {
  const exe = cliPath || s.cliPath || 'muse';
  const base = ['exec', ...splitArgs(s.extraArgs), ...(s.model ? ['--model', s.model] : [])];
  if (needsShell(exe)) {
    // Mirrors main: the shell path passes the prompt via file.
    return [quoteArg(exe), ...base.map(quoteArg), '--prompt-file', quoteArg('<임시파일>')].join(' ');
  }
  const short = prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt;
  return [quoteArg(exe), ...base.map(quoteArg), quoteArg(short)].join(' ');
}

// ---------------------------------------------------------------- sessions
const LS_SESSIONS = 'mudex:sessions:v1';
const LS_FOLDER = 'mudex:folder:v1';

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(LS_SESSIONS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function safeStringify(v: unknown): string | null {
  const seen = new Set();
  try {
    return JSON.stringify(v, (_k, val) => {
      if (typeof val === 'bigint') return Number(val);
      if (typeof val === 'function' || typeof val === 'symbol') return undefined;
      if (val && typeof val === 'object') {
        if (seen.has(val)) return '[ Circular ]';
        seen.add(val);
      }
      return val;
    });
  } catch {
    return null;
  }
}

const SAVE_TEXT_CAP = 50000;
const SAVE_TAIL_CAP = 4000;

export function trimMessageForSave(m: ChatMessage): ChatMessage {
  const cut = (t: string | undefined, cap: number): string | undefined => {
    if (typeof t !== 'string' || t.length <= cap) return t;
    const head = Math.ceil(cap * 0.7);
    const tail = Math.max(0, cap - head);
    return `${t.slice(0, head)}\n…(중간 ${t.length - cap}자 생략)…\n${tail > 0 ? t.slice(t.length - tail) : ''}`;
  };
  const out: ChatMessage = { ...m, text: cut(m.text, SAVE_TEXT_CAP) ?? '' };
  if (m.stderr !== undefined) out.stderr = cut(m.stderr, SAVE_TAIL_CAP);
  if (m.verify !== undefined) out.verify = m.verify.map((v) => ({ ...v, tail: cut(v.tail, SAVE_TAIL_CAP) ?? '' }));
  return out;
}

// Full save first; on quota failure retry trimmed. One bad value or an
// oversized transcript must never wipe the whole history.
export function saveSessions(sessions: Session[]): boolean {
  try {
    const full = safeStringify(sessions);
    if (full === null) throw new Error('STRINGIFY_FAILED');
    try {
      localStorage.setItem(LS_SESSIONS, full);
      return true;
    } catch {
      const slim = safeStringify(sessions.map((s) => ({ ...s, messages: s.messages.map(trimMessageForSave) })));
      if (slim === null) return false;
      localStorage.setItem(LS_SESSIONS, slim);
      return true;
    }
  } catch {
    /* unavailable — sessions just won't persist */
    return false;
  }
}

export function newSession(cwd?: string): Session {
  return { id: uid('s'), title: '새 스레드', createdAt: Date.now(), messages: [], cwd: cwd || undefined };
}

export function sessionTitle(firstPrompt: string): string {
  const line = String(firstPrompt || '').split('\n')[0].trim();
  return line.length > 40 ? line.slice(0, 40) + '…' : line || '새 스레드';
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return '방금';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}달`;
  return `${Math.floor(mo / 12)}년`;
}

export function loadFolder(): string {
  try {
    return localStorage.getItem(LS_FOLDER) || '';
  } catch {
    return '';
  }
}

export function saveFolder(folder: string): void {
  try {
    localStorage.setItem(LS_FOLDER, folder);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- projects
const LS_PROJECTS = 'mudex:projects:v1';

export function loadProjects(): string[] {
  try {
    const raw = localStorage.getItem(LS_PROJECTS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((p): p is string => typeof p === 'string' && !!p) : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: string[]): void {
  try {
    localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
  } catch {
    /* ignore */
  }
}

export function addProject(projects: string[], folder: string): string[] {
  const f = String(folder || '');
  if (!f) return projects;
  return projects.includes(f) ? projects : [...projects, f];
}

export function removeProject(projects: string[], folder: string): string[] {
  const key = normalizePathForComparison(folder);
  if (!key) return projects;
  return projects.filter((p) => normalizePathForComparison(p) !== key);
}

// ---------------------------------------------------------------- editor
const LANGS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
};

export function languageFromPath(p: string): string {
  const ext = String(p || '').split('.').pop()?.toLowerCase() || '';
  return LANGS[ext] || 'plaintext';
}
