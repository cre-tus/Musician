import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangedStat, ChatMessage, CliSettings, CliStatus, CodexSessionInfo, MspApproval, MspItem, MspUserInputPrompt, Session, SubscriptionUsage, TokenWindow } from '../types';
import ApprovalPanel from './ApprovalPanel';
import MspUserInputCard from './MspUserInputCard';
import type { ConfirmOptions, ConfirmResult } from './ConfirmDialog';
import { api, buildCmdPreview, hasBridge, porcelainPath, uid } from '../lib/mudex';
import { enqueuePrompt, extractQueuedPrompt, MAX_QUEUED_PROMPTS, moveQueuedPrompt, normalizePromptQueue, removeQueuedPrompt, shouldAutoRunQueuedPrompt, takeNextPrompt } from '../lib/prompt-queue.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { runNotificationStatus, shouldShowBackgroundNotification } from '../lib/notification-rules.mjs';
import { clampChatScrollTop, parseChatScrollState } from '../lib/chat-scroll-state.mjs';
import { formatSessionTranscript } from '../lib/session-transcript.mjs';
import { findPromptFileMention, insertPromptFileMention } from '../lib/prompt-file-mention.mjs';
import { findSlashCommand, matchSlashCommands } from '../lib/slash-commands.mjs';
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
  GuitarIcon,
  MicIcon,
  PanelIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  SlidersIcon,
  StopIcon,
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
  onMspSession: (mspSessionId: string, engine: 'msp' | 'exec') => void;
  onPatchSettings: (patch: Partial<CliSettings>) => void;
  onUpdateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  onDraftStatus: (sessionId: string, hasDraft: boolean) => void;
  onQueueStatus: (sessionId: string, count: number) => void;
  onSchedulePrompt: (text: string) => void;
  scheduledFire: { sessionId: string; text: string; nonce: number } | null;
  onScheduledConsumed: (nonce: number) => void;
  onSlashCommand: (id: string) => void;
  codexSignal: number;
  tuneSignal: number;
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
  // The chat-event subscription below mounts once; handlers read the live
  // language through this ref (same pattern as cbRef for props).
  const langRef = useRef(lang);
  langRef.current = lang;
  const examples = [cv.ex0, cv.ex1, cv.ex2];
  const approvalModes: [string, string][] = [
    ['', strings.settings.cliDefault],
    ['allowAll', strings.settings.approvalAllowAll],
    ['promptUnmatched', strings.settings.approvalPromptUnmatched],
    ['onRequest', strings.settings.approvalOnRequest],
    ['denyUnmatched', strings.settings.approvalDenyUnmatched],
  ];
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
  const draftKey = `mudex:draft:${session.id}`;
  const queueKey = `mudex:queue:${session.id}`;
  const queuePausedKey = `mudex:queue-paused:${session.id}`;
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
  const slashResults = useMemo(() => (slash ? matchSlashCommands(slash.query, 16, lang) : []), [slash, lang]);
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
  const [dropActive, setDropActive] = useState(false);
  const [dropPathActive, setDropPathActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [micOn, setMicOn] = useState(false);
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
    if (!slash || !slashResults[slashIndex]) return;
    document.getElementById(`composer-slash-${slashIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [slash, slashIndex, slashResults]);
  const [messageFindOpen, setMessageFindOpen] = useState(false);
  const [messageFindQuery, setMessageFindQuery] = useState('');
  const [messageFindIndex, setMessageFindIndex] = useState(0);
  const messageFindInputRef = useRef<HTMLInputElement | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [workspaceCopied, setWorkspaceCopied] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [codexSessions, setCodexSessions] = useState<CodexSessionInfo[]>([]);
  const [codexSelected, setCodexSelected] = useState('');
  const [codexSessionQuery, setCodexSessionQuery] = useState('');
  const [codexPreview, setCodexPreview] = useState<{ sessionId: string; context: string } | null>(null);
  const [codexPreviewLoading, setCodexPreviewLoading] = useState(false);
  const [codexPreviewError, setCodexPreviewError] = useState('');
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const handoffCardRef = useRef<HTMLElement | null>(null);
  const handoffReturnFocusRef = useRef<HTMLElement | null>(null);
  const filteredCodexSessions = useMemo(() => {
    const query = codexSessionQuery.trim().toLocaleLowerCase();
    if (!query) return codexSessions;
    return codexSessions.filter((item) => `${item.title} ${item.id}`.toLocaleLowerCase().includes(query));
  }, [codexSessions, codexSessionQuery]);
  const selectedCodexSessionVisible = filteredCodexSessions.some((item) => item.id === codexSelected);

  useEffect(() => {
    if (filteredCodexSessions.length && !filteredCodexSessions.some((item) => item.id === codexSelected)) {
      setCodexSelected(filteredCodexSessions[0].id);
    }
  }, [filteredCodexSessions, codexSelected]);

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
    if (!handoffOpen || !folder || !codexSessions.some((item) => item.id === codexSelected)) {
      setCodexPreview(null);
      setCodexPreviewLoading(false);
      setCodexPreviewError('');
      return;
    }
    let cancelled = false;
    setCodexPreview(null);
    setCodexPreviewLoading(true);
    setCodexPreviewError('');
    api().codexRead(codexSelected, folder).then((result) => {
      if (cancelled) return;
      if (!result.ok) throw new Error(result.error || cv.previewFailed);
      setCodexPreview({ sessionId: codexSelected, context: result.context || '' });
    }).catch((error: unknown) => {
      if (!cancelled) setCodexPreviewError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setCodexPreviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [handoffOpen, codexSelected, codexSessions, folder]);

  const messageMatches = useMemo(() => {
    const query = messageFindQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return session.messages.filter((message) => message.text.toLocaleLowerCase().includes(query)).map((message) => message.id);
  }, [session.messages, messageFindQuery]);
  const messageMatchSet = useMemo(() => new Set(messageMatches), [messageMatches]);
  const promptHistory = useMemo(
    () => session.messages.filter((message) => message.role === 'user').map((message) => message.text).filter((text) => text.trim()),
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
    const cmd = slash ? slashResults[index] : undefined;
    if (!slash || !cmd) return false;
    promptHistoryIndexRef.current = null;
    slashQueryRef.current = null;
    setInput('');
    setFileMention(null);
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
      setFileMention(null);
      return;
    }
    slashQueryRef.current = null;
    setSlash(null);
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

  const openHandoff = async () => {
    if (!folder) {
      setNotice(cv.handoffNeedFolder);
      return;
    }
    if (!hasBridge()) {
      setNotice(cv.handoffNeedApp);
      return;
    }
    setHandoffOpen(true);
    setHandoffBusy(true);
    setHandoffError('');
    setCodexSessions([]);
    setCodexSelected('');
    setCodexSessionQuery('');
    setCodexPreview(null);
    setCodexPreviewError('');
    try {
      const r = await api().codexSessions(folder);
      if (!r.ok) throw new Error(r.error || cv.codexNotFound);
      const list = r.sessions || [];
      setCodexSessions(list);
      setCodexSelected((prev) => list.some((s) => s.id === prev) ? prev : list[0]?.id || '');
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : String(e));
    } finally {
      setHandoffBusy(false);
    }
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

  // Mini-profile "코덱스 연동하기" → App signal → open the handoff here.
  useEffect(() => {
    if (props.codexSignal > 0) void openHandoff();
  }, [props.codexSignal]);

  // Slash "/model" → App signal → open the tune popover here (idle only,
  // mirroring the composer tune button).
  useEffect(() => {
    if (props.tuneSignal <= 0) return;
    if (runRef.current) {
      setNotice(cv.tuneBusy);
      return;
    }
    setTuneOpen(true);
  }, [props.tuneSignal]);

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
      });
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
      if (a.threadKey !== cbRef.current.session.id) return;
      setApprovals((prev) => (prev.some((x) => x.key === a.key) ? prev : [...prev, a]));
    });
    const offApprDone = api().onMspApprovalResolved(({ approvalId }) => {
      if (!approvalId) return;
      setApprovals((prev) => prev.filter((x) => x.approval.approvalId !== approvalId));
    });
    const offUserInput = api().onMspUserInput((prompt) => {
      if (prompt.threadKey !== cbRef.current.session.id) return;
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

  const [tuneOpen, setTuneOpen] = useState(false);
  const tuneCardRef = useRef<HTMLElement | null>(null);
  const tuneReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!tuneOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setTuneOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [tuneOpen]);

  useEffect(() => {
    if (!tuneOpen) {
      const returnTarget = tuneReturnFocusRef.current;
      tuneReturnFocusRef.current = null;
      if (returnTarget?.isConnected) scheduleAfterPaint(() => returnTarget.focus({ preventScroll: true }));
      return;
    }
    tuneReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return scheduleAfterPaint(() => {
      const firstControl = tuneCardRef.current?.querySelector<HTMLElement>('button:not(:disabled)');
      (firstControl || tuneCardRef.current)?.focus({ preventScroll: true });
    });
  }, [tuneOpen]);

  const modelOptions = (() => {
    const ids = [...hostModels.map((m) => m.modelId), ...CHAT_MODELS].filter(
      (m, i, a) => m && a.indexOf(m) === i,
    );
    if (settings.model && !ids.includes(settings.model)) ids.unshift(settings.model);
    return ids;
  })();
  const modelLabel = (id: string) => hostModels.find((m) => m.modelId === id)?.displayLabel || id;
  const approvalLabel = (v: string) => approvalModes.find(([x]) => x === v)?.[1] || v || strings.settings.cliDefault;
  const reasoningLabel = (v: string) => reasoningEfforts.find(([x]) => x === v)?.[1] || v || strings.settings.cliDefault;
  const effortIdx = effortLevels.findIndex(([x]) => x === settings.reasoningEffort);

  const changeModel = (v: string) => {
    cbRef.current.onPatchSettings({ model: v });
    if (v && session.mspSessionId && hasBridge()) {
      api().mspSetModel(session.id, v).catch(() => setNotice(cv.modelSetFailed));
    }
  };

  const changeApproval = (v: string) => {
    cbRef.current.onPatchSettings({ approvalMode: v });
    if (v && session.mspSessionId && hasBridge()) {
      api().mspSetApprovalMode(session.id, v).catch(() => setNotice(cv.approvalSetFailed));
    }
  };

  const changeReasoning = (v: string) => {
    cbRef.current.onPatchSettings({ reasoningEffort: v });
    if (v && session.mspSessionId && hasBridge()) {
      api().mspSetReasoning(session.id, v).catch(() => setNotice(cv.reasoningSetFailed));
    }
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

  const send = async (raw?: string, options: { preserveDraft?: boolean; ignoreAttachments?: boolean } = {}) => {
    const text = (raw ?? input).trim();
    const attachments = options.ignoreAttachments ? [] : attach;
    if ((!text && attachments.length === 0) || run) return;
    if (!hasBridge()) {
      setNotice(cv.needAppCli);
      return;
    }
    const names = attachments.map((a) => a.name).join(', ');
    const display = attachments.length > 0 ? (text ? `${text}\n\n[첨부: ${names}]` : `[첨부: ${names}]`) : text;
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
    cbRef.current.onAppendUser({ id: uid('m'), role: 'user', text: display, ts: Date.now(), done: true });
    followScrollRef.current = true;
    setShowScrollBottom(false);
    cbRef.current.onTitleMaybe(text || names);
    promptHistoryIndexRef.current = null;
    if (!options.preserveDraft) {
      setInput('');
      setFileMention(null);
    }
    setNotice('');
    runStartRef.current = Date.now();
    beforeRef.current = await gitSnapshot(folder);
    try {
      const res = await api().chatStart(full, folder, cbRef.current.session.id, cbRef.current.session.mspSessionId);
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
      cbRef.current.onMspSession(res.mspSessionId || '', runEngineRef.current);
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

  const cancel = () => {
    if (run && window.mudex) {
      cancelRequestedRef.current = true;
      window.mudex.chatCancel(run.reqId).catch(() => {});
    }
  };

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
            aria-labelledby="codex-handoff-title"
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
                <h3 id="codex-handoff-title">{cv.handoffTitle}</h3>
                <p>{cv.handoffSub}</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setHandoffOpen(false)} disabled={handoffBusy} title={strings.common.close} aria-label={cv.handoffClose}><XIcon size={15} /></button>
            </div>
            {handoffError && <div className="handoff-error" role="alert">{handoffError}</div>}
            {codexSessions.length > 0 && <label className="handoff-search">
              <SearchIcon size={15} />
              <input
                type="search"
                value={codexSessionQuery}
                onChange={(event) => setCodexSessionQuery(event.target.value)}
                placeholder={cv.handoffSearchPh}
                aria-label={cv.handoffSearchLabel}
              />
              <span>{filteredCodexSessions.length}/{codexSessions.length}</span>
            </label>}
            {handoffBusy && codexSessions.length === 0 ? (
              <div className="handoff-empty">{cv.handoffLoading}</div>
            ) : codexSessions.length === 0 ? (
              <div className="handoff-empty">
                {handoffError ? <button type="button" className="btn" onClick={() => void openHandoff()}>{strings.common.retry}</button> : cv.handoffEmpty}
              </div>
            ) : (
              <div className="handoff-list" aria-label={cv.handoffListLabel}>
                {filteredCodexSessions.length === 0 ? <div className="handoff-empty">{cv.handoffNoMatch}</div> : filteredCodexSessions.map((s) => (
                  <label key={s.id} className={codexSelected === s.id ? 'handoff-session active' : 'handoff-session'}>
                    <input type="radio" name="codex-session" checked={codexSelected === s.id} onChange={() => setCodexSelected(s.id)} />
                    <span><b>{s.title}</b><small>{new Date(s.updatedAt).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR')} · {s.id.slice(0, 8)}</small></span>
                  </label>
                ))}
              </div>
            )}
            {codexSessions.length > 0 && <section className="handoff-preview" aria-label={cv.handoffPreviewLabel}>
              <div className="handoff-preview-head">
                <b>{cv.handoffPreviewTitle}</b>
                <span role="status">{codexPreviewLoading ? cv.handoffPreviewLoading : codexPreviewError ? cv.handoffPreviewErr : ''}</span>
              </div>
              <pre>{codexPreviewLoading ? cv.handoffPreviewBody : codexPreviewError || (codexPreview?.sessionId === codexSelected ? (codexPreview.context.slice(-1800) || cv.handoffPreviewEmpty) : cv.handoffPreviewPick)}</pre>
            </section>}
            <div className="handoff-actions">
              <button type="button" className="btn" disabled={!selectedCodexSessionVisible || handoffBusy} onClick={() => void importFromCodex()}>{cv.handoffImport}</button>
              <button type="button" className="btn btn-primary" disabled={!selectedCodexSessionVisible || handoffBusy || !!run} onClick={() => void sendToCodex()}>{cv.handoffSend}</button>
            </div>
          </section>
        </div>
      )}

      {tuneOpen && (
        <div className="tune-backdrop" onClick={() => setTuneOpen(false)}>
          <section
            ref={tuneCardRef}
            className="tune-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tune-dialog-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                const controls = Array.from(tuneCardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])
                  .filter((element) => element.offsetParent !== null);
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (!first || !last) {
                  event.preventDefault();
                  tuneCardRef.current?.focus();
                } else if (event.shiftKey && (document.activeElement === first || !tuneCardRef.current?.contains(document.activeElement))) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !tuneCardRef.current?.contains(document.activeElement))) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="tune-head">
              <b id="tune-dialog-title">{cv.tuneTitle}</b>
              <button type="button" className="icon-btn" onClick={() => setTuneOpen(false)} title={strings.common.close} aria-label={cv.tuneClose}>
                <XIcon size={15} />
              </button>
            </div>
            <div className="tune-group">
              <div className="tune-title">{cv.tuneModel}</div>
              {[['', strings.settings.cliDefault], ...modelOptions.map((m): [string, string] => [m, modelLabel(m)])].map(
                ([v, text]) => (
                  <button
                    key={v || '(cli)'}
                    className={v === settings.model ? 'tune-row active' : 'tune-row'}
                    title={v || cv.tuneModelDefaultTitle}
                    onClick={() => {
                      if (v !== settings.model) changeModel(v);
                    }}
                  >
                    <span className="tune-check">{v === settings.model ? <CheckIcon size={13} /> : null}</span>
                    <span className="tune-text">{text}</span>
                  </button>
                ),
              )}
            </div>
            <div className="tune-group">
              <div className="tune-title">{cv.tunePerm}</div>
              {approvalModes.map(([v, text]) => (
                <button
                  key={v || '(cli)'}
                  className={v === settings.approvalMode ? 'tune-row active' : 'tune-row'}
                  title={cv.tunePermTitle}
                  onClick={() => {
                    if (v !== settings.approvalMode) changeApproval(v);
                  }}
                >
                  <span className="tune-check">{v === settings.approvalMode ? <CheckIcon size={13} /> : null}</span>
                  <span className="tune-text">{text}</span>
                </button>
              ))}
            </div>
            <div className="tune-group">
              <div className="tune-title">{cv.tuneReasoning}<span className="tune-meter-value">{reasoningLabel(settings.reasoningEffort)}</span></div>
              <div className="tune-meter" role="radiogroup" aria-label={cv.tuneReasoningLabel}>
                {effortLevels.map(([v, text], i) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={v === settings.reasoningEffort}
                    aria-label={text}
                    title={formatStr(cv.tuneEffortTitle, { text })}
                    className={v === settings.reasoningEffort ? 'tune-bar on' : effortIdx >= 0 && i < effortIdx ? 'tune-bar lit' : 'tune-bar'}
                    style={{ height: 8 + i * 3 }}
                    onClick={() => {
                      if (v !== settings.reasoningEffort) changeReasoning(v);
                    }}
                  />
                ))}
              </div>
              <div className="tune-meter-scale" aria-hidden="true"><span>{cv.effNone}</span><span>{cv.effUltra}</span></div>
              <button
                type="button"
                className={settings.reasoningEffort === '' ? 'tune-meter-reset active' : 'tune-meter-reset'}
                aria-label={cv.tuneResetLabel}
                title={cv.tuneResetTitle}
                onClick={() => {
                  if (settings.reasoningEffort !== '') changeReasoning('');
                }}
              >
                {strings.settings.cliDefault}
              </button>
            </div>
            <div className="tune-foot">
              <button className="btn btn-primary" onClick={() => setTuneOpen(false)}>
                {cv.tuneDone}
              </button>
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
            </div>
          ) : (
            <div key={m.id} data-message-id={m.id} className={`msg-row left${messageMatchSet.has(m.id) ? ' msg-find-match' : ''}${messageMatches[messageFindIndex] === m.id ? ' msg-find-active' : ''}`}>
              <div className="bubble-ai">
                {m.durationMs != null && m.durationMs > 0 && <div className="work-dur">{fmtDur(m.durationMs, lang)}</div>}
                <div className="md">
                  <React.Suspense fallback={<div className="md-pending">{linkifyFiles(m.text)}</div>}>
                    <ReactMarkdown
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
                {m.durationMs != null ||
                (m.code !== null && m.code !== undefined) ||
                m.stderr ||
                m.cwd ||
                retryPrompts.has(m.id) ||
                (m.changedFiles && m.changedFiles.length > 0) ? (
                  <div className="msg-meta">
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
                    {m.cwd && <span title={m.cwd}>{formatStr(cv.runAt, { cwd: m.cwd })}</span>}
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
                  </div>
                ) : null}
              </div>
              {m.ts != null && fmtMsgTime(m.ts, lang) && (
                <span className="msg-time" title={new Date(m.ts).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR')}>{fmtMsgTime(m.ts, lang)}</span>
              )}
              <button className="icon-btn msg-copy" onClick={() => void copyMessage(m)} title={copiedMessageId === m.id ? cv.msgCopied : cv.copyMsgTitle} aria-label={cv.copyAiLabel}>
                {copiedMessageId === m.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
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
                    <ReactMarkdown>{linkifyFiles(streamText)}</ReactMarkdown>
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
      <footer className="composer">
        <details className="cmd-preview">
          <summary>
            <TerminalIcon size={13} /> {cv.cmdPreview}
          </summary>
          <code>
            {buildCmdPreview(
              settings,
              input.trim() || cv.cmdPromptPh,
              props.cliResolved || settings.cliPath || 'muse',
            )}
          </code>
          <div className="cmd-cwd">{formatStr(cv.cmdCwd, { folder: folder || cv.cmdCwdDefault })}</div>
        </details>
        <div
          className={dropActive || dropPathActive ? 'composer-box composer-drop-active' : 'composer-box'}
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
          {slash && <div className="composer-slash" id="composer-slash-results" role="listbox" aria-label={cv.slashLabel}>
            <div className="composer-slash-heading">{cv.slashHead} <span>{cv.slashKeys}</span></div>
            {slashResults.length ? slashResults.map((cmd, index) => (
              <button type="button" role="option" aria-selected={index === slashIndex} id={`composer-slash-${index}`} key={cmd.id} className={index === slashIndex ? 'composer-slash-option active' : 'composer-slash-option'} title={cmd.hint} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSlashIndex(index)} onClick={() => acceptSlashCommand(index)}>
                <code>{cmd.name}</code>
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
            aria-expanded={!!fileMention || !!slash}
            aria-controls={fileMention ? 'composer-file-mention-results' : slash ? 'composer-slash-results' : undefined}
            aria-activedescendant={slash && slashResults[slashIndex] ? `composer-slash-${slashIndex}` : fileMention && fileMentionResults[fileMentionIndex] ? `composer-file-mention-${fileMentionIndex}` : undefined}
            aria-keyshortcuts="ArrowUp ArrowDown Enter Shift+Enter Control+Enter Meta+Enter"
            title={run ? cv.composerQueueHint : cv.composerHistoryHint}
            onKeyDown={(e) => {
              const atPromptStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
              const composing = e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;
              if (slash && !composing && e.key === 'Escape') {
                e.preventDefault();
                slashQueryRef.current = null;
                setSlash(null);
                return;
              }
              if (slash && !composing && slashResults.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                setSlashIndex((index) => (index + delta + slashResults.length) % slashResults.length);
                return;
              }
              if (slash && !composing && slashResults.length && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                acceptSlashCommand();
                return;
              }
              if (slash && !composing && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !slashResults.length) {
                // Unknown /command: dismiss and send as plain text.
                slashQueryRef.current = null;
                setSlash(null);
              }
              if (fileMention && !composing && e.key === 'Escape') {
                e.preventDefault();
                setFileMention(null);
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
            placeholder={run ? (awaitingUserInput ? cv.composerPhWait : cv.composerPhRun) : cv.composerPh}
            rows={3}
          />
          <div className="composer-bar">
            <button
              type="button"
              className="icon-btn tool-btn"
              onClick={() => void pickFiles()}
              title={cv.attachBtn}
              aria-label={cv.attachBtn}
              disabled={!!run}
            >
              <ClipIcon size={17} />
            </button>
            <button
              type="button"
              className={micOn ? 'icon-btn tool-btn mic on' : 'icon-btn tool-btn mic'}
              onClick={toggleMic}
              title={micOn ? cv.micStop : cv.micBtn}
              aria-label={micOn ? cv.micStop : cv.micBtn}
              disabled={!!run}
            >
              <MicIcon size={17} />
            </button>
            <button
              type="button"
              className="icon-btn tool-btn"
              onClick={() => props.onSchedulePrompt(input)}
              title={attach.length > 0 ? cv.schedBlockedTitle : cv.schedTitle}
              aria-label={cv.schedLabel}
              disabled={!!run || !input.trim() || attach.length > 0}
            >
              <ClockIcon size={17} />
            </button>
            {run && input.trim() && <span className="composer-draft-hint" role="status">{cv.draftHint}</span>}
            <span className="bar-spacer" />
            <button
              className="tune-btn"
              onClick={() => setTuneOpen(true)}
              disabled={!!run}
              title={cv.tuneBtnTitle}
            >
              <SlidersIcon size={14} />
              <span className="tune-btn-text">
                {settings.model ? modelLabel(settings.model) : strings.settings.cliDefault}
              </span>
            </button>
            {session.engine === 'msp' ? <span className="tag tag-msp">MSP</span> : <span className="tag">exec</span>}
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
