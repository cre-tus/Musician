import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangedStat, ChatMessage, ClaudeSessionInfo, CliSettings, CliStatus, CodexSessionInfo, MspApproval, MspItem, MspTodo, MspUserInputPrompt, Session, SubscriptionUsage, TokenWindow } from '../types';
import ApprovalPanel from './ApprovalPanel';
import GoalsPanel from './GoalsPanel';
import MspUserInputCard from './MspUserInputCard';
import type { ConfirmOptions, ConfirmResult } from './ConfirmDialog';
import { api, buildCmdPreview, hasBridge, porcelainPath, uid } from '../lib/mudex';
import { baseName } from '../lib/path-utils.mjs';
import { enqueuePrompt, extractQueuedPrompt, MAX_QUEUED_PROMPTS, moveQueuedPrompt, normalizePromptQueue, prependPrompt, removeQueuedPrompt, shouldAutoRunQueuedPrompt, takeNextPrompt } from '../lib/prompt-queue.mjs';
import { armInterruptChain, buildResumePrompt, emptyInterruptChain, flattenInterruptChain, normalizeInterruptChain, popInterruptChain } from '../lib/interrupt-turn.mjs';
import type { InterruptChain } from '../lib/interrupt-turn.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { runNotificationStatus, shouldShowBackgroundNotification } from '../lib/notification-rules.mjs';
import { clampChatScrollTop, parseChatScrollState } from '../lib/chat-scroll-state.mjs';
import { formatSessionTranscript } from '../lib/session-transcript.mjs';
import { findPromptFileMention, insertPromptFileMention } from '../lib/prompt-file-mention.mjs';
import { findSlashCommand, matchSlashCommands, SLASH_COMMANDS } from '../lib/slash-commands.mjs';
import type { SlashCommand } from '../lib/slash-commands.mjs';
import type { Goal, GoalStore } from '../lib/goals.mjs';
import { MAX_GOALS, addGoal, createGoal, normalizeGoalStore, startGoalInSession } from '../lib/goals.mjs';
import { activeLinkedGoal, applyGoalContext, buildGoalKick } from '../lib/goal-prompt.mjs';
import remarkGfm from 'remark-gfm';
import { expandCustomSlash, findCustomSlash, matchCustomSlashCommands, readCustomSlashCommands } from '../lib/custom-slash.mjs';
import type { CustomSlashCommand, CustomSlashMatch } from '../lib/custom-slash.mjs';
import { formatCompactTokens, summarizeSessionContext } from '../lib/session-context.mjs';
import { latestChangeSummary } from '../lib/run-change-summary.mjs';
import { buildExecutePrompt, buildPlanPrompt, planThreadKey, readPlanMode, writePlanMode } from '../lib/plan-mode.mjs';
import { resolveEffort, resolveModel, sanitizeEffort, sanitizeModel, sendOverrides } from '../lib/session-overrides.mjs';
import { APPROVAL_MODE_VALUES, approvalModeLabel, sanitizeApprovalMode } from '../lib/approval-modes.mjs';
import { mcpChatNotice } from '../lib/mcp-chat-notice.mjs';
import { formatStr, STRINGS } from '../lib/i18n.mjs';
import { useLang, useStrings } from '../lib/lang';
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipIcon,
  ClockIcon,
  CopyIcon,
  DiffIcon,
  ExportIcon,
  FileIcon,
  FileTypeIcon,
  FolderIcon,
  ForkIcon,
  GuitarIcon,
  MicIcon,
  PanelIcon,
  PlanIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  SlidersIcon,
  StopIcon,
  TargetIcon,
  TerminalIcon,
  XIcon,
} from './icons';

const ReactMarkdown = React.lazy(() => import('react-markdown'));

interface Props {
  session: Session;
  isActiveSession: boolean;
  paneActive: boolean;
  settings: CliSettings;
  cliResolved: string;
  cliStatus: CliStatus;
  folder: string;
  editorVisible: boolean;
  onToggleEditor: () => void;
  onAppendUser: (msg: ChatMessage) => void;
  onAppendAssistant: (msg: ChatMessage) => void;
  onTitleMaybe: (firstPrompt: string) => void;
  onInsertToEditor: (code: string) => void;
  onOpenSettings: () => void;
  onOpenGitDiff: (file: string, cwd: string) => void;
  onOpenFileAtLine: (absPath: string, line: number) => void;
  onConfirm: (options: ConfirmOptions) => Promise<ConfirmResult>;
  onRunningChange: (running: boolean) => void;
  onRegisterStop: (stop: (() => void) | null) => void;
  onMspSession: (mspSessionId: string, engine: 'msp' | 'exec') => void;
  onPatchSettings: (patch: Partial<CliSettings>) => void;
  onSessionOverride: (patch: { modelOverride?: string; effortOverride?: string }) => void;
  onForkSession: (messageId: string) => void;
  onUpdateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  onDraftStatus: (sessionId: string, hasDraft: boolean) => void;
  onQueueStatus: (sessionId: string, count: number) => void;
  onSchedulePrompt: (text: string) => void;
  onToggleGoals: () => void;
  onOpenGoals: () => void;
  goalsOpen: boolean;
  goalSetup: boolean;
  onGoalSetupChange: (v: boolean) => void;
  goalStore: GoalStore;
  onGoalStoreChange: (next: GoalStore) => void;
  goalSessions: Array<{ id: string; title: string }>;
  runningSessions: Array<{ id: string; title: string; current: boolean }>;
  onJumpToSession: (id: string) => void;
  goalGauge: Goal | null;
  onStopGoal: () => void;
  onBumpGoal: (delta: number) => void;
  scheduledFire: { sessionId: string; text: string; nonce: number } | null;
  onScheduledConsumed: (nonce: number) => void;
  onSlashCommand: (id: string) => void;
  codexSignal: number;
  claudeSignal: number;
  modelPickerSignal: number;
  paneStyle?: React.CSSProperties;
  tokenWin: { h5: TokenWindow; wk: TokenWindow };
  quota: SubscriptionUsage | null;
}

function friendlyError(err: string, lang: 'ko' | 'en' = 'ko'): string {
  const cv = STRINGS[lang].chat;
  if (err === 'CLI_NOT_FOUND')
    return cv.errCliNotFound;
  if (err.includes('EINVAL'))
    return cv.errEinval;
  if (err === 'CANCELLED') return cv.errCancelled;
  if (err.startsWith('TIMEOUT:')) return formatStr(cv.errTimeoutMs, { ms: err.slice('TIMEOUT:'.length) });
  if (err === 'TIMEOUT') return cv.errTimeout;
  return formatStr(cv.errExecFailed, { err });
}

function readPlanModeSafe(sessionId: string): boolean {
  try { return readPlanMode(localStorage, sessionId); } catch { return false; }
}

function TodoList({ items, cv }: { items: MspTodo[]; cv: Record<string, string> }) {
  const statusLabel = (s: string) =>
    s === 'completed' ? cv.todoDone : s === 'inProgress' ? cv.todoActive : s === 'cancelled' ? cv.todoCancelled : cv.todoPending;
  return (
    <ul className="todo-list">
      {items.map((t, i) => (
        <li key={`${i}:${t.text}`} className={`todo-item ${t.status}`} title={statusLabel(t.status)}>
          <span className={`todo-dot ${t.status}`} aria-hidden="true" />
          <span className="todo-text">{t.status === 'inProgress' && t.active ? t.active : t.text}</span>
        </li>
      ))}
    </ul>
  );
}

async function gitSnapshot(cwd: string): Promise<string[]> {
  if (!hasBridge() || !cwd) return [];
  try {
    const r = await api().gitStatus(cwd);
    return r.ok && r.files ? r.files : [];
  } catch {
    return [];
  }
}

function diffPaths(before: string[], after: string[]): string[] {
  const b = new Set(before);
  return after
    .filter((e) => !b.has(e))
    .map(porcelainPath)
    .filter(Boolean)
    .slice(0, 20);
}

function foldMspItems(items: Map<string, MspItem>, lang: 'ko' | 'en' = 'ko'): { text: string; activity: string } {
  const texts: string[] = [];
  const acts: string[] = [];
  for (const it of items.values()) {
    if (it.kind === 'agentMessage') {
      if (it.text) texts.push(it.text);
    } else if (it.kind === 'toolCall' || it.kind === 'userShell' || it.kind === 'subagent') {
      const name = it.tool || it.kind;
      acts.push(`${name} — ${it.status}${it.failureReason ? `: ${it.failureReason}` : ''}`);
    } else if (it.kind === 'agentError' || it.kind === 'turnError') {
      if (it.message || it.fallbackText) acts.push(formatStr(STRINGS[lang].chat.foldFailed, { msg: it.message || it.fallbackText }));
    }
  }
  return { text: texts.join('\n\n'), activity: acts.join('\n') };
}

function fmtTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtReset(ms: number, lang: 'ko' | 'en' = 'ko'): string {
  const cv = STRINGS[lang].chat;
  const d = ms - Date.now();
  if (!ms || d <= 0) return cv.resetSoon;
  const days = Math.floor(d / 86400000);
  const h = Math.floor((d % 86400000) / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  if (days > 0) return formatStr(cv.resetDays, { days, h });
  if (h > 0) return formatStr(cv.resetHours, { h, m });
  if (m > 0) return formatStr(cv.resetMins, { m });
  return cv.resetSoon;
}

function fmtDur(ms: number, lang: 'ko' | 'en' = 'ko'): string {
  const cv = STRINGS[lang].chat;
  const s = Math.round(ms / 1000);
  if (s < 60) return formatStr(cv.durSecs, { s });
  return formatStr(cv.durMinSec, { m: Math.floor(s / 60), s: s % 60 });
}

function fmtMsgTime(ts?: number, lang: 'ko' | 'en' = 'ko'): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

// Nonces already consumed per session. Module-level so a session switch
// (unmount/remount) between fire delivery and run start cannot double-fire.
const consumedFireNonce = new Map<string, number>();

const CODE_EXT = 'ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|mdx|py|rs|go|java|html|vue|yml|yaml|toml|sql|sh|ps1|cs';
const FILE_RE = new RegExp(
  `(^|[\\s([>"'])([\\w\\-.]+(?:[\\\\/][\\w\\-. ]+)*\\.(?:${CODE_EXT}))(?:\\s*\\(line\\s*(\\d+)\\)|:(\\d+)\\b)?(?=[\\s)\\].,"';:]|$)`,
  'g',
);

// Turn `path/to/file.ext (line N)` / `file.ext:N` mentions in prose into
// internal openfile links. Code spans are left untouched.
function linkifyFiles(md: string): string {
  return md
    .split(/(```[\s\S]*?```|`[^`]*`)/g)
    .map((seg, i) => {
      if (i % 2 === 1) return seg;
      return seg.replace(FILE_RE, (_m, pre: string, p: string, line1: string, line2: string) => {
        const line = Number(line1 || line2 || 1);
        const relativePath = p.replace(/\\/g, '/');
        const label = line1 || line2 ? `${relativePath} (line ${line})` : relativePath;
        return `${pre}[${label}](#openfile:${relativePath.replace(/ /g, '%20')}:${line})`;
      });
    })
    .join('');
}

interface MspAct {
  key: string;
  tool: string;
  toolLabel: string;
  target: string;
  statusLabel: string;
  live: boolean;
}

const TOOL_LABEL_KEY: Record<string, string> = {
  read: 'toolRead',
  edit: 'toolEdit',
  write: 'toolWrite',
  shell: 'toolShell',
  bash: 'toolShell',
  glob: 'toolGlob',
  grep: 'toolGrep',
  list: 'toolList',
};

function mspTarget(it: MspItem): string {
  const a = it.args;
  if (typeof a === 'string' && a) {
    try {
      const o = JSON.parse(a) as Record<string, unknown>;
      const t = o?.path || o?.file || o?.filePath || o?.target || o?.command || o?.cmd || o?.pattern || o?.query;
      if (typeof t === 'string' && t) return t.length > 80 ? `…${t.slice(-79)}` : t;
    } catch {
      /* not JSON */
    }
    const one = a.replace(/\s+/g, ' ');
    return one.length > 80 ? `${one.slice(0, 79)}…` : one;
  }
  return it.displayText || it.fallbackText || '';
}

function foldMspActs(items: Map<string, MspItem>, lang: 'ko' | 'en' = 'ko'): MspAct[] {
  const cv = STRINGS[lang].chat;
  const out: MspAct[] = [];
  for (const it of items.values()) {
    if (it.kind !== 'toolCall' && it.kind !== 'userShell' && it.kind !== 'subagent') continue;
    const tool = it.tool || it.kind;
    const live = it.status === 'inProgress';
    out.push({
      key: it.itemId,
      tool,
      toolLabel: (TOOL_LABEL_KEY[tool] && cv[TOOL_LABEL_KEY[tool]]) || tool,
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
    });
  }
  return out;
}

function extractText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) return extractText((node.props as { children?: unknown }).children);
  return '';
}

function CodeBlock({
  lang,
  code,
  onInsert,
}: {
  lang: string;
  code: string;
  onInsert: (code: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const cv = useStrings().chat;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{lang || 'code'}</span>
        <div className="codeblock-actions">
          <button className="mini-btn" onClick={copy} title={cv.codeCopy}>
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            {copied ? cv.codeCopied : cv.codeCopy}
          </button>
          <button className="mini-btn" onClick={() => onInsert(code)} title={cv.codeInsertTitle}>
            {cv.codeInsert}
          </button>
        </div>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const CHAT_MODELS = ['muse-spark-1.3', 'muse-spark-1.2'];

interface AttachedFile {
  path: string;
  name: string;
  content: string;
  image: boolean;
  dataUrl?: string;
}

const MAX_ATTACH_CHARS = 100000;

interface SpeechRecog {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export default function ChatView(props: Props) {
  const { session, settings, cliStatus, folder, editorVisible, onToggleEditor, tokenWin, quota } = props;
  const lang = useLang();
  const strings = useStrings();
  const cv = strings.chat;
  const gt = strings.goals;
  // The chat-event subscription below mounts once; handlers read the live
  // language through this ref (same pattern as cbRef for props).
  const langRef = useRef(lang);
  langRef.current = lang;
  const examples = [cv.ex0, cv.ex1, cv.ex2];
  const reasoningEfforts: [string, string][] = [
    ['', strings.settings.cliDefault],
    ['none', cv.effNone],
    ['minimal', cv.effMinimal],
    ['low', cv.effLow],
    ['medium', cv.effMedium],
    ['high', cv.effHigh],
    ['xhigh', cv.effXhigh],
    ['max', cv.effMax],
    ['ultra', cv.effUltra],
  ];
  const effortLevels = reasoningEfforts.filter(([v]) => v !== '');
  const h5Total = tokenWin.h5.input + tokenWin.h5.output;
  const wkTotal = tokenWin.wk.input + tokenWin.wk.output;
  const wUsed = quota?.window.usedPercent;
  const kUsed = quota?.weekly.usedPercent;
  const wRem = typeof wUsed === 'number' ? Math.max(0, 100 - wUsed) : null;
  const kRem = typeof kUsed === 'number' ? Math.max(0, 100 - kUsed) : null;
  const ctxSummary = useMemo(() => summarizeSessionContext(session.messages), [session.messages]);
  const runSummary = useMemo(() => latestChangeSummary(session.messages), [session.messages]);
  const [runStripOpen, setRunStripOpen] = useState(false);
  useEffect(() => { setRunStripOpen(false); }, [runSummary?.messageId]);
  const draftKey = `mudex:draft:${session.id}`;
  const queueKey = `mudex:queue:${session.id}`;
  const queuePausedKey = `mudex:queue-paused:${session.id}`;
  const interruptKey = `mudex:interrupt:${session.id}`;
  const scrollPositionKey = `mudex:chat-scroll:v1:${session.id}`;
  const initialChatScroll = useMemo(() => {
    try { return parseChatScrollState(localStorage.getItem(scrollPositionKey) || ''); } catch { return null; }
  }, [scrollPositionKey]);
  const [input, setInput] = useState(() => {
    try { return localStorage.getItem(draftKey) || ''; } catch { return ''; }
  });
  const [fileMention, setFileMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [fileMentionResults, setFileMentionResults] = useState<{ path: string; relativePath: string }[]>([]);
  const [fileMentionIndex, setFileMentionIndex] = useState(0);
  const [fileMentionLoading, setFileMentionLoading] = useState(false);
  const [slash, setSlash] = useState<{ query: string } | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [customSlashCmds, setCustomSlashCmds] = useState<CustomSlashCommand[]>(() => {
    try { return readCustomSlashCommands(localStorage, SLASH_COMMANDS.map((c) => c.id)); } catch { return []; }
  });
  const [customSlashArgs, setCustomSlashArgs] = useState<{ name: string; args: string; template: string; desc: string } | null>(null);
  type SlashRow = SlashCommand | CustomSlashMatch;
  const slashResults: SlashRow[] = useMemo(() => {
    if (customSlashArgs) {
      return [{
        id: `custom:${customSlashArgs.name}`,
        name: `/${customSlashArgs.name}`,
        title: customSlashArgs.desc || `/${customSlashArgs.name}`,
        hint: customSlashArgs.args,
        keywords: [],
        kind: 'custom',
        template: customSlashArgs.template,
      }];
    }
    if (!slash) return [];
    return [...matchSlashCommands(slash.query, 16, lang), ...matchCustomSlashCommands(slash.query, customSlashCmds, 16)].slice(0, 16);
  }, [slash, customSlashArgs, customSlashCmds, lang]);
  const slashOpen = !!(slash || customSlashArgs);
  // Settings edits land in localStorage while this pane is hidden; reload on return.
  useEffect(() => {
    if (!props.paneActive) return;
    try { setCustomSlashCmds(readCustomSlashCommands(localStorage, SLASH_COMMANDS.map((c) => c.id))); } catch { /* keep previous */ }
  }, [props.paneActive]);
  // Plan mode is per session; a pending plan belongs to its own turn only.
  useEffect(() => {
    setPlanMode(readPlanModeSafe(session.id));
    setPendingPlan(null);
    planTurnRef.current = false;
    liveTodosRef.current = [];
    setLiveTodos([]);
  }, [session.id]);
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(queueKey) || '[]');
      return normalizePromptQueue(saved);
    } catch { return []; }
  });
  const [queuePaused, setQueuePaused] = useState(() => {
    try { return localStorage.getItem(queuePausedKey) === 'true'; } catch { return false; }
  });
  const queuedPromptsRef = useRef(queuedPrompts);
  const slashQueryRef = useRef<string | null>(null);
  const draftOwnerRef = useRef(session.id);
  const promptHistoryIndexRef = useRef<number | null>(null);
  const promptHistoryDraftRef = useRef('');
  const previousRunRef = useRef(false);
  const queueDrainAllowedRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const turnPromptRef = useRef('');
  const lastTurnEndRef = useRef<{ completed: boolean; partial: string }>({ completed: false, partial: '' });
  const interruptChainRef = useRef(emptyInterruptChain());
  const [run, setRun] = useState<{ reqId: string; cmd: string; cwd: string } | null>(null);
  const [streamText, setStreamText] = useState('');
  const [streamStderr, setStreamStderr] = useState('');
  const [streamActivity, setStreamActivity] = useState('');
  const [mspActs, setMspActs] = useState<MspAct[]>([]);
  const [verifyScripts, setVerifyScripts] = useState<string[]>([]);
  const [verifyRunning, setVerifyRunning] = useState<{ msgId: string; script: string } | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<MspApproval[]>([]);
  const [userInputs, setUserInputs] = useState<MspUserInputPrompt[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const runEngineRef = useRef<'msp' | 'exec'>('exec');
  const mspItemsRef = useRef(new Map<string, MspItem>());
  const [notice, setNotice] = useState('');
  const [hostModels, setHostModels] = useState<{ modelId: string; displayLabel: string }[]>([]);
  const [attach, setAttach] = useState<AttachedFile[]>([]);
  const [planMode, setPlanMode] = useState(() => readPlanModeSafe(session.id));
  const [pendingPlan, setPendingPlan] = useState<{ msgId: string; text: string } | null>(null);
  const planTurnRef = useRef(false);
  const turnCheckpointRef = useRef<string | null>(null);
  const [liveTodos, setLiveTodos] = useState<MspTodo[]>([]);
  const liveTodosRef = useRef<MspTodo[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [dropPathActive, setDropPathActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [micOn, setMicOn] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const [approvalMenuOpen, setApprovalMenuOpen] = useState(false);
  const approvalMenuRef = useRef<HTMLDivElement | null>(null);
  const [sessionOnlyModel, setSessionOnlyModel] = useState(true);
  const recogRef = useRef<SpeechRecog | null>(null);
  const reqRef = useRef<string | null>(null);
  const runRef = useRef<{ reqId: string; cmd: string; cwd: string; turnId?: string; mspSessionId?: string } | null>(null);
  const turnUsageRef = useRef<{ inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number } | null>(null);
  const streamRef = useRef({ text: '', stderr: '' });
  const runStartRef = useRef(0);
  const beforeRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollStateRef = useRef(initialChatScroll || { scrollTop: 0, follow: true });
  const followScrollRef = useRef(initialChatScroll?.follow ?? true);
  const scrollSaveTimerRef = useRef<number | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const persistChatScrollRef = useRef<() => void>(() => {});
  persistChatScrollRef.current = () => {
    try { localStorage.setItem(scrollPositionKey, JSON.stringify(chatScrollStateRef.current)); } catch { /* optional reading position */ }
  };
  useEffect(() => {
    let cancelled = false;
    const term = fileMention?.query || '';
    if (!fileMention || !term || !props.folder || !hasBridge()) {
      setFileMentionResults([]);
      setFileMentionLoading(false);
      setFileMentionIndex(0);
      return;
    }
    setFileMentionResults([]);
    setFileMentionLoading(true);
    setFileMentionIndex(0);
    const timer = window.setTimeout(() => {
      api().searchFiles(props.folder, term, { scope: 'file-mention' }).then((result) => {
        if (cancelled || result.error === 'CANCELLED') return;
        setFileMentionResults(result.ok ? (result.files || []).slice(0, 8) : []);
      }).catch(() => {
        if (!cancelled) setFileMentionResults([]);
      }).finally(() => {
        if (!cancelled) setFileMentionLoading(false);
      });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileMention?.query, props.folder]);
  useEffect(() => {
    if (!fileMention || !fileMentionResults[fileMentionIndex]) return;
    document.getElementById(`composer-file-mention-${fileMentionIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [fileMention, fileMentionIndex, fileMentionResults]);

  useEffect(() => {
    if ((!slash && !customSlashArgs) || !slashResults[slashIndex]) return;
    document.getElementById(`composer-slash-${slashIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [slash, customSlashArgs, slashIndex, slashResults]);
  const [messageFindOpen, setMessageFindOpen] = useState(false);
  const [messageFindQuery, setMessageFindQuery] = useState('');
  const [messageFindIndex, setMessageFindIndex] = useState(0);
  const messageFindInputRef = useRef<HTMLInputElement | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [workspaceCopied, setWorkspaceCopied] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffProvider, setHandoffProvider] = useState<'codex' | 'claude'>('codex');
  const [codexSessions, setCodexSessions] = useState<CodexSessionInfo[]>([]);
  const [codexSelected, setCodexSelected] = useState('');
  const [codexSessionQuery, setCodexSessionQuery] = useState('');
  const [codexPreview, setCodexPreview] = useState<{ sessionId: string; context: string } | null>(null);
  const [codexPreviewLoading, setCodexPreviewLoading] = useState(false);
  const [codexPreviewError, setCodexPreviewError] = useState('');
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSessionInfo[]>([]);
  const [claudeSelected, setClaudeSelected] = useState('');
  const [claudeSessionQuery, setClaudeSessionQuery] = useState('');
  const [claudePreview, setClaudePreview] = useState<{ sessionId: string; context: string } | null>(null);
  const [claudePreviewLoading, setClaudePreviewLoading] = useState(false);
  const [claudePreviewError, setClaudePreviewError] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const handoffCardRef = useRef<HTMLElement | null>(null);
  const handoffReturnFocusRef = useRef<HTMLElement | null>(null);
  const filteredCodexSessions = useMemo(() => {
    const query = codexSessionQuery.trim().toLocaleLowerCase();
    if (!query) return codexSessions;
    return codexSessions.filter((item) => `${item.title} ${item.id}`.toLocaleLowerCase().includes(query));
  }, [codexSessions, codexSessionQuery]);
  const filteredClaudeSessions = useMemo(() => {
    const query = claudeSessionQuery.trim().toLocaleLowerCase();
    if (!query) return claudeSessions;
    return claudeSessions.filter((item) => `${item.title} ${item.id}`.toLocaleLowerCase().includes(query));
  }, [claudeSessions, claudeSessionQuery]);
  const isClaudeHandoff = handoffProvider === 'claude';
  const hoSessions = isClaudeHandoff ? claudeSessions : codexSessions;
  const hoSelected = isClaudeHandoff ? claudeSelected : codexSelected;
  const setHoSelected = isClaudeHandoff ? setClaudeSelected : setCodexSelected;
  const hoFiltered = isClaudeHandoff ? filteredClaudeSessions : filteredCodexSessions;
  const hoQuery = isClaudeHandoff ? claudeSessionQuery : codexSessionQuery;
  const setHoQuery = isClaudeHandoff ? setClaudeSessionQuery : setCodexSessionQuery;
  const hoPreview = isClaudeHandoff ? claudePreview : codexPreview;
  const hoPreviewLoading = isClaudeHandoff ? claudePreviewLoading : codexPreviewLoading;
  const hoPreviewError = isClaudeHandoff ? claudePreviewError : codexPreviewError;
  const selectedHoSessionVisible = hoFiltered.some((item) => item.id === hoSelected);

  useEffect(() => {
    if (filteredCodexSessions.length && !filteredCodexSessions.some((item) => item.id === codexSelected)) {
      setCodexSelected(filteredCodexSessions[0].id);
    }
  }, [filteredCodexSessions, codexSelected]);

  useEffect(() => {
    if (filteredClaudeSessions.length && !filteredClaudeSessions.some((item) => item.id === claudeSelected)) {
      setClaudeSelected(filteredClaudeSessions[0].id);
    }
  }, [filteredClaudeSessions, claudeSelected]);

  useEffect(() => {
    if (!handoffOpen) {
      const returnTarget = handoffReturnFocusRef.current;
      handoffReturnFocusRef.current = null;
      if (returnTarget?.isConnected) scheduleAfterPaint(() => returnTarget.focus({ preventScroll: true }));
      return;
    }
    handoffReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return scheduleAfterPaint(() => {
      const firstControl = handoffCardRef.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)');
      (firstControl || handoffCardRef.current)?.focus({ preventScroll: true });
    });
  }, [handoffOpen]);

  useEffect(() => {
    const sessions = handoffProvider === 'claude' ? claudeSessions : codexSessions;
    const selected = handoffProvider === 'claude' ? claudeSelected : codexSelected;
    const setPreview = handoffProvider === 'claude' ? setClaudePreview : setCodexPreview;
    const setLoading = handoffProvider === 'claude' ? setClaudePreviewLoading : setCodexPreviewLoading;
    const setError = handoffProvider === 'claude' ? setClaudePreviewError : setCodexPreviewError;
    if (!handoffOpen || !folder || !sessions.some((item) => item.id === selected)) {
      setPreview(null);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    setPreview(null);
    setLoading(true);
    setError('');
    const read = handoffProvider === 'claude' ? api().claudeRead(selected, folder) : api().codexRead(selected, folder);
    read.then((result) => {
      if (cancelled) return;
      if (!result.ok) throw new Error(result.error || cv.previewFailed);
      setPreview({ sessionId: selected, context: result.context || '' });
    }).catch((error: unknown) => {
      if (!cancelled) setError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [handoffOpen, handoffProvider, codexSelected, codexSessions, claudeSelected, claudeSessions, folder]);

  const messageMatches = useMemo(() => {
    const query = messageFindQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return session.messages.filter((message) => message.text.toLocaleLowerCase().includes(query)).map((message) => message.id);
  }, [session.messages, messageFindQuery]);
  const messageMatchSet = useMemo(() => new Set(messageMatches), [messageMatches]);
  const promptHistory = useMemo(
    () => session.messages.filter((message) => message.role === 'user' && !message.auto).map((message) => message.text).filter((text) => text.trim()),
    [session.messages],
  );
  const retryPrompts = useMemo(() => {
    const prompts = new Map<string, string>();
    let previousUserMessage: ChatMessage | null = null;
    for (const message of session.messages) {
      if (message.role === 'user') {
        previousUserMessage = message;
        continue;
      }
      const failedText = /^(실행 실패:|시간 초과|muse CLI를 찾을 수|CLI를 직접 실행할 수|Exec failed|Timed out|muse CLI not found|Cannot spawn the CLI)/.test(message.text);
      const failed = !message.timeout && ((typeof message.code === 'number' && message.code !== 0) || failedText);
      const includedFiles = previousUserMessage?.text.includes('[첨부:') || previousUserMessage?.text.startsWith('[첨부:');
      if (failed && previousUserMessage && !includedFiles) prompts.set(message.id, previousUserMessage.text);
    }
    return prompts;
  }, [session.messages]);
  const latestUserMessageId = [...session.messages].reverse().find((message) => message.role === 'user')?.id;

  const restorePromptToComposer = (prompt: string, notice = cv.restoreDefault) => {
    promptHistoryIndexRef.current = null;
    setInput(prompt);
    setNotice(notice);
    scheduleAfterPaint(() => {
      const inputElement = composerInputRef.current;
      inputElement?.focus();
      inputElement?.setSelectionRange(inputElement.value.length, inputElement.value.length);
    });
  };

  const insertPathAtCursor = (path: string) => {
    const textarea = composerInputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = input.slice(0, start);
    const after = input.slice(end);
    const token = `\`${path}\``;
    const insertion = `${before && !/\s$/.test(before) ? ' ' : ''}${token}${after && !/^\s/.test(after) ? ' ' : ''}`;
    const next = `${before}${insertion}${after}`;
    const cursor = before.length + insertion.length;
    promptHistoryIndexRef.current = null;
    setInput(next);
    scheduleAfterPaint(() => {
      const current = composerInputRef.current;
      current?.focus();
      current?.setSelectionRange(cursor, cursor);
    });
  };

  const acceptFileMention = (result = fileMentionResults[fileMentionIndex]) => {
    if (!fileMention || !result) return false;
    const insertion = insertPromptFileMention(input, fileMention, result.relativePath);
    promptHistoryIndexRef.current = null;
    setInput(insertion.value);
    setFileMention(null);
    scheduleAfterPaint(() => {
      const textarea = composerInputRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(insertion.cursor, insertion.cursor);
    });
    return true;
  };

  const updateFileMentionAtCaret = (textarea: HTMLTextAreaElement) => {
    if (textarea.selectionStart !== textarea.selectionEnd) {
      setFileMention(null);
      return;
    }
    setFileMention(findPromptFileMention(textarea.value, textarea.selectionStart));
  };

  const acceptSlashCommand = (index = slashIndex) => {
    const cmd = slashOpen ? slashResults[index] : undefined;
    if (!slashOpen || !cmd) return false;
    promptHistoryIndexRef.current = null;
    slashQueryRef.current = null;
    if ('kind' in cmd && cmd.kind === 'custom') {
      const args = customSlashArgs && customSlashArgs.name === cmd.name.slice(1) ? customSlashArgs.args : '';
      const expanded = expandCustomSlash(cmd.template, args);
      setInput(expanded.text);
      setNotice(cv.customExpanded);
      setFileMention(null);
      setCustomSlashArgs(null);
      setSlash(null);
      setSlashIndex(0);
      scheduleAfterPaint(() => {
        const textarea = composerInputRef.current;
        textarea?.focus();
        try { textarea?.setSelectionRange(expanded.cursor, expanded.cursor); } catch { /* caret best-effort */ }
      });
      return true;
    }
    setInput('');
    setFileMention(null);
    setCustomSlashArgs(null);
    setSlash(null);
    setSlashIndex(0);
    props.onSlashCommand(cmd.id);
    return true;
  };

  const updatePopupsAtCaret = (textarea: HTMLTextAreaElement) => {
    // Slash owns the leading token; file mentions own the rest. Never both.
    // The index resets only when the query itself changes, so ↑↓ navigation
    // (followed by a keyup that lands here) is not undone.
    const found = textarea.selectionStart === textarea.selectionEnd
      ? findSlashCommand(textarea.value, textarea.selectionStart)
      : null;
    if (found) {
      if (slashQueryRef.current !== found.query) {
        slashQueryRef.current = found.query;
        setSlashIndex(0);
      }
      setSlash(found);
      setCustomSlashArgs(null);
      setFileMention(null);
      return;
    }
    const customFound = textarea.selectionStart === textarea.selectionEnd
      ? findCustomSlash(textarea.value, textarea.selectionStart, customSlashCmds)
      : null;
    if (customFound) {
      const key = `${customFound.name} ${customFound.args}`;
      if (slashQueryRef.current !== key) {
        slashQueryRef.current = key;
        setSlashIndex(0);
      }
      setCustomSlashArgs(customFound);
      setSlash(null);
      setFileMention(null);
      return;
    }
    slashQueryRef.current = null;
    setSlash(null);
    setCustomSlashArgs(null);
    updateFileMentionAtCaret(textarea);
  };

  const navigatePromptHistory = (direction: -1 | 1) => {
    const textarea = composerInputRef.current;
    if (!textarea) return false;
    const history = [...promptHistory].reverse();
    let index = promptHistoryIndexRef.current;
    let nextValue: string;
    if (direction < 0) {
      if (index === null) {
        if (input.trim() || history.length === 0) return false;
        promptHistoryDraftRef.current = input;
        index = 0;
      } else {
        index = Math.min(index + 1, history.length - 1);
      }
      if (index < 0) return false;
      nextValue = history[index];
    } else {
      if (index === null) return false;
      if (index === 0) {
        index = null;
        nextValue = promptHistoryDraftRef.current;
      } else {
        index -= 1;
        nextValue = history[index];
      }
    }
    promptHistoryIndexRef.current = index;
    setInput(nextValue);
    scheduleAfterPaint(() => {
      const current = composerInputRef.current;
      if (!current) return;
      const position = index === null ? nextValue.length : 0;
      current.setSelectionRange(position, position);
    });
    return true;
  };

  const moveMessageMatch = (direction: 1 | -1) => {
    if (messageMatches.length === 0) return;
    setMessageFindIndex((index) => (index + direction + messageMatches.length) % messageMatches.length);
  };

  useEffect(() => {
    if (!messageFindOpen) return;
    messageFindInputRef.current?.focus();
    messageFindInputRef.current?.select();
  }, [messageFindOpen]);

  useEffect(() => {
    if (!props.paneActive) {
      setMessageFindOpen(false);
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f') {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.monaco-editor')) return;
        event.preventDefault();
        setMessageFindOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.paneActive]);

  useEffect(() => {
    if (messageMatches.length === 0) return;
    setMessageFindIndex((index) => Math.min(index, messageMatches.length - 1));
    const id = messageMatches[Math.min(messageFindIndex, messageMatches.length - 1)];
    const row = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-message-id]') || [])
      .find((element) => element.dataset.messageId === id);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [messageMatches, messageFindIndex]);

  useEffect(() => {
    try {
      if (draftOwnerRef.current !== session.id) return;
      if (input) localStorage.setItem(draftKey, input);
      else localStorage.removeItem(draftKey);
      props.onDraftStatus(session.id, !!input.trim());
    } catch { /* storage unavailable */ }
  }, [draftKey, input, session.id, props.onDraftStatus]);

  useEffect(() => {
    const onComposerInsert = (event: Event) => {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text !== 'string' || !text.trim()) return;
      promptHistoryIndexRef.current = null;
      setFileMention(null);
      setInput((current) => `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${text}`);
      setNotice(cv.composerInserted);
      scheduleAfterPaint(() => {
        const textarea = composerInputRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      });
    };
    window.addEventListener('musician:composer-insert', onComposerInsert);
    return () => window.removeEventListener('musician:composer-insert', onComposerInsert);
  }, []);

  useEffect(() => {
    if (draftOwnerRef.current === session.id) return;
    draftOwnerRef.current = session.id;
    promptHistoryIndexRef.current = null;
    try { setInput(localStorage.getItem(draftKey) || ''); } catch { setInput(''); }
  }, [draftKey, session.id]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const scrollTop = clampChatScrollTop(initialChatScroll, maxScrollTop);
    container.scrollTop = scrollTop;
    const follow = initialChatScroll?.follow ?? true;
    followScrollRef.current = follow;
    chatScrollStateRef.current = { scrollTop, follow };
    setShowScrollBottom(!follow && maxScrollTop - scrollTop >= 72);
  }, [initialChatScroll, scrollPositionKey]);

  useEffect(() => () => {
    if (scrollSaveTimerRef.current !== null) window.clearTimeout(scrollSaveTimerRef.current);
    persistChatScrollRef.current();
  }, [scrollPositionKey]);

  useEffect(() => {
    queuedPromptsRef.current = queuedPrompts;
    try {
      if (queuedPrompts.length) localStorage.setItem(queueKey, JSON.stringify(queuedPrompts));
      else localStorage.removeItem(queueKey);
    } catch { /* The in-memory queue remains usable if storage is unavailable. */ }
    props.onQueueStatus(session.id, queuedPrompts.length);
  }, [queueKey, queuedPrompts, session.id, props.onQueueStatus]);

  useEffect(() => {
    try {
      if (queuePaused) localStorage.setItem(queuePausedKey, 'true');
      else localStorage.removeItem(queuePausedKey);
    } catch { /* The queue remains usable if this preference cannot be stored. */ }
  }, [queuePausedKey, queuePaused]);

  const persistInterruptChain = (chain: InterruptChain) => {
    try {
      if (chain.pending || chain.stack.length > 0) localStorage.setItem(interruptKey, JSON.stringify(chain));
      else localStorage.removeItem(interruptKey);
    } catch { /* The in-memory chain remains usable if storage is unavailable. */ }
  };

  // A background pane unmounts the moment its run ends, starving the drain
  // effect — recover any orphaned chain into the visible queue on remount.
  useEffect(() => {
    let chain = emptyInterruptChain();
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(interruptKey) || 'null');
      if (saved) chain = normalizeInterruptChain(saved);
    } catch { /* A corrupt backup reads as empty. */ }
    if (!chain.pending && chain.stack.length === 0) return;
    try { localStorage.removeItem(interruptKey); } catch { /* The backup is consumed below regardless. */ }
    const items = flattenInterruptChain(chain, langRef.current);
    if (items.length > 0) {
      setQueuedPrompts((current) => [...items, ...normalizePromptQueue(current)].slice(0, MAX_QUEUED_PROMPTS));
      setNotice(cv.interruptQueued);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (props.paneStyle?.display === 'none') return;
    const adjustComposerHeight = () => {
      const textarea = composerInputRef.current;
      if (!textarea) return;
      textarea.style.height = 'auto';
      const maxHeight = Math.min(280, Math.max(96, Math.round(window.innerHeight * 0.36)));
      const contentHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`;
      textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
    };
    adjustComposerHeight();
    window.addEventListener('resize', adjustComposerHeight);
    return () => window.removeEventListener('resize', adjustComposerHeight);
  }, [input, props.paneStyle?.display, props.paneStyle?.flex]);

  const copyMessage = async (m: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopiedMessageId(m.id);
      window.setTimeout(() => setCopiedMessageId((id) => id === m.id ? null : id), 1800);
    } catch {
      setNotice(cv.copyMsgFailed);
    }
  };

  const exportConversation = async () => {
    if (!hasBridge()) {
      setNotice(cv.exportNeedApp);
      return;
    }
    const title = session.title.replace(/[\r\n\t]+/g, ' ').trim() || cv.exportTitle;
    const transcript = formatSessionTranscript(session, { projectFallback: folder, exportedAt: Date.now(), lang });
    try {
      const result = await api().exportMarkdown(title, transcript);
      if (!result.ok) throw new Error(result.error || cv.exportFailed);
      if (!result.canceled) setNotice(cv.exportedOk);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const loadHandoffSessions = async (provider: 'codex' | 'claude') => {
    setHandoffBusy(true);
    setHandoffError('');
    try {
      if (provider === 'claude') {
        setClaudeSessions([]);
        setClaudeSelected('');
        setClaudeSessionQuery('');
        setClaudePreview(null);
        setClaudePreviewError('');
        const r = await api().claudeSessions(folder);
        if (!r.ok) throw new Error(r.error || cv.claudeNotFound);
        const list = r.sessions || [];
        setClaudeSessions(list);
        setClaudeSelected((prev) => list.some((s) => s.id === prev) ? prev : list[0]?.id || '');
      } else {
        setCodexSessions([]);
        setCodexSelected('');
        setCodexSessionQuery('');
        setCodexPreview(null);
        setCodexPreviewError('');
        const r = await api().codexSessions(folder);
        if (!r.ok) throw new Error(r.error || cv.codexNotFound);
        const list = r.sessions || [];
        setCodexSessions(list);
        setCodexSelected((prev) => list.some((s) => s.id === prev) ? prev : list[0]?.id || '');
      }
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : String(e));
    } finally {
      setHandoffBusy(false);
    }
  };

  const openHandoff = async (provider: 'codex' | 'claude' = 'codex') => {
    if (!folder) {
      setNotice(provider === 'claude' ? cv.handoffNeedFolderClaude : cv.handoffNeedFolder);
      return;
    }
    if (!hasBridge()) {
      setNotice(provider === 'claude' ? cv.handoffNeedAppClaude : cv.handoffNeedApp);
      return;
    }
    setHandoffProvider(provider);
    setHandoffOpen(true);
    await loadHandoffSessions(provider);
  };

  const switchHandoffProvider = (provider: 'codex' | 'claude') => {
    if (provider === handoffProvider || handoffBusy) return;
    setHandoffProvider(provider);
    void loadHandoffSessions(provider);
  };

  const importFromCodex = async () => {
    if (!codexSelected) return;
    setHandoffBusy(true);
    setHandoffError('');
    try {
      const r = await api().codexRead(codexSelected, folder);
      if (!r.ok || !r.context) throw new Error(r.error || cv.codexEmpty);
      promptHistoryIndexRef.current = null;
      const draft = input;
      const draftBlock = draft.trim() ? `\n\n[Musician 작성 중인 초안 — 보존됨]\n${draft}` : '';
      setInput(`[Codex 세션에서 이어받기: ${r.title || codexSelected}]\n\n${r.context}${draftBlock}\n\n위 작업을 이어서 진행해줘.`);
      setHandoffOpen(false);
      setNotice(draft.trim() ? cv.codexImportedDraft : cv.codexImported);
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : String(e));
    } finally {
      setHandoffBusy(false);
    }
  };

  const sendToCodex = async () => {
    if (!codexSelected || run) return;
    const recent = session.messages.slice(-12).map((m) => `${m.role === 'user' ? '사용자' : 'Musician'}: ${m.text}`).join('\n\n');
    const changed = [...new Set(session.messages.flatMap((m) => m.changedFiles || []))];
    const context = [
      '[Musician에서 작업 이어받기]',
      `프로젝트: ${folder}`,
      `Musician 스레드: ${session.title}`,
      changed.length ? `변경 파일: ${changed.join(', ')}` : '',
      '',
      recent || '(아직 대화 내용 없음)',
      '',
      '같은 작업 폴더의 현재 파일 상태를 확인하고 위 작업을 이어서 진행해줘.',
    ].filter((line) => line !== '').join('\n');
    setHandoffBusy(true);
    setHandoffError('');
    try {
      const r = await api().codexQueue(codexSelected, folder, context);
      if (!r.ok) throw new Error(r.error || cv.codexSendFailed);
      setHandoffOpen(false);
      setNotice(cv.codexSent);
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : String(e));
    } finally {
      setHandoffBusy(false);
    }
  };

  const importFromClaude = async () => {
    if (!claudeSelected) return;
    setHandoffBusy(true);
    setHandoffError('');
    try {
      const r = await api().claudeRead(claudeSelected, folder);
      if (!r.ok || !r.context) throw new Error(r.error || cv.claudeEmpty);
      promptHistoryIndexRef.current = null;
      const draft = input;
      const draftBlock = draft.trim() ? `\n\n[Musician 작성 중인 초안 — 보존됨]\n${draft}` : '';
      setInput(`[Claude 세션에서 이어받기: ${r.title || claudeSelected}]\n\n${r.context}${draftBlock}\n\n위 작업을 이어서 진행해줘.`);
      setHandoffOpen(false);
      setNotice(draft.trim() ? cv.claudeImportedDraft : cv.claudeImported);
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : String(e));
    } finally {
      setHandoffBusy(false);
    }
  };

  const sendToClaude = async () => {
    if (!claudeSelected || run) return;
    const recent = session.messages.slice(-12).map((m) => `${m.role === 'user' ? '사용자' : 'Musician'}: ${m.text}`).join('\n\n');
    const changed = [...new Set(session.messages.flatMap((m) => m.changedFiles || []))];
    const context = [
      '[Musician에서 작업 이어받기]',
      `프로젝트: ${folder}`,
      `Musician 스레드: ${session.title}`,
      changed.length ? `변경 파일: ${changed.join(', ')}` : '',
      '',
      recent || '(아직 대화 내용 없음)',
      '',
      '같은 작업 폴더의 현재 파일 상태를 확인하고 위 작업을 이어서 진행해줘.',
    ].filter((line) => line !== '').join('\n');
    setHandoffBusy(true);
    setHandoffError('');
    try {
      const r = await api().claudeQueue(claudeSelected, folder, context);
      if (!r.ok) throw new Error(r.error || cv.claudeSendFailed);
      setHandoffOpen(false);
      setNotice(cv.claudeSent);
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : String(e));
    } finally {
      setHandoffBusy(false);
    }
  };

  // Mini-profile "코덱스/클로드 연동하기" → App signal → open the handoff here.
  useEffect(() => {
    if (props.codexSignal > 0) void openHandoff('codex');
  }, [props.codexSignal]);

  useEffect(() => {
    if (props.claudeSignal > 0) void openHandoff('claude');
  }, [props.claudeSignal]);

  // Slash "/model" → App signal → open the model menu here (idle only).
  useEffect(() => {
    if (props.modelPickerSignal <= 0) return;
    if (runRef.current) {
      setNotice(cv.tuneBusy);
      return;
    }
    setModelPickerOpen(true);
  }, [props.modelPickerSignal]);

  // Keep latest callbacks without re-subscribing.
  const cbRef = useRef(props);
  cbRef.current = props;

  useEffect(() => {
    if (!hasBridge()) return;
    const offChunk = api().onChatChunk(({ reqId, text }) => {
      if (reqId !== reqRef.current) return;
      streamRef.current.text += text;
      setStreamText(streamRef.current.text);
    });
    const offStderr = api().onChatStderr(({ reqId, text }) => {
      if (reqId !== reqRef.current) return;
      streamRef.current.stderr += text;
      setStreamStderr(streamRef.current.stderr);
    });
    const offDone = api().onChatDone(({ reqId, code, error, usage, durationMs: serverDur, errorText }) => {
      if (reqId !== reqRef.current) return;
      reqRef.current = null;
      const { text, stderr } = streamRef.current;
      const isMsp = runEngineRef.current === 'msp';
      const liveCv = STRINGS[langRef.current].chat;
      const timedOut = !!error && error.startsWith('TIMEOUT');
      const folded = isMsp ? foldMspItems(mspItemsRef.current, langRef.current) : { text: '', activity: '' };
      const bodyText = isMsp ? folded.text : text;
      const errText = [stderr, isMsp ? folded.activity : ''].filter(Boolean).join('\n');
      const durationMs = typeof serverDur === 'number' ? serverDur : Date.now() - (runStartRef.current || Date.now());
      const cmd = runRef.current?.cmd;
      const cwd = runRef.current?.cwd;
      const msgId = uid('m');
      const acts = isMsp ? foldMspActs(mspItemsRef.current, langRef.current) : [];
      const body = bodyText || (error ? friendlyError(error, langRef.current) : errorText ? formatStr(liveCv.errExecFailed, { err: errorText }) : liveCv.noOutput);
      streamRef.current = { text: '', stderr: '' };
      runRef.current = null;
      const wasCancelled = cancelRequestedRef.current;
      const completedSuccessfully = !wasCancelled && !error && (code === 0 || code === null || code === undefined);
      queueDrainAllowedRef.current = completedSuccessfully;
      lastTurnEndRef.current = { completed: completedSuccessfully, partial: bodyText || '' };
      cancelRequestedRef.current = false;
      setStreamText('');
      setStreamStderr('');
      setStreamActivity('');
      setMspActs([]);
      setRun(null);
      cbRef.current.onRunningChange(false);
      const background = !cbRef.current.isActiveSession || !document.hasFocus();
      const hasQueuedWork = queuedPromptsRef.current.length > 0;
      const willContinueAutomatically = completedSuccessfully && hasQueuedWork && cbRef.current.isActiveSession;
      if (shouldShowBackgroundNotification({
        enabled: cbRef.current.settings.backgroundNotifications,
        isActiveSession: cbRef.current.isActiveSession,
        windowFocused: document.hasFocus(),
        willContinueAutomatically,
      })) {
        const status = runNotificationStatus({ cancelled: wasCancelled, completedSuccessfully });
        void api().showNotification(cbRef.current.session.title, cbRef.current.session.id, status).catch(() => {});
      }
      // Append first so the message is in state (and saved) immediately;
      // slow git enrichment patches it afterwards.
      cbRef.current.onAppendAssistant({
        id: msgId,
        role: 'assistant',
        text: body,
        stderr: errText || undefined,
        code: code ?? null,
        cmd,
        cwd,
        ts: Date.now(),
        done: true,
        durationMs,
        work: acts.length > 0 ? acts.map((a) => `${a.toolLabel}${a.target ? ` ${a.target}` : ''} (${a.statusLabel})`) : undefined,
        usage:
          usage ||
          (turnUsageRef.current && turnUsageRef.current.inputTokens + turnUsageRef.current.outputTokens > 0
            ? {
                inputTokens: turnUsageRef.current.inputTokens,
                outputTokens: turnUsageRef.current.outputTokens,
                cachedTokens: turnUsageRef.current.cachedTokens || undefined,
                reasoningTokens: turnUsageRef.current.reasoningTokens || undefined,
              }
            : undefined),
        timeout: timedOut || undefined,
        plan: planTurnRef.current || undefined,
        checkpointId: turnCheckpointRef.current || undefined,
        todos: liveTodosRef.current.length > 0 ? liveTodosRef.current : undefined,
      });
      if (planTurnRef.current && completedSuccessfully && body) {
        setPendingPlan({ msgId, text: body });
        setNotice(liveCv.planDoneNotice);
      }
      planTurnRef.current = false;
      followScrollRef.current = true;
      setShowScrollBottom(false);
      const sc = scrollRef.current;
      if (sc) sc.scrollTop = sc.scrollHeight;
      void (async () => {
        const after = await gitSnapshot(cwd || '');
        const changed = error ? [] : diffPaths(beforeRef.current, after);
        let stats: ChangedStat[] | undefined;
        if (changed.length > 0 && cwd && hasBridge()) {
          try {
            const ns = await api().gitNumstat(cwd);
            if (ns.ok && ns.files) {
              const map = new Map(ns.files.map((f) => [f.file, f]));
              stats = changed.map((f) => ({ file: f, added: map.get(f)?.added || 0, deleted: map.get(f)?.deleted || 0 }));
            }
          } catch {
            /* ignore */
          }
        }
        const patch: Partial<ChatMessage> = {};
        if (changed.length > 0) patch.changedFiles = changed;
        if (stats && stats.length > 0) patch.changedStats = stats;
        if (changed.length > 0 && acts.length === 0) patch.work = [formatStr(liveCv.workChanged, { files: changed.join(', ') })];
        if (Object.keys(patch).length > 0) cbRef.current.onUpdateMessage(msgId, patch);
      })();
    });
    const offItem = api().onMspItem(({ reqId, item }) => {
      if (reqId !== reqRef.current || runEngineRef.current !== 'msp') return;
      if (!item || !item.itemId) return;
      mspItemsRef.current.set(item.itemId, item);
      const { text: full, activity } = foldMspItems(mspItemsRef.current, langRef.current);
      setStreamText(full);
      setStreamActivity(activity);
      setMspActs(foldMspActs(mspItemsRef.current, langRef.current));
    });
    const offAppr = api().onMspApproval((a) => {
      const sid = cbRef.current.session.id;
      if (a.threadKey !== sid && a.threadKey !== planThreadKey(sid)) return;
      setApprovals((prev) => (prev.some((x) => x.key === a.key) ? prev : [...prev, a]));
    });
    const offApprDone = api().onMspApprovalResolved(({ approvalId }) => {
      if (!approvalId) return;
      setApprovals((prev) => prev.filter((x) => x.approval.approvalId !== approvalId));
    });
    const offUserInput = api().onMspUserInput((prompt) => {
      const sid = cbRef.current.session.id;
      if (prompt.threadKey !== sid && prompt.threadKey !== planThreadKey(sid)) return;
      setUserInputs((prev) => prev.some((item) => item.key === prompt.key) ? prev : [...prev, prompt]);
    });
    const offUserInputSettled = api().onMspUserInputSettled(({ sessionId, userInputId }) => {
      setUserInputs((prev) => prev.filter((item) => item.sessionId !== sessionId || item.userInputId !== userInputId));
    });
    const offHostDead = api().onMspHostDead(() => {
      setApprovals([]);
      setUserInputs([]);
      setNotice(STRINGS[langRef.current].chat.hostDead);
    });
    const offHook = api().onHookResult((r) => {
      if (!r || r.ok) return;
      const liveCv = STRINGS[langRef.current].chat;
      setNotice(formatStr(liveCv.hookFailed, { event: r.event || '', command: String(r.command || '').slice(0, 80), err: r.error || '' }));
    });
    const offTodos = api().onMspTodos((p) => {
      const sid = cbRef.current.session.id;
      if (p.threadKey !== sid && p.threadKey !== planThreadKey(sid)) return;
      const items = Array.isArray(p.items) ? p.items : [];
      liveTodosRef.current = items;
      setLiveTodos(items);
    });
    const offTokens = api().onMspTokens((p) => {
      const run = runRef.current;
      if (!run || runEngineRef.current !== 'msp' || !p.usage) return;
      const matchTurn = p.turnId && run.turnId && p.turnId === run.turnId;
      const matchSess = p.sessionId && run.mspSessionId && p.sessionId === run.mspSessionId;
      if (!matchTurn && !matchSess) return;
      const cur = turnUsageRef.current || { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 };
      cur.inputTokens += p.usage.inputTokens || 0;
      cur.outputTokens += p.usage.outputTokens || 0;
      cur.cachedTokens += p.usage.cachedTokens || 0;
      cur.reasoningTokens += p.usage.reasoningTokens || 0;
      turnUsageRef.current = cur;
    });
    return () => {
      offChunk();
      offStderr();
      offDone();
      offItem();
      offAppr();
      offApprDone();
      offUserInput();
      offUserInputSettled();
      offHostDead();
      offTokens();
      offTodos();
      offHook();
      try {
        recogRef.current?.stop();
      } catch {
        /* ignore */
      }
      if (reqRef.current && window.mudex) {
        window.mudex.chatCancel(reqRef.current).catch(() => {});
        reqRef.current = null;
      }
      cbRef.current.onRunningChange(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (followScrollRef.current) el.scrollTop = el.scrollHeight;
    else setShowScrollBottom(true);
  }, [session.messages.length, streamText.length, streamStderr.length, userInputs.length]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
    const observed = new Set<Element>();
    const resizeObserver = new ResizeObserver(() => {
      if (followScrollRef.current) container.scrollTop = container.scrollHeight;
      else setShowScrollBottom(true);
    });
    const syncObservedChildren = () => {
      const current = new Set(Array.from(container.children));
      observed.forEach((child) => {
        if (current.has(child)) return;
        resizeObserver.unobserve(child);
        observed.delete(child);
      });
      current.forEach((child) => {
        if (observed.has(child)) return;
        resizeObserver.observe(child);
        observed.add(child);
      });
    };
    syncObservedChildren();
    const mutationObserver = new MutationObserver(syncObservedChildren);
    mutationObserver.observe(container, { childList: true });
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!run) return;
    setElapsed(0);
    const t0 = Date.now();
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(iv);
  }, [run]);

  useEffect(() => {
    if (!hasBridge() || !folder) {
      setVerifyScripts([]);
      return;
    }
    api()
      .verifyScripts(folder)
      .then((r) => {
        if (r.ok) setVerifyScripts(r.scripts || []);
      })
      .catch(() => {});
  }, [folder]);

  useEffect(() => {
    if (!hasBridge()) return;
    api()
      .mspModels(folder || '')
      .then((r) => {
        if (r.ok) setHostModels(r.models || []);
      })
      .catch(() => {});
  }, [folder]);

  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [reasonPos, setReasonPos] = useState<{ left: number; top: number } | null>(null);
  const reasonRootRef = useRef<HTMLDivElement | null>(null);
  const reasonTriggerRef = useRef<HTMLElement | null>(null);
  const suppressReasonFocusRef = useRef(false);

  const openReasoning = (anchor: HTMLElement | null) => {
    if (suppressReasonFocusRef.current) {
      suppressReasonFocusRef.current = false;
      return;
    }
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const menu = modelPickerRef.current?.querySelector('.composer-model-menu');
      const menuLeft = menu?.getBoundingClientRect().left ?? rect.left;
      const width = 208;
      let left = rect.right + 8;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, menuLeft - width - 8);
      }
      const top = Math.min(Math.max(8, rect.top - 8), Math.max(8, window.innerHeight - 330));
      setReasonPos({ left, top });
      reasonTriggerRef.current = anchor;
    }
    setReasoningOpen(true);
  };

  const closeReasoning = (restoreFocus: boolean) => {
    setReasoningOpen(false);
    const trigger = reasonTriggerRef.current;
    reasonTriggerRef.current = null;
    if (restoreFocus && trigger?.isConnected && document.activeElement !== trigger) {
      suppressReasonFocusRef.current = true;
      scheduleAfterPaint(() => {
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
        else suppressReasonFocusRef.current = false;
      });
    }
  };

  useEffect(() => {
    if (!modelPickerOpen) {
      setReasoningOpen(false);
      reasonTriggerRef.current = null;
    }
  }, [modelPickerOpen]);

  useEffect(() => {
    if (!actionMenuOpen && !modelPickerOpen && !approvalMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (reasoningOpen && reasonRootRef.current?.contains(target)) return;
      if (actionMenuOpen && !actionMenuRef.current?.contains(target)) {
        setActionMenuOpen(false);
      }
      if (modelPickerOpen && !modelPickerRef.current?.contains(target)) {
        setModelPickerOpen(false);
      }
      if (approvalMenuOpen && !approvalMenuRef.current?.contains(target)) {
        setApprovalMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (reasoningOpen) {
          closeReasoning(true);
          return;
        }
        if (actionMenuOpen) setActionMenuOpen(false);
        if (modelPickerOpen) setModelPickerOpen(false);
        if (approvalMenuOpen) setApprovalMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [actionMenuOpen, modelPickerOpen, approvalMenuOpen, reasoningOpen]);

  useEffect(() => {
    if (run) {
      setActionMenuOpen(false);
      setModelPickerOpen(false);
      setApprovalMenuOpen(false);
      setReasoningOpen(false);
    }
  }, [run]);

  const modelOptions = (() => {
    const ids = [...hostModels.map((m) => m.modelId), ...CHAT_MODELS].filter(
      (m, i, a) => m && a.indexOf(m) === i,
    );
    if (settings.model && !ids.includes(settings.model)) ids.unshift(settings.model);
    return ids;
  })();
  const modelLabel = (id: string) => hostModels.find((m) => m.modelId === id)?.displayLabel || id;
  const reasoningLabel = (v: string) => reasoningEfforts.find(([x]) => x === v)?.[1] || v || strings.settings.cliDefault;
  const effModel = resolveModel(session, settings);
  const effEffort = resolveEffort(session, settings);
  const sessionEffortValue = sanitizeEffort(session.effortOverride);
  const sessionModelValue = sanitizeModel(session.modelOverride);

  const changeModel = (v: string) => {
    cbRef.current.onPatchSettings({ model: v });
    // A session model override owns this thread: the global change applies
    // to other sessions, never clobbers this one.
    if (v && session.mspSessionId && hasBridge() && !sanitizeModel(session.modelOverride)) {
      api().mspSetModel(session.id, v).catch(() => setNotice(cv.modelSetFailed));
    }
  };

  const changeReasoning = (v: string) => {
    cbRef.current.onPatchSettings({ reasoningEffort: v });
    // Same ownership rule as the model: an overridden thread keeps its own.
    if (v && session.mspSessionId && hasBridge() && !sanitizeEffort(session.effortOverride)) {
      api().mspSetReasoning(session.id, v).catch(() => setNotice(cv.reasoningSetFailed));
    }
  };

  const approvalLabel = (v: string) => approvalModeLabel(v, strings.settings);
  const changeApproval = (v: string) => {
    const mode = sanitizeApprovalMode(v);
    cbRef.current.onPatchSettings({ approvalMode: mode });
    // Empty means CLI default: nothing to push, the thread keeps its mode.
    if (mode && session.mspSessionId && hasBridge()) {
      api().mspSetApprovalMode(session.id, mode).catch(() => setNotice(cv.approvalSetFailed));
    }
  };

  const changeSessionModel = (v: string) => {
    cbRef.current.onSessionOverride({ modelOverride: v });
    if (v && session.mspSessionId && hasBridge()) {
      api().mspSetModel(session.id, v).catch(() => setNotice(cv.modelSetFailed));
    }
  };

  const changeSessionEffort = (v: string) => {
    cbRef.current.onSessionOverride({ effortOverride: v });
    if (v && session.mspSessionId && hasBridge()) {
      api().mspSetReasoning(session.id, v).catch(() => setNotice(cv.reasoningSetFailed));
    }
  };

  const reasoningValue = sessionOnlyModel ? sessionEffortValue : settings.reasoningEffort || '';
  const reasoningLevelLabel = reasoningValue ? reasoningLabel(reasoningValue) : strings.settings.cliDefault;
  const applyReasoning = (v: string) => {
    if (sessionOnlyModel) changeSessionEffort(v);
    else changeReasoning(v);
  };

  const attachFiles = async (paths: string[]) => {
    if (!hasBridge() || paths.length === 0) return;
    const seen = new Set(attach.map((a) => a.path));
    let total = attach.reduce((n, a) => n + a.content.length, 0);
    for (const fp of paths) {
      if (seen.has(fp)) continue;
      const name = fp.split(/[\\/]/).pop() || fp;
      const isImg = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(fp);
      try {
        if (isImg) {
          const b = await api().readFileBytes(fp);
          if (!b.ok || !b.base64) {
            setNotice(
              b.error === 'TOO_LARGE' ? formatStr(cv.imgTooLarge, { name }) : formatStr(cv.readFailed, { error: b.error }),
            );
            continue;
          }
          seen.add(fp);
          const img: AttachedFile = {
            path: fp,
            name,
            content: '',
            image: true,
            dataUrl: `data:${b.mime || 'image/png'};base64,${b.base64}`,
          };
          setAttach((prev) => (prev.some((p) => p.path === fp) ? prev : [...prev, img]));
          continue;
        }
        const t = await api().readFile(fp);
        if (!t.ok) {
          setNotice(
            (t.error || '').startsWith('TOO_LARGE')
              ? formatStr(cv.fileTooLarge, { name })
              : formatStr(cv.readFailed, { error: t.error }),
          );
          continue;
        }
        const content = t.content ?? '';
        if (total + content.length > MAX_ATTACH_CHARS) {
          setNotice(cv.attachTooLong);
          continue;
        }
        seen.add(fp);
        total += content.length;
        const item: AttachedFile = { path: fp, name, content, image: false };
        setAttach((prev) => (prev.some((p) => p.path === fp) ? prev : [...prev, item]));
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const pickFiles = async () => {
    if (!hasBridge()) return;
    try {
      const r = await api().pickFiles();
      if (r.ok && r.paths?.length) await attachFiles(r.paths);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const attachPastedImage = async (file: File) => {
    const mime = file.type.toLowerCase();
    if (file.size > 8 * 1024 * 1024) {
      setNotice(cv.pasteTooLarge);
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(mime)) {
      setNotice(cv.pasteTypes);
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(cv.imgReadFailed));
        reader.onerror = () => reject(new Error(cv.imgReadFailed));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const name = file.name || `pasted-image.${mime.split('/')[1] || 'png'}`;
      const saved = await api().savePastedImage(name, base64, mime);
      if (!saved.ok || !saved.path) throw new Error(saved.error === 'TOO_LARGE' ? cv.imgTooLargeShort : saved.error || cv.imgAttachFailed);
      setAttach((prev) => prev.some((item) => item.path === saved.path) ? prev : [...prev, {
        path: saved.path!,
        name,
        content: '',
        image: true,
        dataUrl,
      }]);
      setNotice(cv.clipAttached);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const removeAttach = (p: string) => setAttach((prev) => prev.filter((a) => a.path !== p));

  const toggleMic = () => {
    if (micOn) {
      try {
        recogRef.current?.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecog; webkitSpeechRecognition?: new () => SpeechRecog };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setNotice(cv.micUnsupported);
      return;
    }
    try {
      const r = new SR();
      r.lang = lang === 'en' ? 'en-US' : 'ko-KR';
      r.interimResults = true;
      r.onresult = (e) => {
        let s = '';
        for (const res of Array.from(e.results)) s += res[0]?.transcript || '';
        promptHistoryIndexRef.current = null;
        setInput(s);
      };
      r.onend = () => {
        recogRef.current = null;
        setMicOn(false);
      };
      r.onerror = () => setNotice(cv.micFailed);
      recogRef.current = r;
      setMicOn(true);
      r.start();
    } catch {
      setMicOn(false);
      setNotice(cv.micStartFailed);
    }
  };

  const togglePlanMode = () => {
    const next = !planMode;
    setPlanMode(next);
    try { writePlanMode(localStorage, session.id, next); } catch { /* persistence best-effort */ }
    setPendingPlan(null);
    setNotice(next ? cv.planOn : cv.planOff);
  };

  const executePlan = () => {
    if (!pendingPlan || run) return;
    const planText = pendingPlan.text;
    setPendingPlan(null);
    setPlanMode(false);
    try { writePlanMode(localStorage, session.id, false); } catch { /* persistence best-effort */ }
    void send(buildExecutePrompt(planText, lang), { ignoreAttachments: true, normal: true });
  };

  const send = async (raw?: string, options: { preserveDraft?: boolean; ignoreAttachments?: boolean; normal?: boolean; displayText?: string; auto?: boolean; rawWire?: boolean } = {}) => {
    // Goal-setup mode hijacks composer-originated submits (Enter / send
    // button / idle interrupt): the typed line becomes a goal and starts
    // it immediately instead of going out as a chat message.
    if (raw === undefined && props.goalSetup && !run) {
      submitGoalSetup();
      return;
    }
    const text = (raw ?? input).trim();
    const attachments = options.ignoreAttachments ? [] : attach;
    if ((!text && attachments.length === 0) || run) return;
    if (!hasBridge()) {
      setNotice(cv.needAppCli);
      return;
    }
    // A fresh turn invalidates any pending plan; executePlan() runs normal
    // even when the toggle is still settling (state updates are async).
    const planTurn = planMode && !options.normal;
    setPendingPlan(null);
    liveTodosRef.current = [];
    setLiveTodos([]);
    const names = attachments.map((a) => a.name).join(', ');
    const display = options.displayText ?? (attachments.length > 0 ? (text ? `${text}\n\n[첨부: ${names}]` : `[첨부: ${names}]`) : text);
    const fileAttach = attachments.filter((a) => !a.image);
    const imgAttach = attachments.filter((a) => a.image);
    const full =
      text +
      (fileAttach.length > 0
        ? `\n\n--- 첨부 파일 (아래 내용을 참고해서 답하세요) ---\n${fileAttach
            .map((a) => `### ${a.path}\n\`\`\`\n${a.content}\n\`\`\``)
            .join('\n\n')}`
        : '') +
      (imgAttach.length > 0
        ? `\n\n--- 첨부 이미지 (아래 경로의 파일을 직접 열어서 확인해줘) ---\n${imgAttach.map((a) => `- ${a.path}`).join('\n')}`
        : '');
    turnPromptRef.current = full;
    cbRef.current.onAppendUser({ id: uid('m'), role: 'user', text: display, ts: Date.now(), done: true, auto: options.auto });
    followScrollRef.current = true;
    setShowScrollBottom(false);
    cbRef.current.onTitleMaybe(options.displayText ?? (text || names));
    promptHistoryIndexRef.current = null;
    if (!options.preserveDraft) {
      setInput('');
      setFileMention(null);
    }
    setNotice('');
    runStartRef.current = Date.now();
    beforeRef.current = await gitSnapshot(folder);
    // Snapshot before the turn so it can be undone wholesale. Plan turns
    // change nothing; a failed snapshot never blocks the turn.
    turnCheckpointRef.current = null;
    if (!planTurn && folder) {
      try {
        const cp = await api().checkpointCreate(folder, cbRef.current.session.id);
        if (cp.ok && cp.id) turnCheckpointRef.current = cp.id;
      } catch { /* checkpoint best-effort */ }
    }
    planTurnRef.current = planTurn;
    // The bubble shows the user's own words; the plan contract and the
    // linked goal context travel on the wire only. rawWire callers (goal
    // kickoff) already built the exact wire — wrapping again would inject
    // the goal twice or drag in a stale previously-active goal.
    const base = planTurn ? buildPlanPrompt(full, lang) : full;
    const wire = options.rawWire ? base : applyGoalContext(base, activeLinkedGoal(props.goalStore, session.id), lang);
    try {
      const ov = sendOverrides(cbRef.current.session);
      const res = await api().chatStart(wire, folder, cbRef.current.session.id, cbRef.current.session.mspSessionId, planTurn || undefined, Object.keys(ov).length > 0 ? ov : undefined);
      if (!res.ok || !res.reqId) {
        cbRef.current.onAppendAssistant({
          id: uid('m'),
          role: 'assistant',
          text: friendlyError(res.error || cv.errBare, lang),
          cmd: res.cmd,
          cwd: res.cwd,
          code: null,
          ts: Date.now(),
          done: true,
        });
        return;
      }
      reqRef.current = res.reqId;
      runRef.current = { reqId: res.reqId, cmd: res.cmd, cwd: res.cwd, turnId: res.turnId, mspSessionId: res.mspSessionId };
      turnUsageRef.current = null;
      streamRef.current = { text: '', stderr: '' };
      runEngineRef.current = res.engine === 'msp' ? 'msp' : 'exec';
      mspItemsRef.current.clear();
      setStreamActivity('');
      setMspActs([]);
      setRun(runRef.current);
      cbRef.current.onRunningChange(true);
      // A plan turn's session id belongs to the read-only plan session —
      // adopting it would unlink the main conversation. Record the engine
      // honestly but keep the main link untouched.
      if (planTurn) cbRef.current.onMspSession(cbRef.current.session.mspSessionId || '', runEngineRef.current);
      else cbRef.current.onMspSession(res.mspSessionId || '', runEngineRef.current);
      if (res.fallback) setNotice(formatStr(cv.execFallback, { reason: res.fallbackReason || '' }));
      const mcpNotice = mcpChatNotice(res.mcpHealth, lang);
      if (mcpNotice) setNotice(mcpNotice);
      setStreamText('');
      setStreamStderr('');
      if (!options.preserveDraft) setAttach([]);
    } catch (e) {
      cbRef.current.onAppendAssistant({
        id: uid('m'),
        role: 'assistant',
        text: e instanceof Error ? e.message : String(e),
        code: null,
        ts: Date.now(),
        done: true,
      });
    }
  };

  // Goal kickoff: starting a goal runs the agent immediately — no extra
  // user message needed. The composer's draft is preserved. When a turn
  // is already running (or no CLI bridge), report false so the panel says
  // the goal rides along from the next message instead.
  const runGoalNow = (goal: Goal) => {
    if (run || !hasBridge()) return false;
    const wire = buildGoalKick(goal, lang);
    if (!wire) return false;
    void send(wire, {
      displayText: formatStr(cv.goalKickBubble, { title: goal.title }),
      auto: true,
      ignoreAttachments: true,
      normal: true,
      preserveDraft: true,
      rawWire: true,
    });
    return true;
  };

  // Goal-setup mode: the next composer submit becomes the goal title —
  // the goal is created, linked to this session, and started at once.
  const enterGoalSetup = () => {
    setActionMenuOpen(false);
    props.onGoalSetupChange(true);
    composerInputRef.current?.focus();
  };

  const submitGoalSetup = () => {
    const title = input.trim();
    if (!title) return;
    const created = createGoal({ title });
    if (!created) return;
    if (props.goalStore.goals.length >= MAX_GOALS) {
      setNotice(formatStr(gt.full, { n: MAX_GOALS }));
      return;
    }
    const next = startGoalInSession(
      normalizeGoalStore({ goals: addGoal(props.goalStore.goals, created), activeGoalId: props.goalStore.activeGoalId }),
      created.id,
      session.id,
    );
    props.onGoalStoreChange(next);
    props.onGoalSetupChange(false);
    setInput('');
    setFileMention(null);
    promptHistoryIndexRef.current = null;
    setNotice('');
    const startedGoal = next.goals.find((item) => item.id === created.id) || created;
    setNotice(runGoalNow(startedGoal) ? gt.startedRun : gt.started);
  };

  const queuePrompt = () => {
    const text = input.trim();
    if (!run || !text || attach.length > 0) return;
    if (queuedPrompts.length >= MAX_QUEUED_PROMPTS) {
      setNotice(cv.queueMax);
      return;
    }
    setQueuedPrompts((current) => enqueuePrompt(current, text));
    setInput('');
    setFileMention(null);
    promptHistoryIndexRef.current = null;
    setNotice(queuePaused ? cv.queuedPaused : cv.queuedOk);
  };

  const runNextQueuedPrompt = () => {
    if (run || queuedPrompts.length === 0) return;
    if (!hasBridge()) {
      setNotice(cv.needAppCli);
      return;
    }
    const { prompt, remaining } = takeNextPrompt(queuedPrompts);
    if (!prompt) return;
    setQueuedPrompts(remaining);
    void send(prompt, { preserveDraft: true, ignoreAttachments: true });
  };

  // Scheduled prompt firing: App delivers { sessionId, text, nonce } when a
  // reservation comes due (activating this session so the run lands in its
  // own thread). Busy sessions are left for App to retry on the next tick.
  useEffect(() => {
    const fire = props.scheduledFire;
    if (!fire || fire.sessionId !== props.session.id) return;
    if (consumedFireNonce.get(fire.sessionId) === fire.nonce) return;
    if (run || !hasBridge()) return;
    consumedFireNonce.set(fire.sessionId, fire.nonce);
    props.onScheduledConsumed(fire.nonce);
    void send(fire.text, { preserveDraft: true, ignoreAttachments: true });
  });

  const toggleQueuePause = () => {
    if (!queuePaused) {
      setQueuePaused(true);
      setNotice(cv.queuePausedMsg);
      return;
    }
    setQueuePaused(false);
    if (!run && queuedPrompts.length) runNextQueuedPrompt();
    else setNotice(cv.queueResumed);
  };

  const editQueuedPrompt = (index: number) => {
    const { prompt, remaining } = extractQueuedPrompt(queuedPrompts, index);
    if (prompt === null) return;
    setQueuedPrompts(remaining);
    const nextInput = input.trim() ? `${input}\n\n${prompt}` : prompt;
    setInput(nextInput);
    promptHistoryIndexRef.current = null;
    setNotice(input.trim() ? cv.queueAppendDraft : cv.queueLoadDraft);
    scheduleAfterPaint(() => {
      const textarea = composerInputRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(nextInput.length, nextInput.length);
    });
  };

  useEffect(() => {
    if (run) {
      previousRunRef.current = true;
      return;
    }
    if (!previousRunRef.current) return;
    previousRunRef.current = false;
    // An interrupt chain owns the handoff: the new question (or the resume
    // of the interrupted work) goes before the visible queue.
    const chain = interruptChainRef.current;
    if (chain.pending || chain.stack.length > 0) {
      if (!props.isActiveSession) {
        const items = flattenInterruptChain(chain, langRef.current);
        if (items.length > 0) {
          setQueuedPrompts((current) => [...items, ...normalizePromptQueue(current)].slice(0, MAX_QUEUED_PROMPTS));
        }
        interruptChainRef.current = emptyInterruptChain();
        persistInterruptChain(emptyInterruptChain());
        setNotice(cv.interruptQueued);
        return;
      }
      const handoff = popInterruptChain(chain, queueDrainAllowedRef.current, lastTurnEndRef.current.partial);
      interruptChainRef.current = handoff.chain;
      persistInterruptChain(handoff.chain);
      if (handoff.dropped) {
        setNotice(cv.interruptChainDropped);
        return;
      }
      if (handoff.sendKind === 'question' && handoff.send) {
        void send(handoff.send, { preserveDraft: true, ignoreAttachments: true });
        return;
      }
      if (handoff.sendKind === 'resume' && handoff.sendEntry) {
        setNotice(cv.resumeNotice);
        void send(buildResumePrompt(handoff.sendEntry.prompt, handoff.sendEntry.partial, langRef.current, handoff.isFinal), {
          preserveDraft: true,
          ignoreAttachments: true,
          normal: true,
          displayText: cv.resumeNotice,
          auto: true,
        });
        return;
      }
      return;
    }
    if (!props.isActiveSession || !shouldAutoRunQueuedPrompt({
      wasRunning: true,
      completedSuccessfully: queueDrainAllowedRef.current,
      cancelled: false,
      queuePaused,
      queueLength: queuedPrompts.length,
    })) return;
    queueDrainAllowedRef.current = false;
    const { prompt, remaining } = takeNextPrompt(queuedPrompts);
    if (!prompt) return;
    setQueuedPrompts(remaining);
    void send(prompt, { preserveDraft: true, ignoreAttachments: true });
  }, [run, queuedPrompts, queuePaused, props.isActiveSession]);

  const rerunPrompt = async (prompt: string) => {
    if (run || (await props.onConfirm({
      title: cv.rerunTitle,
      message: cv.rerunMsg,
      confirmLabel: cv.rerunBtn,
    })) !== 'confirm') return;
    await send(prompt);
  };

  // A plain stop during an interrupt handoff aborts the handoff: the typed
  // question is preserved at the front of the visible queue instead.
  const abortInterruptHandoff = () => {
    const pending = interruptChainRef.current.pending;
    if (!pending) return;
    interruptChainRef.current = emptyInterruptChain();
    persistInterruptChain(emptyInterruptChain());
    setQueuedPrompts((current) => prependPrompt(current, pending));
    setNotice(cv.interruptAborted);
  };

  const cancel = () => {
    if (run && window.mudex) {
      abortInterruptHandoff();
      cancelRequestedRef.current = true;
      window.mudex.chatCancel(run.reqId).catch(() => {});
    }
  };

  const interrupt = () => {
    const text = input.trim();
    if (!text) return;
    if (!runRef.current) {
      void send();
      return;
    }
    if (interruptChainRef.current.pending) return;
    interruptChainRef.current = armInterruptChain(interruptChainRef.current, text, turnPromptRef.current);
    persistInterruptChain(interruptChainRef.current);
    setInput('');
    setFileMention(null);
    promptHistoryIndexRef.current = null;
    cancelRequestedRef.current = true;
    if (window.mudex) window.mudex.chatCancel(runRef.current.reqId).catch(() => {});
    setNotice(cv.interruptNotice);
  };

  const cancelInterruptDraft = () => {
    setInput('');
    setFileMention(null);
    promptHistoryIndexRef.current = null;
  };

  // Let the sidebar stop this pane's run without switching to it first.
  // The captured `cancel` belongs to the render where `run` last changed,
  // so the registered closure always carries the current reqId.
  useEffect(() => {
    cbRef.current.onRegisterStop(run ? cancel : null);
    return () => { cbRef.current.onRegisterStop(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const runVerify = async (m: ChatMessage, script: string) => {
    if (!m.cwd || !hasBridge() || verifyRunning || run) return;
    setVerifyRunning({ msgId: m.id, script });
    try {
      const r = await api().verifyRun(m.cwd, script);
      const rec = {
        script,
        ok: r.ok && r.code === 0,
        code: r.code ?? null,
        tail: (r.tail || r.error || '').slice(-4000),
        ts: Date.now(),
      };
      const prev = (cbRef.current.session.messages.find((x) => x.id === m.id)?.verify || []).filter(
        (x) => x.script !== script,
      );
      cbRef.current.onUpdateMessage(m.id, { verify: [...prev, rec] });
    } catch (e) {
      const prev = (cbRef.current.session.messages.find((x) => x.id === m.id)?.verify || []).filter(
        (x) => x.script !== script,
      );
      cbRef.current.onUpdateMessage(m.id, {
        verify: [
          ...prev,
          { script, ok: false, code: null, tail: e instanceof Error ? e.message : String(e), ts: Date.now() },
        ],
      });
    } finally {
      setVerifyRunning(null);
    }
  };

  const doRevert = async (m: ChatMessage) => {
    if (!m.cwd || !m.changedFiles || m.changedFiles.length === 0 || !hasBridge() || run || reverting) return;
    if (await props.onConfirm({ title: cv.revertTitle, message: formatStr(cv.revertMsg, { count: m.changedFiles.length }), confirmLabel: cv.revertBtn, destructive: true }) !== 'confirm') return;
    setReverting(m.id);
    try {
      const r = await api().revertFiles(m.cwd, m.changedFiles);
      const failed = (r.results || []).filter((x) => !x.ok);
      if (!r.ok || failed.length > 0) {
        setNotice(formatStr(cv.revertFailed, { files: failed.map((x) => x.file).join(', ') || r.error }));
      } else {
        cbRef.current.onUpdateMessage(m.id, { reverted: true });
        setNotice(cv.revertedOk);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setReverting(null);
    }
  };

  const doCheckpointRestore = async (m: ChatMessage) => {
    if (!m.cwd || !m.checkpointId || !hasBridge() || run || reverting) return;
    if (await props.onConfirm({ title: cv.checkpointTitle, message: cv.checkpointMsg, confirmLabel: cv.checkpointBtn, destructive: true }) !== 'confirm') return;
    setReverting(m.id);
    try {
      const r = await api().checkpointRestore(m.cwd, session.id, m.checkpointId);
      if (!r.ok) {
        setNotice(formatStr(cv.checkpointFailed, { err: r.error || (r.failed || []).join(', ') }));
      } else {
        cbRef.current.onUpdateMessage(m.id, { reverted: true });
        setNotice(cv.checkpointRestored);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setReverting(null);
    }
  };

  const continueRun = (m: ChatMessage) => {
    if (run) return;
    if (session.mspSessionId) {
      void send('이어서 계속해줘. 이전 턴이 시간 초과로 중단되었다. 중단된 지점부터 계속 진행해.');
    } else {
      const tail = m.text.length > 3000 ? `…\n${m.text.slice(-3000)}` : m.text;
      void send(`이어서 계속해줘. 이전 실행이 시간 초과로 끊겼다. 마지막 출력은 아래와 같다.\n"""\n${tail}\n"""`);
    }
  };

  const showEmpty = session.messages.length === 0 && !run;
  const activeCwd = session.cwd || folder;
  const workspaceName = activeCwd.split(/[\\/]/).filter(Boolean).pop() || activeCwd || cv.noWorkspace;
  const awaitingUserInput = !!runRef.current?.mspSessionId
    && userInputs.some((prompt) => prompt.sessionId === runRef.current?.mspSessionId);

  return (
    <section className="chat" style={props.paneStyle}>
      <header className="chat-header">
        <div className="chat-heading">
          <div className="chat-title">{session.title}</div>
          <button
            className="chat-workspace"
            type="button"
            title={activeCwd ? formatStr(cv.wsTitle, { cwd: activeCwd }) : cv.wsNone}
            aria-label={activeCwd ? formatStr(cv.wsCopyLabel, { cwd: activeCwd }) : cv.noWorkspace}
            disabled={!activeCwd}
            onClick={async () => {
              if (!activeCwd) return;
              try {
                await navigator.clipboard.writeText(activeCwd);
                setWorkspaceCopied(true);
                window.setTimeout(() => setWorkspaceCopied(false), 1400);
              } catch { /* Clipboard may be unavailable in this environment. */ }
            }}
          >
            <FolderIcon size={13} />
            <span>{workspaceName}</span>
            <span className="chat-workspace-copy">{workspaceCopied ? cv.wsCopied : cv.wsCopy}</span>
          </button>
          {(ctxSummary.turns > 0 || ctxSummary.total > 0) && (
            <span
              className="chat-context-meter"
              title={ctxSummary.total > 0 ? formatStr(cv.ctxMeterTitle, {
                in: ctxSummary.input.toLocaleString(),
                out: ctxSummary.output.toLocaleString(),
                cached: ctxSummary.cached.toLocaleString(),
                reasoning: ctxSummary.reasoning.toLocaleString(),
                observed: ctxSummary.observed,
              }) : cv.ctxMeterEmpty}
            >
              {formatStr(cv.ctxMeter, { tokens: formatCompactTokens(ctxSummary.total), turns: ctxSummary.turns })}
            </span>
          )}
        </div>
        <div className="chat-head-actions">
          <button className="icon-btn" onClick={() => void exportConversation()} title={cv.exportConvTitle} aria-label={cv.exportConvLabel}>
            <ExportIcon size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setMessageFindOpen((open) => {
              if (open) setMessageFindQuery('');
              return !open;
            })}
            title={cv.findTitle}
            aria-label={cv.findLabel}
          >
            <SearchIcon size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={onToggleEditor}
            title={editorVisible ? cv.hidePanelTitle : cv.showPanelTitle}
            aria-label={editorVisible ? cv.hidePanelLabel : cv.showPanelLabel}
            aria-pressed={editorVisible}
          >
            <PanelIcon size={16} />
          </button>
        </div>
      </header>

      {messageFindOpen && (
        <div className="message-find" role="search" aria-label={cv.findLabel}>
          <SearchIcon size={14} />
          <input
            ref={messageFindInputRef}
            value={messageFindQuery}
            onChange={(event) => { setMessageFindQuery(event.target.value); setMessageFindIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); moveMessageMatch(event.shiftKey ? -1 : 1); }
              if (event.key === 'Escape') { setMessageFindOpen(false); setMessageFindQuery(''); }
            }}
            placeholder={cv.findPh}
            aria-label={cv.findQueryLabel}
          />
          {messageFindQuery && <button type="button" className="icon-btn" onClick={() => { setMessageFindQuery(''); setMessageFindIndex(0); messageFindInputRef.current?.focus(); }} title={cv.findClearTitle} aria-label={cv.findClearTitle}><XIcon size={12} /></button>}
          <span className="message-find-count" role="status" aria-live="polite">{messageMatches.length ? formatStr(cv.findCount, { cur: Math.min(messageFindIndex + 1, messageMatches.length), total: messageMatches.length }) : messageFindQuery.trim() ? cv.findNone : ''}</span>
          <button className="icon-btn" disabled={messageMatches.length === 0} onClick={() => moveMessageMatch(-1)} title={cv.findPrevTitle} aria-label={cv.findPrev}><ChevronDownIcon size={13} className="message-find-prev" /></button>
          <button className="icon-btn" disabled={messageMatches.length === 0} onClick={() => moveMessageMatch(1)} title={cv.findNextTitle} aria-label={cv.findNext}><ChevronDownIcon size={13} /></button>
          <button className="icon-btn" onClick={() => { setMessageFindOpen(false); setMessageFindQuery(''); }} title={strings.common.close} aria-label={cv.findClose}><XIcon size={13} /></button>
        </div>
      )}

      {handoffOpen && (
        <div className="handoff-backdrop" onClick={() => !handoffBusy && setHandoffOpen(false)}>
          <section
            ref={handoffCardRef}
            className="handoff-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="handoff-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                if (!handoffBusy) setHandoffOpen(false);
              } else if (event.key === 'Tab') {
                const controls = Array.from(handoffCardRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])
                  .filter((element) => element.offsetParent !== null);
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (!first || !last) {
                  event.preventDefault();
                  handoffCardRef.current?.focus();
                } else if (event.shiftKey && (document.activeElement === first || !handoffCardRef.current?.contains(document.activeElement))) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !handoffCardRef.current?.contains(document.activeElement))) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="handoff-head">
              <div>
                <h3 id="handoff-title">{isClaudeHandoff ? cv.handoffTitleClaude : cv.handoffTitle}</h3>
                <p>{cv.handoffSub}</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setHandoffOpen(false)} disabled={handoffBusy} title={strings.common.close} aria-label={isClaudeHandoff ? cv.handoffCloseClaude : cv.handoffClose}><XIcon size={15} /></button>
            </div>
            <div className="segmented" role="tablist" aria-label={cv.handoffProviderLabel}>
              <button type="button" role="tab" aria-selected={!isClaudeHandoff} className={isClaudeHandoff ? 'seg' : 'seg active'} disabled={handoffBusy} onClick={() => switchHandoffProvider('codex')}>{cv.handoffTabCodex}</button>
              <button type="button" role="tab" aria-selected={isClaudeHandoff} className={isClaudeHandoff ? 'seg active' : 'seg'} disabled={handoffBusy} onClick={() => switchHandoffProvider('claude')}>{cv.handoffTabClaude}</button>
            </div>
            {handoffError && <div className="handoff-error" role="alert">{handoffError}</div>}
            {hoSessions.length > 0 && <label className="handoff-search">
              <SearchIcon size={15} />
              <input
                type="search"
                value={hoQuery}
                onChange={(event) => setHoQuery(event.target.value)}
                placeholder={cv.handoffSearchPh}
                aria-label={isClaudeHandoff ? cv.handoffSearchLabelClaude : cv.handoffSearchLabel}
              />
              <span>{hoFiltered.length}/{hoSessions.length}</span>
            </label>}
            {handoffBusy && hoSessions.length === 0 ? (
              <div className="handoff-empty">{isClaudeHandoff ? cv.handoffLoadingClaude : cv.handoffLoading}</div>
            ) : hoSessions.length === 0 ? (
              <div className="handoff-empty">
                {handoffError ? <button type="button" className="btn" onClick={() => void openHandoff(handoffProvider)}>{strings.common.retry}</button> : isClaudeHandoff ? cv.handoffEmptyClaude : cv.handoffEmpty}
              </div>
            ) : (
              <div className="handoff-list" aria-label={isClaudeHandoff ? cv.handoffListLabelClaude : cv.handoffListLabel}>
                {hoFiltered.length === 0 ? <div className="handoff-empty">{cv.handoffNoMatch}</div> : hoFiltered.map((s) => (
                  <label key={s.id} className={hoSelected === s.id ? 'handoff-session active' : 'handoff-session'}>
                    <input type="radio" name="handoff-session" checked={hoSelected === s.id} onChange={() => setHoSelected(s.id)} />
                    <span><b>{s.title}</b><small>{new Date(s.updatedAt).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR')} · {s.id.slice(0, 8)}</small></span>
                  </label>
                ))}
              </div>
            )}
            {hoSessions.length > 0 && <section className="handoff-preview" aria-label={isClaudeHandoff ? cv.handoffPreviewLabelClaude : cv.handoffPreviewLabel}>
              <div className="handoff-preview-head">
                <b>{cv.handoffPreviewTitle}</b>
                <span role="status">{hoPreviewLoading ? cv.handoffPreviewLoading : hoPreviewError ? cv.handoffPreviewErr : ''}</span>
              </div>
              <pre>{hoPreviewLoading ? cv.handoffPreviewBody : hoPreviewError || (hoPreview?.sessionId === hoSelected ? (hoPreview.context.slice(-1800) || cv.handoffPreviewEmpty) : cv.handoffPreviewPick)}</pre>
            </section>}
            <div className="handoff-actions">
              <button type="button" className="btn" disabled={!selectedHoSessionVisible || handoffBusy} onClick={() => void (isClaudeHandoff ? importFromClaude() : importFromCodex())}>{isClaudeHandoff ? cv.handoffImportClaude : cv.handoffImport}</button>
              <button type="button" className="btn" disabled={!selectedHoSessionVisible || handoffBusy || !!run} onClick={() => void (isClaudeHandoff ? sendToClaude() : sendToCodex())}>{isClaudeHandoff ? cv.handoffSendClaude : cv.handoffSend}</button>
            </div>
          </section>
        </div>
      )}

      {cliStatus === 'missing' && (
        <div className="banner banner-bad">
          <AlertIcon size={15} />
          <span>
            {cv.cliMissingBanner}
          </span>
          <button className="mini-btn" onClick={props.onOpenSettings}>
            {strings.shortcuts.nl16}
          </button>
        </div>
      )}
      {!hasBridge() && (
        <div className="banner banner-bad">
          <AlertIcon size={15} />
          <span>{cv.previewModeBanner}</span>
        </div>
      )}
      {notice && (
        <div className="banner">
          <span>{notice}</span>
        </div>
      )}
      {props.paneActive && props.runningSessions.length > 0 && (
        <div className="run-status" role="status" aria-label={cv.runStripLabel}>
          <span className="t-dot running" aria-hidden="true" />
          <div className="run-status-list">
            {props.runningSessions.map((item) => item.current ? (
              <span key={item.id} className="run-status-self">{item.title} · {cv.runStripCurrent}</span>
            ) : (
              <button
                key={item.id}
                type="button"
                className="run-status-jump"
                title={formatStr(cv.runStripJump, { title: item.title })}
                aria-label={formatStr(cv.runStripJump, { title: item.title })}
                onClick={() => props.onJumpToSession(item.id)}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {props.goalGauge && (
        <div className={`goal-gauge${props.goalGauge.status === 'done' ? ' is-done' : ''}`} role="status" aria-label={`${gt.gaugeOpen}: ${props.goalGauge.title} ${props.goalGauge.progress}%`}>
          <button
            type="button"
            className="goal-gauge-main"
            onClick={props.onToggleGoals}
            title={gt.gaugeOpen}
            aria-label={`${gt.gaugeOpen}: ${props.goalGauge.title}`}
          >
            <TargetIcon size={13} />
            <span className="goal-gauge-title">{props.goalGauge.title}</span>
          </button>
          <span className="goal-bar goal-gauge-bar" aria-hidden="true">
            <span className="goal-bar-fill" style={{ width: `${props.goalGauge.progress}%` }} />
          </span>
          <button
            type="button"
            className="goal-gauge-bump"
            onClick={() => props.onBumpGoal(-10)}
            title={gt.bumpDown}
            aria-label={gt.bumpDown}
          >
            −10
          </button>
          <span className="goal-gauge-pct">{props.goalGauge.progress}%</span>
          <button
            type="button"
            className="goal-gauge-bump"
            onClick={() => props.onBumpGoal(10)}
            title={gt.bumpUp}
            aria-label={gt.bumpUp}
          >
            +10
          </button>
          <button
            type="button"
            className="icon-btn goal-gauge-stop"
            onClick={props.onStopGoal}
            title={gt.stop}
            aria-label={gt.stop}
          >
            <XIcon size={12} />
          </button>
        </div>
      )}

      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
          followScrollRef.current = nearBottom;
          chatScrollStateRef.current = { scrollTop: el.scrollTop, follow: nearBottom };
          setShowScrollBottom(!nearBottom);
          if (scrollSaveTimerRef.current !== null) window.clearTimeout(scrollSaveTimerRef.current);
          scrollSaveTimerRef.current = window.setTimeout(() => {
            scrollSaveTimerRef.current = null;
            persistChatScrollRef.current();
          }, 250);
        }}
      >
        {showEmpty && (
          <div className="welcome">
            <span className="brand-mark lg guitar" aria-hidden>
              <GuitarIcon size={40} />
            </span>
            <h2>{cv.welcomeTitle}</h2>
            <p>
              {cv.welcomeSub}
              {folder ? '' : cv.welcomeNoFolder}
            </p>
            <div className="example-row">
              {examples.map((ex) => (
                <button key={ex} className="example-btn" onClick={() => send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
            <div className="empty-hints">
              <span><code>/</code> {cv.emptyHintSlash}</span>
              <span><code>@</code> {cv.emptyHintMention}</span>
              <span>{cv.emptyHintPlan}</span>
            </div>
          </div>
        )}

        {session.messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} data-message-id={m.id} className={`msg-row right${messageMatchSet.has(m.id) ? ' msg-find-match' : ''}${messageMatches[messageFindIndex] === m.id ? ' msg-find-active' : ''}`}>
              <div className="bubble-user">{m.text}</div>
              {m.ts != null && fmtMsgTime(m.ts, lang) && (
                <span className="msg-time" title={new Date(m.ts).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR')}>{fmtMsgTime(m.ts, lang)}</span>
              )}
              {!m.text.includes('[첨부:') && (
                <button
                  className="icon-btn msg-copy msg-reuse"
                  onClick={() => restorePromptToComposer(m.text, cv.restoreMsg)}
                  title={cv.restoreTitle}
                  aria-label={cv.restoreTitle}
                >
                  <PencilIcon size={14} />
                </button>
              )}
              {m.id === latestUserMessageId && !m.text.includes('[첨부:') && !run && attach.length === 0 && hasBridge() && (
                <button
                  className="icon-btn msg-copy msg-rerun"
                  onClick={() => void rerunPrompt(m.text)}
                  title={cv.rerunSameTitle}
                  aria-label={cv.rerunSameTitle}
                >
                  <RefreshIcon size={14} />
                </button>
              )}
              <button className="icon-btn msg-copy" onClick={() => void copyMessage(m)} title={copiedMessageId === m.id ? cv.msgCopied : cv.copyMsgTitle} aria-label={cv.copyUserLabel}>
                {copiedMessageId === m.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              </button>
              <button className="icon-btn msg-copy msg-fork" onClick={() => cbRef.current.onForkSession(m.id)} title={cv.forkTitle} aria-label={cv.forkLabel}>
                <ForkIcon size={14} />
              </button>
            </div>
          ) : (
            <div key={m.id} data-message-id={m.id} className={`msg-row left${messageMatchSet.has(m.id) ? ' msg-find-match' : ''}${messageMatches[messageFindIndex] === m.id ? ' msg-find-active' : ''}`}>
              <div className="bubble-ai">
                {m.durationMs != null && m.durationMs > 0 && <div className="work-dur">{fmtDur(m.durationMs, lang)}</div>}
                <div className="md">
                  <React.Suspense fallback={<div className="md-pending">{linkifyFiles(m.text)}</div>}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                      pre({ children }: { children?: React.ReactNode }) {
                        const arr = React.Children.toArray(children);
                        const codeEl = arr[0] as React.ReactElement<{
                          className?: string;
                          children?: unknown;
                        }> | null;
                        if (codeEl && codeEl.type === 'code') {
                          const cls = codeEl.props.className || '';
                          const codeLang = (cls.match(/language-([\w-]+)/) || [])[1] || '';
                          const code = extractText(codeEl.props.children).replace(/\n$/, '');
                          return (
                            <CodeBlock
                              lang={codeLang}
                              code={code}
                              onInsert={cbRef.current.onInsertToEditor}
                            />
                          );
                        }
                        return <pre>{children}</pre>;
                      },
                      a({ href, children: linkChildren }: { href?: string; children?: React.ReactNode }) {
                        if (href && href.startsWith('#openfile:')) {
                          const rest = href.slice('#openfile:'.length);
                          const idx = rest.lastIndexOf(':');
                          const rel = decodeURIComponent(rest.slice(0, idx));
                          const line = Number(rest.slice(idx + 1)) || 1;
                          return (
                            <button
                              className="file-link"
                              title={formatStr(cv.openFileTitle, { rel, line })}
                              onClick={() => {
                                const cwd = m.cwd || folder;
                                const abs = cwd
                                  ? `${cwd}${cwd.endsWith('\\') || cwd.endsWith('/') ? '' : '\\'}${rel.replace(/\//g, '\\')}`
                                  : rel;
                                cbRef.current.onOpenFileAtLine(abs, line);
                              }}
                            >
                              {linkChildren}
                            </button>
                          );
                        }
                        return (
                          <a href={href} onClick={(e) => e.preventDefault()} title={href}>
                            {linkChildren}
                          </a>
                        );
                      },
                      }}
                    >
                      {linkifyFiles(m.text)}
                    </ReactMarkdown>
                  </React.Suspense>
                </div>
                {m.changedStats && m.changedStats.length > 0 && (
                  <div className="change-card">
                    <div className="change-head">
                      <DiffIcon size={14} />
                      <b>{formatStr(cv.editedFiles, { count: m.changedStats.length })}</b>
                      <span className="code-ok">+{m.changedStats.reduce((n, f) => n + f.added, 0)}</span>
                      <span className="code-bad">-{m.changedStats.reduce((n, f) => n + f.deleted, 0)}</span>
                      <span className="head-spacer" />
                      {m.reverted ? (
                        <span className="timeout-tag">{cv.revertedTag}</span>
                      ) : (
                        <>
                          <button
                            className="mini-btn"
                            disabled={!!run || reverting === m.id}
                            onClick={() => void doRevert(m)}
                            title={cv.revertHint}
                          >
                            {reverting === m.id ? cv.reverting : cv.undoRun}
                          </button>
                          <button
                            className="mini-btn"
                            onClick={() => cbRef.current.onOpenGitDiff(m.changedStats![0].file, m.cwd || folder)}
                            title={cv.reviewFirst}
                          >
                            {cv.reviewBtn}
                          </button>
                        </>
                      )}
                    </div>
                    {m.changedStats.map((f) => (
                      <button
                        key={f.file}
                        className="change-row"
                        title={formatStr(strings.files.diffTitle, { file: f.file })}
                        onClick={() => cbRef.current.onOpenGitDiff(f.file, m.cwd || folder)}
                      >
                        <span className="change-file">{f.file}</span>
                        <span className="code-ok">+{f.added}</span>
                        <span className="code-bad">-{f.deleted}</span>
                      </button>
                    ))}
                  </div>
                )}
                {m.cwd && verifyScripts.length > 0 && (
                  <div className="verify-row">
                    <span className="verify-label">{cv.verifyLabel}</span>
                    {verifyScripts.map((s) => {
                      const r = m.verify?.find((x) => x.script === s);
                      const busy = verifyRunning?.msgId === m.id && verifyRunning?.script === s;
                      return (
                        <button
                          key={s}
                          className={r ? (r.ok ? 'vchip ok' : 'vchip bad') : 'vchip'}
                          disabled={!!run || !!verifyRunning}
                          onClick={() => void runVerify(m, s)}
                          title={r ? `exit ${r.code} · ${new Date(r.ts).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ko-KR')}` : formatStr(cv.verifyRunTitle, { script: s })}
                        >
                          {busy ? '…' : r ? (r.ok ? <CheckIcon size={12} /> : <XIcon size={12} />) : null}
                          {s}
                        </button>
                      );
                    })}
                  </div>
                )}
                {m.verify && m.verify.length > 0 && m.verify[m.verify.length - 1].tail && (
                  <details className="verify-out">
                    <summary>{cv.verifyOut}</summary>
                    <pre>{m.verify[m.verify.length - 1].tail}</pre>
                  </details>
                )}
                {m.todos && m.todos.length > 0 && (
                  <details className="todo-done">
                    <summary>{formatStr(cv.todosDone, { done: m.todos.filter((t) => t.status === 'completed').length, total: m.todos.length })}</summary>
                    <TodoList items={m.todos} cv={cv} />
                  </details>
                )}
                {m.durationMs != null ||
                (m.code !== null && m.code !== undefined) ||
                m.stderr ||
                m.cwd ||
                m.plan ||
                retryPrompts.has(m.id) ||
                (m.changedFiles && m.changedFiles.length > 0) ? (
                  <div className="msg-meta">
                    {m.plan && <span className="msg-plan-tag">{cv.planTag}</span>}
                    {m.usage && (
                      <span
                        title={formatStr(cv.tokensTitle, {
                          in: (m.usage.inputTokens || 0).toLocaleString(),
                          out: (m.usage.outputTokens || 0).toLocaleString(),
                          cached: m.usage.cachedTokens ? formatStr(cv.tokensCached, { n: m.usage.cachedTokens.toLocaleString() }) : '',
                          reasoning: m.usage.reasoningTokens ? formatStr(cv.tokensReasoning, { n: m.usage.reasoningTokens.toLocaleString() }) : '',
                        })}
                      >
                        {formatStr(cv.tokensLabel, { n: fmtTokens((m.usage.inputTokens || 0) + (m.usage.outputTokens || 0)) })}
                      </span>
                    )}
                    {m.code !== null && m.code !== undefined && (
                      <span className={m.code === 0 ? 'code-ok' : 'code-bad'}>
                        {formatStr(cv.exitCode, { code: m.code })}
                      </span>
                    )}
                    {m.cwd && <span title={m.cwd}>{formatStr(cv.runAt, { cwd: baseName(m.cwd) })}</span>}
                    {m.work && m.work.length > 0 && (
                      <details>
                        <summary>{formatStr(cv.workLog, { n: m.work.length })}</summary>
                        <pre className="worklog">{m.work.join('\n')}</pre>
                      </details>
                    )}
                    {m.stderr && (
                      <details>
                        <summary>{cv.stderrView}</summary>
                        <pre className="stderr">{m.stderr}</pre>
                      </details>
                    )}
                    {m.timeout && <span className="timeout-tag">{cv.timedOut}</span>}
                    {m.timeout && !run && (
                      <button className="mini-btn" onClick={() => continueRun(m)}>
                        {cv.continueBtn}
                      </button>
                    )}
                    {retryPrompts.has(m.id) && !run && (
                      <button className="mini-btn" title={cv.retryRestoreTitle} onClick={() => restorePromptToComposer(retryPrompts.get(m.id) || '', cv.retryRestored)}>
                        {strings.common.retry}
                      </button>
                    )}
                    {m.checkpointId && !m.reverted && !run && (
                      <button
                        className="mini-btn checkpoint-restore"
                        disabled={reverting === m.id}
                        title={cv.checkpointMsg}
                        onClick={() => void doCheckpointRestore(m)}
                      >
                        {reverting === m.id ? cv.reverting : cv.checkpointBtn}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              {m.ts != null && fmtMsgTime(m.ts, lang) && (
                <span className="msg-time" title={new Date(m.ts).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR')}>{fmtMsgTime(m.ts, lang)}</span>
              )}
              <button className="icon-btn msg-copy" onClick={() => void copyMessage(m)} title={copiedMessageId === m.id ? cv.msgCopied : cv.copyMsgTitle} aria-label={cv.copyAiLabel}>
                {copiedMessageId === m.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              </button>
              <button className="icon-btn msg-copy msg-fork" onClick={() => cbRef.current.onForkSession(m.id)} title={cv.forkTitle} aria-label={cv.forkLabel}>
                <ForkIcon size={14} />
              </button>
            </div>
          ),
        )}

        {userInputs.map((prompt) => (
          <MspUserInputCard
            key={prompt.key}
            prompt={prompt}
            onAnswer={(answers) => api().mspUserInputAnswer(prompt.key, answers)}
            onCancel={() => api().mspUserInputCancel(prompt.key)}
          />
        ))}

        {run && (
          <div className="msg-row left">
            <div className="bubble-ai streaming">
              {streamText ? (
                <div className="md">
                  <React.Suspense fallback={<div className="md-pending">{linkifyFiles(streamText)}</div>}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{linkifyFiles(streamText)}</ReactMarkdown>
                  </React.Suspense>
                </div>
              ) : (
                awaitingUserInput
                  ? <div className="waiting-input-status"><span aria-hidden="true" />{cv.waitingInput}</div>
                  : <div className="typing">
                    <span />
                    <span />
                    <span />
                  </div>
              )}
              {mspActs.length > 0 && (
                <div className="act-list">
                  {mspActs.slice(-5).map((a) => (
                    <div key={a.key} className="act-row" title={a.target || a.tool}>
                      <span className={a.live ? 't-dot running' : 't-dot done'} />
                      <span className="act-tool">{a.toolLabel}</span>
                      {a.target && <span className="act-target">{a.target}</span>}
                      <span className="act-status">{a.statusLabel}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="msg-meta">
                <span>
                  {awaitingUserInput ? formatStr(cv.waitSecs, { s: elapsed }) : formatStr(cv.workSecs, { s: elapsed })}
                  {formatStr(cv.receivedChars, { n: (streamText.length + streamStderr.length + streamActivity.length).toLocaleString() })}
                </span>
                {(streamStderr || streamActivity) && (
                  <details>
                    <summary>{cv.progressLog}</summary>
                    <pre className="stderr">
                      {(() => {
                        const all = [streamStderr, streamActivity].filter(Boolean).join('\n');
                        return all.length > 2000 ? '…\n' + all.slice(-2000) : all;
                      })()}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showScrollBottom && (
        <button
          className="scroll-bottom"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            followScrollRef.current = true;
            setShowScrollBottom(false);
          }}
        >
          <ChevronDownIcon size={15} /> {cv.scrollBottom}
        </button>
      )}

      {approvals.length > 0 && (
        <ApprovalPanel
          approvals={approvals}
          onDecide={(key, choiceId, feedback) => {
            api().mspDecide(key, choiceId, feedback).catch(() => {});
            setApprovals((prev) => prev.filter((x) => x.key !== key));
          }}
        />
      )}
      <footer className={`composer${props.paneActive && props.goalsOpen ? ' composer-has-panel' : ''}${props.paneActive && props.goalSetup ? ' composer-has-setup' : ''}`}>
        {run && input.trim() && (
          <div className="interrupt-bar" role="group" aria-label={cv.interruptBarLabel}>
            <span className="interrupt-bar-head">{cv.interruptBarHead}</span>
            <span className="interrupt-bar-text" title={input.trim()}>{input.trim()}</span>
            <span className="interrupt-bar-actions">
              <button type="button" className="btn btn-primary interrupt-go" onClick={interrupt} title={cv.interruptTitle}>{cv.interruptBtn}</button>
              <button type="button" className="btn interrupt-cancel" onClick={cancelInterruptDraft} title={cv.interruptCancelTitle}>{strings.common.cancel}</button>
            </span>
          </div>
        )}
        {runSummary && (
          <div className={runStripOpen ? 'run-strip open' : 'run-strip'} role="status" aria-label={cv.runStripTitle}>
            <button
              type="button"
              className={runStripOpen ? 'run-strip-toggle open' : 'run-strip-toggle'}
              aria-expanded={runStripOpen}
              title={runStripOpen ? cv.runStripCollapse : cv.runStripExpand}
              aria-label={runStripOpen ? cv.runStripCollapse : cv.runStripExpand}
              onClick={() => setRunStripOpen((v) => !v)}
            >
              <DiffIcon size={13} />
              <span className="run-strip-title">{cv.runStripTitle}</span>
              <span className="code-ok">+{runSummary.added}</span>
              {' '}
              <span className="code-bad">−{runSummary.deleted}</span>
              <ChevronDownIcon size={12} className="chevron" />
            </button>
            {runStripOpen && (
              <div className="run-strip-list" role="group" aria-label={cv.runStripTitle}>
                {runSummary.files.map((f) => (
                  <button
                    key={f.file}
                    type="button"
                    className="run-strip-row"
                    title={formatStr(cv.runStripOpen, { file: f.file })}
                    aria-label={formatStr(cv.runStripOpen, { file: f.file })}
                    onClick={() => cbRef.current.onOpenGitDiff(f.file, runSummary.cwd || folder)}
                  >
                    <span className="run-strip-file">{f.file}</span>
                    <span className="code-ok">+{f.added}</span>
                    <span className="code-bad">−{f.deleted}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {props.paneActive && props.goalsOpen && (
          <GoalsPanel
            store={props.goalStore}
            onStoreChange={props.onGoalStoreChange}
            sessions={props.goalSessions}
            activeSessionId={session.id}
            onJumpToSession={props.onJumpToSession}
            onGoalStarted={runGoalNow}
            onNewViaChat={enterGoalSetup}
            onClose={() => { props.onToggleGoals(); composerInputRef.current?.focus(); }}
          />
        )}
        {props.paneActive && props.goalSetup && (
          <div className="goal-setup" role="status">
            <TargetIcon size={13} />
            <span className="goal-setup-main">
              <b>{gt.setupTitle}</b>
              <span>{gt.setupHint}</span>
            </span>
            <button
              type="button"
              className="btn goal-setup-list"
              onClick={() => { props.onOpenGoals(); props.onGoalSetupChange(false); }}
            >
              {gt.setupList}
            </button>
            <button
              type="button"
              className="icon-btn goal-setup-cancel"
              onClick={() => props.onGoalSetupChange(false)}
              title={gt.setupCancel}
              aria-label={gt.setupCancel}
            >
              <XIcon size={12} />
            </button>
          </div>
        )}
        <div
          className={`composer-box${dropActive || dropPathActive ? ' composer-drop-active' : ''}${props.paneActive && props.goalsOpen ? ' composer-panel-above' : ''}${props.paneActive && props.goalSetup ? ' composer-setup-above' : ''}`}
          onDragEnter={(event) => {
            const types = Array.from(event.dataTransfer.types);
            const isProjectPath = types.includes('application/x-musician-file-path');
            if (!types.includes('Files') && !isProjectPath) return;
            event.preventDefault();
            dragDepthRef.current += 1;
            setDropActive(true);
            setDropPathActive(isProjectPath && !types.includes('Files'));
          }}
          onDragOver={(event) => {
            const types = Array.from(event.dataTransfer.types);
            const isProjectPath = types.includes('application/x-musician-file-path');
            if (!types.includes('Files') && !isProjectPath) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setDropPathActive(isProjectPath && !types.includes('Files'));
          }}
          onDragLeave={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (!types.includes('Files') && !types.includes('application/x-musician-file-path')) return;
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) {
              setDropActive(false);
              setDropPathActive(false);
            }
          }}
          onDrop={(event) => {
            const types = Array.from(event.dataTransfer.types);
            const isProjectPath = types.includes('application/x-musician-file-path');
            if (!types.includes('Files') && !isProjectPath) return;
            event.preventDefault();
            dragDepthRef.current = 0;
            setDropActive(false);
            setDropPathActive(false);
            if (run) return;
            if (isProjectPath && !types.includes('Files')) {
              const path = event.dataTransfer.getData('application/x-musician-file-path');
              if (path) {
                insertPathAtCursor(path);
                setNotice(cv.projectPathInserted);
              }
              return;
            }
            const files = Array.from(event.dataTransfer.files);
            const paths = files.flatMap((file) => {
              try { const filePath = api().getPathForFile(file); return filePath ? [filePath] : []; }
              catch { return []; }
            });
            if (files.length && paths.length === 0) setNotice(cv.dropPathFailed);
            else void attachFiles(paths);
          }}
        >
          {(dropActive || dropPathActive) && <div className="composer-drop-overlay">{dropPathActive ? <FileIcon size={18} /> : <ClipIcon size={18} />} {dropPathActive ? cv.dropInsert : cv.dropAttach}</div>}
          <details className="cmd-preview">
            <summary>
              <TerminalIcon size={13} /> {cv.cmdPreview}
            </summary>
            <code>
              {buildCmdPreview(
                settings,
                input.trim() || cv.cmdPromptPh,
                props.cliResolved || settings.cliPath || 'muse',
                planMode,
              )}
            </code>
            <div className="cmd-cwd">{formatStr(cv.cmdCwd, { folder: folder || cv.cmdCwdDefault })}</div>
          </details>
          {fileMention && <div className="composer-file-mention" id="composer-file-mention-results" role="listbox" aria-label={cv.mentionLabel} aria-busy={fileMentionLoading}>
            <div className="composer-file-mention-heading">{cv.mentionHead} <span>{cv.mentionKeys}</span></div>
            {!props.folder ? <div className="composer-file-mention-empty">{cv.mentionNoFolder}</div>
              : !hasBridge() ? <div className="composer-file-mention-empty">{cv.mentionNoApp}</div>
                : !fileMention.query ? <div className="composer-file-mention-empty">{cv.mentionKeepTyping}</div>
                  : fileMentionLoading ? <div className="composer-file-mention-empty">{cv.mentionSearching}</div>
                    : fileMentionResults.length ? fileMentionResults.map((result, index) => (
                      <button type="button" role="option" aria-selected={index === fileMentionIndex} id={`composer-file-mention-${index}`} key={result.path} className={index === fileMentionIndex ? 'composer-file-mention-option active' : 'composer-file-mention-option'} title={result.relativePath} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setFileMentionIndex(index)} onClick={() => acceptFileMention(result)}>
                        <FileTypeIcon size={15} name={result.relativePath} />
                        <span>{result.relativePath.split('/').pop() || result.relativePath}</span>
                        <small>{result.relativePath}</small>
                      </button>
                    )) : <div className="composer-file-mention-empty">{cv.mentionNone}</div>}
          </div>}
          {slashOpen && <div className="composer-slash" id="composer-slash-results" role="listbox" aria-label={cv.slashLabel}>
            <div className="composer-slash-heading">{cv.slashHead} <span>{cv.slashKeys}</span></div>
            {slashResults.length ? slashResults.map((cmd, index) => (
              <button type="button" role="option" aria-selected={index === slashIndex} id={`composer-slash-${index}`} key={cmd.id} className={index === slashIndex ? 'composer-slash-option active' : 'composer-slash-option'} title={cmd.hint} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSlashIndex(index)} onClick={() => acceptSlashCommand(index)}>
                <code>{cmd.name}</code>
                {'kind' in cmd && cmd.kind === 'custom' && <span className="composer-slash-badge">{cv.customBadge}</span>}
                <span>{cmd.title}</span>
                <small>{cmd.hint}</small>
              </button>
            )) : <div className="composer-file-mention-empty">{cv.slashNone}</div>}
          </div>}
          {(queuedPrompts.length > 0 || queuePaused) && (
            <div className="queued-prompts" aria-label={cv.queueLabel}>
              <div className="queued-prompts-head">
                <span>{cv.queueHead}</span>
                <span className="queued-prompts-count">{queuedPrompts.length}</span>
                <span className="queued-prompts-info">{queuePaused ? cv.queuePausedInfo : run && props.isActiveSession ? cv.queueAutoActive : run ? cv.queueAutoAway : cv.queueManual}</span>
                <span className="queued-prompts-actions">
                  <button type="button" className="queue-pause-toggle" onClick={toggleQueuePause} title={queuePaused ? cv.queueResumeTitle : cv.queuePauseTitle}>{queuePaused ? cv.queueResume : cv.queuePause}</button>
                  {!run && queuedPrompts.length > 0 && <button type="button" className="queued-run-next" onClick={runNextQueuedPrompt} title={cv.queueRunNextTitle}><SendIcon size={12} /> {cv.queueRunNext}</button>}
                </span>
              </div>
              {queuedPrompts.length === 0 && <div className="queued-empty">{cv.queueEmpty}</div>}
              {queuedPrompts.map((prompt, index) => (
                <div className="queued-prompt" key={`${index}:${prompt.slice(0, 24)}`} title={prompt}>
                  <span className="queued-prompt-index">{index + 1}</span>
                  <span className="queued-prompt-text">{prompt}</span>
                  <span className="queued-prompt-actions">
                    <button type="button" className="queue-order-btn" onClick={() => editQueuedPrompt(index)} title={cv.queueEditTitle} aria-label={formatStr(cv.queueEditLabel, { n: index + 1 })}><PencilIcon size={12} /></button>
                    <button type="button" className="queue-order-btn" disabled={index === 0} onClick={() => setQueuedPrompts((current) => moveQueuedPrompt(current, index, -1))} title={cv.queueFwdTitle} aria-label={formatStr(cv.queueFwdLabel, { n: index + 1 })}>↑</button>
                    <button type="button" className="queue-order-btn" disabled={index === queuedPrompts.length - 1} onClick={() => setQueuedPrompts((current) => moveQueuedPrompt(current, index, 1))} title={cv.queueBackTitle} aria-label={formatStr(cv.queueBackLabel, { n: index + 1 })}>↓</button>
                    <button type="button" className="icon-btn" onClick={() => setQueuedPrompts((current) => removeQueuedPrompt(current, index))} title={cv.queueRemoveTitle} aria-label={formatStr(cv.queueRemoveLabel, { n: index + 1 })}><XIcon size={12} /></button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {run && liveTodos.length > 0 && (
            <div className="todo-strip" aria-label={cv.todosTitle}>
              <div className="todo-strip-head">{cv.todosTitle}</div>
              <TodoList items={liveTodos} cv={cv} />
            </div>
          )}
          {attach.length > 0 && (
            <div className="attach-row">
              {attach
                .filter((a) => a.image)
                .map((a) => (
                  <span key={a.path} className="attach-img" title={a.path}>
                    {a.dataUrl ? <img src={a.dataUrl} alt={a.name} /> : <FileTypeIcon size={24} name={a.name} />}
                    <button type="button" className="icon-btn attach-x" onClick={() => removeAttach(a.path)} title={cv.attachRemove} aria-label={formatStr(cv.attachRemoveLabel, { name: a.name })}>
                      <XIcon size={12} />
                    </button>
                    <span className="attach-img-name">{a.name}</span>
                  </span>
                ))}
              {attach
                .filter((a) => !a.image)
                .map((a) => (
                  <span key={a.path} className="attach-chip" title={`${a.path}\n\n${a.content.slice(0, 500)}`}>
                    <FileTypeIcon size={14} name={a.name} /> {a.name}
                    <button type="button" className="icon-btn" onClick={() => removeAttach(a.path)} title={cv.attachRemove} aria-label={formatStr(cv.attachRemoveLabel, { name: a.name })}>
                      <XIcon size={12} />
                    </button>
                  </span>
                ))}
            </div>
          )}
          {pendingPlan && !run && (
            <div className="plan-bar" role="group" aria-label={cv.planTag}>
              <PlanIcon size={14} />
              <span className="plan-bar-text">{cv.planDoneNotice}</span>
              <button type="button" className="btn plan-execute" onClick={executePlan}>{cv.planExecute}</button>
              <button type="button" className="btn plan-dismiss" onClick={() => setPendingPlan(null)}>{cv.planDismiss}</button>
            </div>
          )}
          <textarea
            ref={composerInputRef}
            className="composer-input"
            value={input}
            onChange={(e) => {
              promptHistoryIndexRef.current = null;
              setInput(e.target.value);
              updatePopupsAtCaret(e.target);
            }}
            onClick={(event) => updatePopupsAtCaret(event.currentTarget)}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={!!fileMention || slashOpen}
            aria-controls={fileMention ? 'composer-file-mention-results' : slashOpen ? 'composer-slash-results' : undefined}
            aria-activedescendant={slashOpen && slashResults[slashIndex] ? `composer-slash-${slashIndex}` : fileMention && fileMentionResults[fileMentionIndex] ? `composer-file-mention-${fileMentionIndex}` : undefined}
            aria-keyshortcuts="ArrowUp ArrowDown Enter Shift+Enter Control+Enter Meta+Enter"
            title={run ? cv.composerQueueHint : cv.composerHistoryHint}
            onKeyDown={(e) => {
              const atPromptStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
              const composing = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
              if (slashOpen && !composing && e.key === 'Escape') {
                e.preventDefault();
                slashQueryRef.current = null;
                setSlash(null);
                setCustomSlashArgs(null);
                return;
              }
              if (slashOpen && !composing && slashResults.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                setSlashIndex((index) => (index + delta + slashResults.length) % slashResults.length);
                return;
              }
              if (slashOpen && !composing && slashResults.length && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                acceptSlashCommand();
                return;
              }
              if (slashOpen && !composing && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !slashResults.length) {
                // Unknown /command: dismiss and send as plain text.
                slashQueryRef.current = null;
                setSlash(null);
              }
              if (fileMention && !composing && e.key === 'Escape') {
                e.preventDefault();
                setFileMention(null);
                return;
              }
              if (props.goalSetup && !composing && e.key === 'Escape') {
                e.preventDefault();
                props.onGoalSetupChange(false);
                return;
              }
              if (fileMention && !composing && fileMentionResults.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                setFileMentionIndex((index) => (index + delta + fileMentionResults.length) % fileMentionResults.length);
                return;
              }
              if (fileMention && !composing && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && fileMentionResults.length) {
                e.preventDefault();
                acceptFileMention();
                return;
              }
              const plainArrow = !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !composing;
              if (plainArrow && atPromptStart && e.key === 'ArrowUp' && navigatePromptHistory(-1)) {
                e.preventDefault();
              } else if (plainArrow && atPromptStart && e.key === 'ArrowDown' && promptHistoryIndexRef.current !== null && navigatePromptHistory(1)) {
                e.preventDefault();
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && run && !e.shiftKey && !composing) {
                e.preventDefault();
                queuePrompt();
              } else if (e.key === 'Enter' && !e.shiftKey && !composing) {
                e.preventDefault();
                if (!run) send();
              }
            }}
            onKeyUp={(event) => {
              if (event.key !== 'Escape' && event.key !== 'Enter' && event.key !== 'Tab') updatePopupsAtCaret(event.currentTarget);
            }}
            onPaste={(event) => {
              const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
              const file = imageItem?.getAsFile();
              if (!file) return;
              event.preventDefault();
              if (run) {
                setNotice(cv.pasteWhileRun);
                return;
              }
              void attachPastedImage(file);
            }}
            placeholder={props.goalSetup ? gt.setupPlaceholder : (run ? (awaitingUserInput ? cv.composerPhWait : cv.composerPhRun) : cv.composerPh)}
            rows={3}
          />
          <div className="composer-bar">
            <div className="composer-action-anchor" ref={actionMenuRef}>
              <button
                type="button"
                className={`icon-btn tool-btn composer-plus-btn ${actionMenuOpen ? 'open' : ''}`}
                onClick={() => setActionMenuOpen((prev) => !prev)}
                title={cv.actionsTitle || cv.actionsBtn}
                aria-label={cv.actionsTitle || cv.actionsBtn}
                aria-haspopup="menu"
                aria-expanded={actionMenuOpen}
                disabled={!!run}
              >
                <PlusIcon size={16} />
              </button>

              {actionMenuOpen && (
                <div
                  className="composer-action-menu"
                  role="menu"
                  aria-label={cv.actionsTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setActionMenuOpen(false);
                    }
                  }}
                >
                  <div className="composer-action-heading">
                    <span>{cv.actionsTitle}</span>
                  </div>

                  <button
                    type="button"
                    className="composer-action-row"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false);
                      void pickFiles();
                    }}
                    disabled={!!run}
                  >
                    <span className="action-row-icon"><ClipIcon size={15} /></span>
                    <span className="action-row-main">
                      <span className="action-row-title">{cv.attachBtn}</span>
                      <span className="action-row-desc">{cv.actionsAttachDesc}</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`composer-action-row ${planMode ? 'active' : ''}`}
                    role="menuitem"
                    onClick={() => {
                      togglePlanMode();
                    }}
                    disabled={!!run}
                  >
                    <span className="action-row-icon"><PlanIcon size={15} /></span>
                    <span className="action-row-main">
                      <span className="action-row-title">{cv.planToggle}</span>
                      <span className="action-row-desc">{cv.planToggleTitle}</span>
                    </span>
                    <span className={`action-row-badge ${planMode ? 'on' : ''}`}>
                      {planMode ? cv.actionsPlanOn : cv.actionsPlanOff}
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`composer-action-row ${micOn ? 'active' : ''}`}
                    role="menuitem"
                    onClick={() => {
                      toggleMic();
                      setActionMenuOpen(false);
                    }}
                    disabled={!!run}
                  >
                    <span className="action-row-icon"><MicIcon size={15} /></span>
                    <span className="action-row-main">
                      <span className="action-row-title">{cv.micBtn}</span>
                      <span className="action-row-desc">{micOn ? cv.micStop : cv.actionsMicDesc}</span>
                    </span>
                    <span className={`action-row-badge ${micOn ? 'on' : ''}`}>
                      {micOn ? cv.actionsMicOn : cv.actionsMicOff}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="composer-action-row"
                    role="menuitem"
                    onClick={() => {
                      setActionMenuOpen(false);
                      props.onSchedulePrompt(input);
                    }}
                    disabled={!!run || !input.trim() || attach.length > 0}
                    title={attach.length > 0 ? cv.schedBlockedTitle : cv.schedTitle}
                    aria-label={cv.schedLabel}
                  >
                    <span className="action-row-icon"><ClockIcon size={15} /></span>
                    <span className="action-row-main">
                      <span className="action-row-title">{cv.schedLabel}</span>
                      <span className="action-row-desc">{cv.schedTitle}</span>
                    </span>
                  </button>

                  <button
                    type="button"
                    className={`composer-action-row${props.goalSetup || props.goalGauge ? ' active' : ''}`}
                    role="menuitem"
                    onClick={enterGoalSetup}
                    aria-label={gt.menuBtn}
                  >
                    <span className="action-row-icon"><TargetIcon size={15} /></span>
                    <span className="action-row-main">
                      <span className="action-row-title">{gt.menuBtn}</span>
                      <span className="action-row-desc">{gt.menuDesc}</span>
                    </span>
                  </button>

                  {folder && (
                    <button
                      type="button"
                      className="composer-action-row"
                      role="menuitem"
                      onClick={() => {
                        setActionMenuOpen(false);
                        void openHandoff('codex');
                      }}
                      disabled={!!run}
                    >
                      <span className="action-row-icon"><ForkIcon size={15} /></span>
                      <span className="action-row-main">
                        <span className="action-row-title">{cv.actionsHandoff}</span>
                        <span className="action-row-desc">{cv.actionsHandoffDesc}</span>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="composer-approval-anchor" ref={approvalMenuRef}>
              <button
                type="button"
                className={`approval-picker-btn ${approvalMenuOpen ? 'open' : ''}`}
                onClick={() => setApprovalMenuOpen((prev) => !prev)}
                disabled={!!run}
                title={cv.approvalPickerTitle}
                aria-label={cv.approvalPickerTitle}
                aria-haspopup="listbox"
                aria-expanded={approvalMenuOpen}
              >
                <span className="approval-picker-name">
                  {approvalLabel(settings.approvalMode)}
                </span>
                <ChevronDownIcon size={11} className="chevron" />
              </button>

              {approvalMenuOpen && (
                <div
                  className="composer-approval-menu"
                  role="listbox"
                  aria-label={cv.approvalPickerTitle}
                >
                  {APPROVAL_MODE_VALUES.map((v) => {
                    const selected = sanitizeApprovalMode(settings.approvalMode) === v;
                    return (
                      <button
                        key={v || '(cli)'}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`model-menu-row ${selected ? 'active' : ''}`}
                        onClick={() => { changeApproval(v); setApprovalMenuOpen(false); }}
                      >
                        <span className="model-menu-check">
                          {selected ? <CheckIcon size={12} /> : null}
                        </span>
                        <span className="model-menu-name">{approvalLabel(v)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {planMode && !run && (
              <button
                type="button"
                className="composer-pill plan"
                onClick={togglePlanMode}
                title={cv.planToggleTitle}
                aria-label={cv.planToggle}
              >
                <PlanIcon size={12} />
                <span>{cv.planBadge}</span>
                <span className="pill-x"><XIcon size={10} /></span>
              </button>
            )}

            {micOn && (
              <button
                type="button"
                className="composer-pill mic"
                onClick={toggleMic}
                title={cv.micStop}
                aria-label={cv.micStop}
              >
                <MicIcon size={12} />
                <span className="mic-pulse-dot" />
                <span>{cv.micStop}</span>
                <span className="pill-x"><XIcon size={10} /></span>
              </button>
            )}

            {run && input.trim() && <span className="composer-draft-hint" role="status">{cv.draftHint}</span>}
            <span className="bar-spacer" />

            <div className="composer-model-anchor" ref={modelPickerRef}>
              <button
                type="button"
                className={`model-picker-btn ${modelPickerOpen ? 'open' : ''}`}
                onClick={() => setModelPickerOpen((prev) => !prev)}
                disabled={!!run}
                title={cv.modelPickerTitle}
                aria-haspopup="listbox"
                aria-expanded={modelPickerOpen}
              >
                <span className="model-picker-name">
                  {effModel.value ? modelLabel(effModel.value) : strings.settings.cliDefault}
                </span>
                {session.engine === 'msp' && (
                  <span className="model-picker-msp" role="status" title={strings.settings.engineMsp} aria-label={strings.settings.engineMsp} />
                )}
                <ChevronDownIcon size={11} className="chevron" />
              </button>

              {modelPickerOpen && (
                <div
                  className="composer-model-menu"
                  role="dialog"
                  aria-label={cv.modelPickerTitle}
                >
                  <div className="model-menu-head">
                    <span className="model-menu-title">{cv.modelPickerTitle}</span>
                    <button
                      type="button"
                      className="model-menu-scope"
                      onClick={() => setSessionOnlyModel((prev) => !prev)}
                      title={cv.tuneSessionDesc}
                    >
                      <span className={`model-menu-scope-dot ${sessionOnlyModel ? 'on' : ''}`} />
                      <span>{cv.modelPickerScopeSession}</span>
                    </button>
                  </div>

                  <div className="model-menu-list" role="listbox">
                    <div
                      className="model-menu-item"
                      role="option"
                      aria-selected={!sessionModelValue && (sessionOnlyModel ? true : !settings.model)}
                    >
                      <button
                        type="button"
                        className={`model-menu-row ${(!sessionModelValue && (sessionOnlyModel ? true : !settings.model)) || !effModel.value ? 'active' : ''}`}
                        onClick={() => {
                          if (sessionOnlyModel) {
                            changeSessionModel('');
                          } else {
                            changeModel('');
                            changeSessionModel('');
                          }
                          setModelPickerOpen(false);
                        }}
                      >
                        <span className="model-menu-check">
                          {(!sessionModelValue && sessionOnlyModel) || !effModel.value ? <CheckIcon size={12} /> : null}
                        </span>
                        <span className="model-menu-name">{strings.settings.cliDefault}</span>
                        <span className="model-menu-tag">{cv.tuneFollowGlobal}</span>
                      </button>
                      <button
                        type="button"
                        className="model-menu-effort"
                        title={formatStr(cv.modelEffortTitle, { level: reasoningLevelLabel })}
                        aria-label={cv.modelEffortBtn}
                        onFocus={(e) => openReasoning(e.currentTarget)}
                        onClick={(e) => openReasoning(e.currentTarget)}
                      >
                        <SlidersIcon size={12} />
                      </button>
                    </div>

                    {modelOptions.map((m) => {
                      const isSelected = effModel.value === m;
                      return (
                        <div
                          key={`model-item-${m}`}
                          className="model-menu-item"
                          role="option"
                          aria-selected={isSelected}
                        >
                          <button
                            type="button"
                            className={`model-menu-row ${isSelected ? 'active' : ''}`}
                            onClick={() => {
                              if (sessionOnlyModel) {
                                changeSessionModel(m);
                              } else {
                                changeModel(m);
                                changeSessionModel('');
                              }
                              setModelPickerOpen(false);
                            }}
                            title={m}
                          >
                            <span className="model-menu-check">
                              {isSelected ? <CheckIcon size={12} /> : null}
                            </span>
                            <span className="model-menu-name">{modelLabel(m)}</span>
                            {m !== modelLabel(m) && <span className="model-menu-sub">{m}</span>}
                          </button>
                          <button
                            type="button"
                            className="model-menu-effort"
                            title={formatStr(cv.modelEffortTitle, { level: reasoningLevelLabel })}
                            aria-label={cv.modelEffortBtn}
                            onFocus={(e) => openReasoning(e.currentTarget)}
                            onClick={(e) => openReasoning(e.currentTarget)}
                          >
                            <SlidersIcon size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {modelPickerOpen && reasoningOpen && (
                <div
                  ref={reasonRootRef}
                  className="reason-pop"
                  role="dialog"
                  aria-label={cv.reasoningTitle}
                  style={reasonPos ? { left: reasonPos.left, top: reasonPos.top } : undefined}
                >
                  <div className="model-menu-head">
                    <span className="model-menu-title">{cv.reasoningTitle}</span>
                    <span className="model-menu-tag">{sessionOnlyModel ? cv.tuneSession : cv.reasoningGlobal}</span>
                  </div>
                  <div className="model-menu-list" role="listbox" aria-label={cv.reasoningTitle}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={reasoningValue === ''}
                      className={`model-menu-row ${reasoningValue === '' ? 'active' : ''}`}
                      onClick={() => {
                        if (reasoningValue !== '') applyReasoning('');
                        closeReasoning(true);
                      }}
                    >
                      <span className="model-menu-check">
                        {reasoningValue === '' ? <CheckIcon size={12} /> : null}
                      </span>
                      <span className="model-menu-name">{sessionOnlyModel ? cv.tuneFollowGlobal : strings.settings.cliDefault}</span>
                    </button>
                    {effortLevels.map(([v, text]) => (
                      <button
                        key={v}
                        type="button"
                        role="option"
                        aria-selected={v === reasoningValue}
                        className={`model-menu-row ${v === reasoningValue ? 'active' : ''}`}
                        onClick={() => {
                          if (v !== reasoningValue) applyReasoning(v);
                          closeReasoning(true);
                        }}
                      >
                        <span className="model-menu-check">
                          {v === reasoningValue ? <CheckIcon size={12} /> : null}
                        </span>
                        <span className="model-menu-name">{text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {activeLinkedGoal(props.goalStore, session.id) && (
              <span className="goal-wire-chip" role="status" title={cv.goalAttached} aria-label={cv.goalAttached}>
                <TargetIcon size={11} />
              </span>
            )}
            {run ? (
              <>
                <button
                  type="button"
                  className="send-btn queue"
                  onClick={queuePrompt}
                  disabled={!input.trim() || attach.length > 0 || queuedPrompts.length >= MAX_QUEUED_PROMPTS}
                  title={attach.length > 0 ? cv.queueAddBlockedTitle : cv.queueAddTitle}
                  aria-label={cv.queueAddLabel}
                ><PlusIcon size={16} /></button>
                <button type="button" className="send-btn stop" onClick={cancel} title={cv.stopTitle} aria-label={cv.stopLabel}>
                  <StopIcon size={15} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="send-btn"
                onClick={() => send()}
                disabled={!input.trim() && attach.length === 0}
                title={cv.sendTitle}
                aria-label={cv.sendLabel}
              >
                <SendIcon size={17} />
              </button>
            )}
          </div>
        </div>
      </footer>
      <div className="token-strip">
        <div
          className="xp-row"
          title={
            wRem != null && quota
              ? formatStr(cv.xp5Title, { pct: wRem.toFixed(1), reset: fmtReset(quota.window.resetsAtMs, lang), total: h5Total.toLocaleString(), in: tokenWin.h5.input.toLocaleString(), out: tokenWin.h5.output.toLocaleString() })
              : formatStr(cv.xp5TitleNoQuota, {
                  total: h5Total.toLocaleString(),
                  in: tokenWin.h5.input.toLocaleString(),
                  out: tokenWin.h5.output.toLocaleString(),
                  share: wkTotal > 0 ? formatStr(cv.xp5Share, { pct: ((h5Total / wkTotal) * 100).toFixed(1) }) : '',
                })
          }
        >
          <span className="xp-label">{cv.xp5Label}</span>
          <div className="xp-track">
            <div
              className={wRem != null && wRem <= 10 ? 'xp-fill w5 crit' : 'xp-fill w5'}
              style={{ width: `${wRem ?? (wkTotal > 0 ? (h5Total / wkTotal) * 100 : 0)}%` }}
            />
          </div>
          <span className="xp-pct">{wRem != null ? `${wRem.toFixed(0)}% · ${fmtTokens(h5Total)}` : fmtTokens(h5Total)}</span>
        </div>
        <div
          className="xp-row"
          title={
            kRem != null && quota
              ? formatStr(cv.xpWkTitle, { pct: kRem.toFixed(1), reset: fmtReset(quota.weekly.resetsAtMs, lang), total: wkTotal.toLocaleString(), in: tokenWin.wk.input.toLocaleString(), out: tokenWin.wk.output.toLocaleString() })
              : formatStr(cv.xpWkTitleNoQuota, { total: wkTotal.toLocaleString(), in: tokenWin.wk.input.toLocaleString(), out: tokenWin.wk.output.toLocaleString() })
          }
        >
          <span className="xp-label">{cv.xpWkLabel}</span>
          <div className="xp-track">
            <div
              className={kRem != null && kRem <= 10 ? 'xp-fill wk crit' : 'xp-fill wk'}
              style={{ width: `${kRem ?? (wkTotal > 0 ? 100 : 0)}%` }}
            />
          </div>
          <span className="xp-pct">{kRem != null ? `${kRem.toFixed(0)}% · ${fmtTokens(wkTotal)}` : fmtTokens(wkTotal)}</span>
        </div>
      </div>
    </section>
  );
}
