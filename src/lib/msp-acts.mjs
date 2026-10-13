// Live activity rows for the streaming bubble: one row per in-flight tool
// call, user shell, or subagent. Shell rows carry an expandable detail
// (full command, output tail, error, duration, exit code); edit/write rows
// carry the full file path for the viewer link. Display targets stay
// truncated; detail and file paths never are.
import { STRINGS } from './i18n.mjs';

const TOOL_LABEL_KEY = {
  read: 'toolRead',
  edit: 'toolEdit',
  write: 'toolWrite',
  shell: 'toolShell',
  bash: 'toolShell',
  glob: 'toolGlob',
  grep: 'toolGrep',
  list: 'toolList',
};

const SHELL_TOOLS = new Set(['shell', 'bash']);
const FILE_TOOLS = new Set(['edit', 'write']);
const TARGET_CAP = 80;
export const OUTPUT_CAP = 2000;

function shortHead(s) {
  const one = String(s).replace(/\s+/g, ' ');
  return one.length > TARGET_CAP ? `${one.slice(0, TARGET_CAP - 1)}…` : one;
}

function shortTail(s) {
  const t = String(s);
  return t.length > TARGET_CAP ? `…${t.slice(-(TARGET_CAP - 1))}` : t;
}

function argsObject(args) {
  if (typeof args !== 'string' || !args) return null;
  try {
    const o = JSON.parse(args);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

function argsTarget(o) {
  const t = o?.path || o?.file || o?.filePath || o?.target || o?.command || o?.cmd || o?.pattern || o?.query;
  return typeof t === 'string' && t ? t : '';
}

export function mspTarget(it) {
  const a = it?.args;
  if (typeof a === 'string' && a) {
    const o = argsObject(a);
    if (o) {
      const t = argsTarget(o);
      if (t) return shortTail(t);
    }
    return shortHead(a);
  }
  return it?.displayText || it?.fallbackText || '';
}

export function mspFullTarget(it) {
  const a = it?.args;
  if (typeof a === 'string' && a) {
    const o = argsObject(a);
    if (o) {
      const t = argsTarget(o);
      if (t) return t;
    }
    return a.replace(/\s+/g, ' ');
  }
  return it?.displayText || it?.fallbackText || '';
}

// Full file path for viewer links (edit/write only). Strict: a JSON path
// key or nothing — never a raw command string.
export function mspFilePath(it) {
  const o = argsObject(it?.args);
  if (!o) return '';
  const t = o?.path || o?.file || o?.filePath || o?.target;
  return typeof t === 'string' ? t.trim() : '';
}

export function tailOutput(s, cap = OUTPUT_CAP) {
  const t = String(s || '');
  if (t.length <= cap) return t;
  return `…\n${t.slice(-cap)}`;
}

export function foldMspActs(items, lang = 'ko') {
  const cv = (STRINGS[lang] && STRINGS[lang].chat) || STRINGS.ko.chat;
  const out = [];
  if (!items || typeof items.values !== 'function') return out;
  for (const it of items.values()) {
    if (!it || (it.kind !== 'toolCall' && it.kind !== 'userShell' && it.kind !== 'subagent')) continue;
    const tool = it.tool || it.kind;
    const live = it.status === 'inProgress';
    const key = TOOL_LABEL_KEY[tool];
    const isShell = SHELL_TOOLS.has(tool) || it.kind === 'userShell';
    const full = isShell ? mspFullTarget(it) : '';
    const file = !isShell && FILE_TOOLS.has(tool) ? mspFilePath(it) : '';
    out.push({
      key: it.itemId,
      tool,
      toolLabel: (key && cv[key]) || tool,
      target: mspTarget(it),
      statusLabel:
        live
          ? cv.actRunning
          : it.status === 'failed'
            ? cv.actFailed
            : it.status === 'completed'
              ? cv.actDone
              : it.status || '',
      live,
      detail: isShell
        ? {
            full,
            output: tailOutput(it.visibleOutput),
            error: it.failureReason || it.message || '',
            durationMs: typeof it.durationMs === 'number' ? it.durationMs : null,
            exitCode: typeof it.exitCode === 'number' ? it.exitCode : null,
          }
        : null,
      file: file || null,
    });
  }
  return out;
}
