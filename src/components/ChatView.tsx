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

function friendlyError(err: string): string {
  if (err === 'CLI_NOT_FOUND')
    return 'muse CLI를 찾을 수 없습니다. CLI를 설치·로그인한 뒤 설정에서 경로를 확인하세요.';
  if (err.includes('EINVAL'))
    return 'CLI를 직접 실행할 수 없습니다 (spawn EINVAL). 설정의 CLI 경로를 확인하세요.';
  if (err === 'CANCELLED') return '(취소됨)';
  if (err.startsWith('TIMEOUT:')) return `시간 초과 (${err.slice('TIMEOUT:'.length)}ms). 설정에서 타임아웃을 늘려보세요.`;
  if (err === 'TIMEOUT') return '시간 초과. 설정에서 타임아웃을 늘려보세요.';
  return `실행 실패: ${err}`;
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

function foldMspItems(items: Map<string, MspItem>): { text: string; activity: string } {
  const texts: string[] = [];
  const acts: string[] = [];
  for (const it of items.values()) {
    if (it.kind === 'agentMessage') {
      if (it.text) texts.push(it.text);
    } else if (it.kind === 'toolCall' || it.kind === 'userShell' || it.kind === 'subagent') {
      const name = it.tool || it.kind;
      acts.push(`${name} — ${it.status}${it.failureReason ? `: ${it.failureReason}` : ''}`);
    } else if (it.kind === 'agentError' || it.kind === 'turnError') {
      if (it.message || it.fallbackText) acts.push(`실패: ${it.message || it.fallbackText}`);
    }
  }
  return { text: texts.join('\n\n'), activity: acts.join('\n') };
}

function fmtTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtReset(ms: number): string {
  const d = ms - Date.now();
  if (!ms || d <= 0) return '곧 초기화';
  const days = Math.floor(d / 86400000);
  const h = Math.floor((d % 86400000) / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  if (days > 0) return `${days}일 ${h}시간 후 초기화`;
  if (h > 0) return `${h}시간 ${m}분 후 초기화`;
  if (m > 0) return `${m}분 후 초기화`;
  return '곧 초기화';
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초 동안 작업`;
  return `${Math.floor(s / 60)}분 ${s % 60}초 동안 작업`;
}

function fmtMsgTime(ts?: number): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
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
  toolKo: string;
  target: string;
  statusKo: string;
  live: boolean;
}

const TOOL_KO: Record<string, string> = {
  read: '파일 읽기',
  edit: '파일 수정',
  write: '파일 쓰기',
  shell: '명령 실행',
  bash: '명령 실행',
  glob: '파일 찾기',
  grep: '내용 검색',
  list: '목록 조회',
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

function foldMspActs(items: Map<string, MspItem>): MspAct[] {
  const out: MspAct[] = [];
  for (const it of items.values()) {
    if (it.kind !== 'toolCall' && it.kind !== 'userShell' && it.kind !== 'subagent') continue;
    const tool = it.tool || it.kind;
    const live = it.status === 'inProgress';
    out.push({
      key: it.itemId,
      tool,
      toolKo: TOOL_KO[tool] || tool,
      target: mspTarget(it),
      statusKo:
        live
          ? '진행 중'
          : it.status === 'failed'
            ? '실패'
            : it.status === 'completed'
              ? '완료'
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
          <button className="mini-btn" onClick={copy} title="복사">
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            {copied ? '복사됨' : '복사'}
          </button>
          <button className="mini-btn" onClick={() => onInsert(code)} title="에디터 커서 위치에 삽입">
            에디터에 삽입
          </button>
        </div>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const EXAMPLES = ['이 폴더 구조를 설명해줘', '변경된 파일 diff를 요약해줘', 'README를 한국어로 작성해줘'];

const CHAT_MODELS = ['muse-spark-1.3', 'muse-spark-1.2'];

const APPROVAL_MODES: [string, string][] = [
  ['', 'CLI 기본값'],
  ['allowAll', '모두 허용'],
  ['promptUnmatched', '모르는 것만 묻기'],
  ['onRequest', '요청 시에만 묻기'],
  ['denyUnmatched', '모르는 건 거부'],
];

const REASONING_EFFORTS: [string, string][] = [
  ['', 'CLI 기본값'],
  ['none', '없음'],
  ['minimal', '최소'],
  ['low', '낮음'],
  ['medium', '보통'],
  ['high', '높음'],
  ['xhigh', '매우 높음'],
  ['max', '최대'],
  ['ultra', '울트라'],
];
const EFFORT_LEVELS = REASONING_EFFORTS.filter(([v]) => v !== '');

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
  const slashResults = useMemo(() => (slash ? matchSlashCommands(slash.query) : []), [slash]);
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
      if (!result.ok) throw new Error(result.error || '대화 미리보기를 불러오지 못했습니다.');
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
      const failedText = /^(실행 실패:|시간 초과|muse CLI를 찾을 수|CLI를 직접 실행할 수)/.test(message.text);
      const failed = !message.timeout && ((typeof message.code === 'number' && message.code !== 0) || failedText);
      const includedFiles = previousUserMessage?.text.includes('[첨부:') || previousUserMessage?.text.startsWith('[첨부:');
      if (failed && previousUserMessage && !includedFiles) prompts.set(message.id, previousUserMessage.text);
    }
    return prompts;
  }, [session.messages]);
  const latestUserMessageId = [...session.messages].reverse().find((message) => message.role === 'user')?.id;

  const restorePromptToComposer = (prompt: string, notice = '프롬프트를 입력창에 복원했어. 수정한 뒤 전송해줘.') => {
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
      setNotice('선택한 코드와 파일 위치를 입력창에 추가했어. 내용을 확인한 뒤 보내줘.');
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
      setNotice('메시지를 복사하지 못했습니다.');
    }
  };

  const exportConversation = async () => {
    if (!hasBridge()) {
      setNotice('대화 내보내기는 Electron 앱에서 사용할 수 있습니다.');
      return;
    }
    const title = session.title.replace(/[\r\n\t]+/g, ' ').trim() || 'Musician 대화';
    const transcript = formatSessionTranscript(session, { projectFallback: folder, exportedAt: Date.now() });
    try {
      const result = await api().exportMarkdown(title, transcript);
      if (!result.ok) throw new Error(result.error || '대화를 내보내지 못했습니다.');
      if (!result.canceled) setNotice('대화를 Markdown으로 저장했습니다.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const openHandoff = async () => {
    if (!folder) {
      setNotice('먼저 작업 폴더를 여세요. 같은 프로젝트의 Codex 세션만 연결할 수 있습니다.');
      return;
    }
    if (!hasBridge()) {
      setNotice('Codex 연동은 Electron 앱에서 사용할 수 있습니다.');
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
      if (!r.ok) throw new Error(r.error || 'Codex 세션을 찾지 못했습니다.');
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
      if (!r.ok || !r.context) throw new Error(r.error || '가져올 대화가 없습니다.');
      promptHistoryIndexRef.current = null;
      const draft = input;
      const draftBlock = draft.trim() ? `\n\n[Musician 작성 중인 초안 — 보존됨]\n${draft}` : '';
      setInput(`[Codex 세션에서 이어받기: ${r.title || codexSelected}]\n\n${r.context}${draftBlock}\n\n위 작업을 이어서 진행해줘.`);
      setHandoffOpen(false);
      setNotice(draft.trim() ? 'Codex 대화를 불러왔고, 기존 초안도 보존했어. 확인한 뒤 전송해줘.' : 'Codex 문맥을 입력창에 불러왔습니다. 확인한 뒤 전송하세요.');
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
      if (!r.ok) throw new Error(r.error || 'Codex로 전달하지 못했습니다.');
      setHandoffOpen(false);
      setNotice('현재 작업을 Codex 세션으로 전달하고 Codex 앱을 열었습니다.');
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
      setNotice('작업이 끝난 뒤 모델 설정을 바꿀 수 있어.');
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
      const timedOut = !!error && error.startsWith('TIMEOUT');
      const folded = isMsp ? foldMspItems(mspItemsRef.current) : { text: '', activity: '' };
      const bodyText = isMsp ? folded.text : text;
      const errText = [stderr, isMsp ? folded.activity : ''].filter(Boolean).join('\n');
      const durationMs = typeof serverDur === 'number' ? serverDur : Date.now() - (runStartRef.current || Date.now());
      const cmd = runRef.current?.cmd;
      const cwd = runRef.current?.cwd;
      const msgId = uid('m');
      const acts = isMsp ? foldMspActs(mspItemsRef.current) : [];
      const body = bodyText || (error ? friendlyError(error) : errorText ? `실행 실패: ${errorText}` : '(출력 없음)');
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
        work: acts.length > 0 ? acts.map((a) => `${a.toolKo}${a.target ? ` ${a.target}` : ''} (${a.statusKo})`) : undefined,
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
        if (changed.length > 0 && acts.length === 0) patch.work = [`파일 변경: ${changed.join(', ')}`];
        if (Object.keys(patch).length > 0) cbRef.current.onUpdateMessage(msgId, patch);
      })();
    });
    const offItem = api().onMspItem(({ reqId, item }) => {
      if (reqId !== reqRef.current || runEngineRef.current !== 'msp') return;
      if (!item || !item.itemId) return;
      mspItemsRef.current.set(item.itemId, item);
      const { text: full, activity } = foldMspItems(mspItemsRef.current);
      setStreamText(full);
      setStreamActivity(activity);
      setMspActs(foldMspActs(mspItemsRef.current));
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
      setNotice('MSP 호스트가 종료되었습니다. 다음 전송 때 다시 연결합니다.');
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
  const approvalLabel = (v: string) => APPROVAL_MODES.find(([x]) => x === v)?.[1] || v || 'CLI 기본값';
  const reasoningLabel = (v: string) => REASONING_EFFORTS.find(([x]) => x === v)?.[1] || v || 'CLI 기본값';
  const effortIdx = EFFORT_LEVELS.findIndex(([x]) => x === settings.reasoningEffort);

  const changeModel = (v: string) => {
    cbRef.current.onPatchSettings({ model: v });
    if (v && session.mspSessionId && hasBridge()) {
      api().mspSetModel(session.id, v).catch(() => setNotice('실행 중인 세션의 모델 변경에 실패했습니다.'));
    }
  };

  const changeApproval = (v: string) => {
    cbRef.current.onPatchSettings({ approvalMode: v });
    if (v && session.mspSessionId && hasBridge()) {
      api().mspSetApprovalMode(session.id, v).catch(() => setNotice('실행 중인 세션의 권한 변경에 실패했습니다.'));
    }
  };

  const changeReasoning = (v: string) => {
    cbRef.current.onPatchSettings({ reasoningEffort: v });
    if (v && session.mspSessionId && hasBridge()) {
      api().mspSetReasoning(session.id, v).catch(() => setNotice('실행 중인 세션의 추론 수준 변경에 실패했습니다.'));
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
              b.error === 'TOO_LARGE' ? `"${name}" 이미지가 너무 큽니다 (8MB 제한).` : `읽기 실패: ${b.error}`,
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
              ? `"${name}" 파일이 너무 큽니다 (2MB 제한).`
              : `읽기 실패: ${t.error}`,
          );
          continue;
        }
        const content = t.content ?? '';
        if (total + content.length > MAX_ATTACH_CHARS) {
          setNotice('첨부가 100,000자를 넘습니다.');
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
      setNotice('붙여넣은 이미지가 너무 큽니다 (8MB 제한).');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(mime)) {
      setNotice('PNG, JPEG, GIF, WebP, BMP 이미지 붙여넣기를 지원합니다.');
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('이미지를 읽지 못했습니다.'));
        reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const name = file.name || `pasted-image.${mime.split('/')[1] || 'png'}`;
      const saved = await api().savePastedImage(name, base64, mime);
      if (!saved.ok || !saved.path) throw new Error(saved.error === 'TOO_LARGE' ? '이미지가 너무 큽니다 (8MB 제한).' : saved.error || '이미지를 첨부하지 못했습니다.');
      setAttach((prev) => prev.some((item) => item.path === saved.path) ? prev : [...prev, {
        path: saved.path!,
        name,
        content: '',
        image: true,
        dataUrl,
      }]);
      setNotice('클립보드 이미지를 첨부했습니다.');
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
      setNotice('이 빌드에서는 음성 입력을 지원하지 않습니다.');
      return;
    }
    try {
      const r = new SR();
      r.lang = 'ko-KR';
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
      r.onerror = () => setNotice('음성 인식에 실패했습니다.');
      recogRef.current = r;
      setMicOn(true);
      r.start();
    } catch {
      setMicOn(false);
      setNotice('마이크를 시작할 수 없습니다.');
    }
  };

  const send = async (raw?: string, options: { preserveDraft?: boolean; ignoreAttachments?: boolean } = {}) => {
    const text = (raw ?? input).trim();
    const attachments = options.ignoreAttachments ? [] : attach;
    if ((!text && attachments.length === 0) || run) return;
    if (!hasBridge()) {
      setNotice('Electron 앱에서 실행해야 CLI를 호출할 수 있습니다.');
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
          text: friendlyError(res.error || '실행 실패'),
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
      if (res.fallback) setNotice(`MSP를 쓸 수 없어 exec로 실행합니다: ${res.fallbackReason || ''}`);
      const mcpNotice = mcpChatNotice(res.mcpHealth);
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
      setNotice('대기열은 최대 20개까지 추가할 수 있어요.');
      return;
    }
    setQueuedPrompts((current) => enqueuePrompt(current, text));
    setInput('');
    setFileMention(null);
    promptHistoryIndexRef.current = null;
    setNotice(queuePaused ? '대기열에 추가했어. 자동 실행은 일시중지 상태야.' : '대기열에 추가했어. 현재 작업이 정상 완료되면 순서대로 실행할게.');
  };

  const runNextQueuedPrompt = () => {
    if (run || queuedPrompts.length === 0) return;
    if (!hasBridge()) {
      setNotice('Electron 앱에서 실행해야 CLI를 호출할 수 있습니다.');
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
      setNotice('대기열 자동 실행을 일시중지했어. 요청은 보존돼.');
      return;
    }
    setQueuePaused(false);
    if (!run && queuedPrompts.length) runNextQueuedPrompt();
    else setNotice('대기열 자동 실행을 다시 켰어.');
  };

  const editQueuedPrompt = (index: number) => {
    const { prompt, remaining } = extractQueuedPrompt(queuedPrompts, index);
    if (prompt === null) return;
    setQueuedPrompts(remaining);
    const nextInput = input.trim() ? `${input}\n\n${prompt}` : prompt;
    setInput(nextInput);
    promptHistoryIndexRef.current = null;
    setNotice(input.trim() ? '대기 요청을 기존 초안 뒤에 붙였어. 수정한 뒤 전송하거나 다시 대기열에 넣어줘.' : '대기 요청을 초안으로 불러왔어. 수정한 뒤 전송하거나 다시 대기열에 넣어줘.');
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
      title: '같은 요청 다시 실행',
      message: '이 프롬프트를 새 실행으로 다시 보낼게. 파일 변경이나 명령이 중복될 수 있어.',
      confirmLabel: '다시 실행',
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
    if (await props.onConfirm({ title: '파일 변경 되돌리기', message: `이 턴에서 바뀐 파일 ${m.changedFiles.length}개를 되돌릴게. 새 파일은 삭제돼. 계속할까?`, confirmLabel: '변경 되돌리기', destructive: true }) !== 'confirm') return;
    setReverting(m.id);
    try {
      const r = await api().revertFiles(m.cwd, m.changedFiles);
      const failed = (r.results || []).filter((x) => !x.ok);
      if (!r.ok || failed.length > 0) {
        setNotice(`되돌리기 실패: ${failed.map((x) => x.file).join(', ') || r.error}`);
      } else {
        cbRef.current.onUpdateMessage(m.id, { reverted: true });
        setNotice('되돌렸습니다. 에디터에 열린 파일은 다시 열어주세요.');
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
  const workspaceName = activeCwd.split(/[\\/]/).filter(Boolean).pop() || activeCwd || '작업 폴더 미지정';
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
            title={activeCwd ? `작업 폴더: ${activeCwd} (클릭하여 경로 복사)` : '작업 폴더가 지정되지 않았습니다'}
            aria-label={activeCwd ? `작업 폴더 ${activeCwd} 경로 복사` : '작업 폴더 미지정'}
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
            <span className="chat-workspace-copy">{workspaceCopied ? '복사됨' : '경로 복사'}</span>
          </button>
        </div>
        <div className="chat-head-actions">
          <button className="icon-btn" onClick={() => void exportConversation()} title="대화를 Markdown으로 내보내기" aria-label="대화 내보내기">
            <ExportIcon size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setMessageFindOpen((open) => {
              if (open) setMessageFindQuery('');
              return !open;
            })}
            title="대화에서 찾기 (Ctrl+F)"
            aria-label="대화에서 찾기"
          >
            <SearchIcon size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={onToggleEditor}
            title={editorVisible ? '패널 숨기기' : '패널 보이기'}
            aria-label={editorVisible ? '파일 패널 숨기기' : '파일 패널 보이기'}
            aria-pressed={editorVisible}
          >
            <PanelIcon size={16} />
          </button>
        </div>
      </header>

      {messageFindOpen && (
        <div className="message-find" role="search" aria-label="대화에서 찾기">
          <SearchIcon size={14} />
          <input
            ref={messageFindInputRef}
            value={messageFindQuery}
            onChange={(event) => { setMessageFindQuery(event.target.value); setMessageFindIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); moveMessageMatch(event.shiftKey ? -1 : 1); }
              if (event.key === 'Escape') { setMessageFindOpen(false); setMessageFindQuery(''); }
            }}
            placeholder="이 대화에서 찾기"
            aria-label="검색어"
          />
          {messageFindQuery && <button type="button" className="icon-btn" onClick={() => { setMessageFindQuery(''); setMessageFindIndex(0); messageFindInputRef.current?.focus(); }} title="검색어 지우기" aria-label="검색어 지우기"><XIcon size={12} /></button>}
          <span className="message-find-count" role="status" aria-live="polite">{messageMatches.length ? `${Math.min(messageFindIndex + 1, messageMatches.length)} / ${messageMatches.length}개 메시지` : messageFindQuery.trim() ? '결과 없음' : ''}</span>
          <button className="icon-btn" disabled={messageMatches.length === 0} onClick={() => moveMessageMatch(-1)} title="이전 결과 (Shift+Enter)" aria-label="이전 결과"><ChevronDownIcon size={13} className="message-find-prev" /></button>
          <button className="icon-btn" disabled={messageMatches.length === 0} onClick={() => moveMessageMatch(1)} title="다음 결과 (Enter)" aria-label="다음 결과"><ChevronDownIcon size={13} /></button>
          <button className="icon-btn" onClick={() => { setMessageFindOpen(false); setMessageFindQuery(''); }} title="닫기" aria-label="검색 닫기"><XIcon size={13} /></button>
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
                <h3 id="codex-handoff-title">Codex와 이어하기</h3>
                <p>현재 작업 폴더의 최근 세션 중 선택해 대화를 이어가세요.</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setHandoffOpen(false)} disabled={handoffBusy} title="닫기" aria-label="Codex 연동 창 닫기"><XIcon size={15} /></button>
            </div>
            {handoffError && <div className="handoff-error" role="alert">{handoffError}</div>}
            {codexSessions.length > 0 && <label className="handoff-search">
              <SearchIcon size={15} />
              <input
                type="search"
                value={codexSessionQuery}
                onChange={(event) => setCodexSessionQuery(event.target.value)}
                placeholder="최근 100개 세션에서 제목 또는 ID 검색…"
                aria-label="Codex 세션 검색"
              />
              <span>{filteredCodexSessions.length}/{codexSessions.length}</span>
            </label>}
            {handoffBusy && codexSessions.length === 0 ? (
              <div className="handoff-empty">Codex 세션을 찾는 중…</div>
            ) : codexSessions.length === 0 ? (
              <div className="handoff-empty">
                {handoffError ? <button type="button" className="btn" onClick={() => void openHandoff()}>다시 시도</button> : '이 프로젝트에서 사용한 Codex 세션이 없습니다.'}
              </div>
            ) : (
              <div className="handoff-list" aria-label="Codex 세션 목록">
                {filteredCodexSessions.length === 0 ? <div className="handoff-empty">검색과 일치하는 세션이 없습니다.</div> : filteredCodexSessions.map((s) => (
                  <label key={s.id} className={codexSelected === s.id ? 'handoff-session active' : 'handoff-session'}>
                    <input type="radio" name="codex-session" checked={codexSelected === s.id} onChange={() => setCodexSelected(s.id)} />
                    <span><b>{s.title}</b><small>{new Date(s.updatedAt).toLocaleString()} · {s.id.slice(0, 8)}</small></span>
                  </label>
                ))}
              </div>
            )}
            {codexSessions.length > 0 && <section className="handoff-preview" aria-label="선택한 Codex 세션 대화 미리보기">
              <div className="handoff-preview-head">
                <b>선택한 세션의 최근 대화</b>
                <span role="status">{codexPreviewLoading ? '불러오는 중…' : codexPreviewError ? '미리보기 오류' : ''}</span>
              </div>
              <pre>{codexPreviewLoading ? '최근 대화를 불러오는 중…' : codexPreviewError || (codexPreview?.sessionId === codexSelected ? (codexPreview.context.slice(-1800) || '대화 내용이 없습니다.') : '세션을 선택해 미리보기를 확인하세요.')}</pre>
            </section>}
            <div className="handoff-actions">
              <button type="button" className="btn" disabled={!selectedCodexSessionVisible || handoffBusy} onClick={() => void importFromCodex()}>Codex에서 가져오기</button>
              <button type="button" className="btn btn-primary" disabled={!selectedCodexSessionVisible || handoffBusy || !!run} onClick={() => void sendToCodex()}>Codex로 넘기기</button>
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
              <b id="tune-dialog-title">모델 · 권한 · 추론</b>
              <button type="button" className="icon-btn" onClick={() => setTuneOpen(false)} title="닫기" aria-label="설정 창 닫기">
                <XIcon size={15} />
              </button>
            </div>
            <div className="tune-group">
              <div className="tune-title">모델</div>
              {[['', 'CLI 기본값'], ...modelOptions.map((m): [string, string] => [m, modelLabel(m)])].map(
                ([v, text]) => (
                  <button
                    key={v || '(cli)'}
                    className={v === settings.model ? 'tune-row active' : 'tune-row'}
                    title={v || 'CLI 기본값. 새 턴부터 적용'}
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
              <div className="tune-title">권한</div>
              {APPROVAL_MODES.map(([v, text]) => (
                <button
                  key={v || '(cli)'}
                  className={v === settings.approvalMode ? 'tune-row active' : 'tune-row'}
                  title="도구 실행 승인 방식"
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
              <div className="tune-title">추론<span className="tune-meter-value">{reasoningLabel(settings.reasoningEffort)}</span></div>
              <div className="tune-meter" role="radiogroup" aria-label="추론 수준">
                {EFFORT_LEVELS.map(([v, text], i) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={v === settings.reasoningEffort}
                    aria-label={text}
                    title={`${text}. 다음 턴부터 적용`}
                    className={v === settings.reasoningEffort ? 'tune-bar on' : effortIdx >= 0 && i < effortIdx ? 'tune-bar lit' : 'tune-bar'}
                    style={{ height: 8 + i * 3 }}
                    onClick={() => {
                      if (v !== settings.reasoningEffort) changeReasoning(v);
                    }}
                  />
                ))}
              </div>
              <div className="tune-meter-scale" aria-hidden="true"><span>없음</span><span>울트라</span></div>
              <button
                type="button"
                className={settings.reasoningEffort === '' ? 'tune-meter-reset active' : 'tune-meter-reset'}
                aria-label="추론 CLI 기본값"
                title="CLI 기본값으로 되돌리기"
                onClick={() => {
                  if (settings.reasoningEffort !== '') changeReasoning('');
                }}
              >
                CLI 기본값
              </button>
            </div>
            <div className="tune-foot">
              <button className="btn btn-primary" onClick={() => setTuneOpen(false)}>
                완료
              </button>
            </div>
          </section>
        </div>
      )}

      {cliStatus === 'missing' && (
        <div className="banner banner-bad">
          <AlertIcon size={15} />
          <span>
            muse CLI를 찾을 수 없습니다. CLI를 설치·로그인하거나 설정에서 경로를 지정하세요.
          </span>
          <button className="mini-btn" onClick={props.onOpenSettings}>
            설정 열기
          </button>
        </div>
      )}
      {!hasBridge() && (
        <div className="banner banner-bad">
          <AlertIcon size={15} />
          <span>브라우저 미리보기 모드입니다. CLI 호출·파일 접근은 Electron 앱에서만 됩니다.</span>
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
            <h2>Musician에서 Muse에게 물어보세요</h2>
            <p>
              입력하면 Muse가 실행되고 결과가 여기로 스트리밍됩니다.
              {folder ? '' : ' 오른쪽 패널의 파일 탭에서 작업 폴더를 열면 그 폴더 기준으로 동작합니다.'}
            </p>
            <div className="example-row">
              {EXAMPLES.map((ex) => (
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
              {m.ts != null && fmtMsgTime(m.ts) && (
                <span className="msg-time" title={new Date(m.ts).toLocaleString()}>{fmtMsgTime(m.ts)}</span>
              )}
              {!m.text.includes('[첨부:') && (
                <button
                  className="icon-btn msg-copy msg-reuse"
                  onClick={() => restorePromptToComposer(m.text, '메시지를 입력창에 복원했어. 수정한 뒤 전송해줘.')}
                  title="메시지를 입력창에 복원"
                  aria-label="메시지를 입력창에 복원"
                >
                  <PencilIcon size={14} />
                </button>
              )}
              {m.id === latestUserMessageId && !m.text.includes('[첨부:') && !run && attach.length === 0 && hasBridge() && (
                <button
                  className="icon-btn msg-copy msg-rerun"
                  onClick={() => void rerunPrompt(m.text)}
                  title="같은 프롬프트 다시 실행"
                  aria-label="같은 프롬프트 다시 실행"
                >
                  <RefreshIcon size={14} />
                </button>
              )}
              <button className="icon-btn msg-copy" onClick={() => void copyMessage(m)} title={copiedMessageId === m.id ? '복사됨' : '메시지 복사'} aria-label="사용자 메시지 복사">
                {copiedMessageId === m.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              </button>
            </div>
          ) : (
            <div key={m.id} data-message-id={m.id} className={`msg-row left${messageMatchSet.has(m.id) ? ' msg-find-match' : ''}${messageMatches[messageFindIndex] === m.id ? ' msg-find-active' : ''}`}>
              <div className="bubble-ai">
                {m.durationMs != null && m.durationMs > 0 && <div className="work-dur">{fmtDur(m.durationMs)}</div>}
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
                          const lang = (cls.match(/language-([\w-]+)/) || [])[1] || '';
                          const code = extractText(codeEl.props.children).replace(/\n$/, '');
                          return (
                            <CodeBlock
                              lang={lang}
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
                              title={`${rel}:${line} 열기`}
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
                      <b>파일 {m.changedStats.length}개 편집</b>
                      <span className="code-ok">+{m.changedStats.reduce((n, f) => n + f.added, 0)}</span>
                      <span className="code-bad">-{m.changedStats.reduce((n, f) => n + f.deleted, 0)}</span>
                      <span className="head-spacer" />
                      {m.reverted ? (
                        <span className="timeout-tag">되돌림</span>
                      ) : (
                        <>
                          <button
                            className="mini-btn"
                            disabled={!!run || reverting === m.id}
                            onClick={() => void doRevert(m)}
                            title="이 턴의 파일 변경을 되돌립니다"
                          >
                            {reverting === m.id ? '되돌리는 중…' : '실행 취소'}
                          </button>
                          <button
                            className="mini-btn"
                            onClick={() => cbRef.current.onOpenGitDiff(m.changedStats![0].file, m.cwd || folder)}
                            title="첫 번째 파일 diff 열기"
                          >
                            리뷰
                          </button>
                        </>
                      )}
                    </div>
                    {m.changedStats.map((f) => (
                      <button
                        key={f.file}
                        className="change-row"
                        title={`${f.file} diff 보기`}
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
                    <span className="verify-label">검증</span>
                    {verifyScripts.map((s) => {
                      const r = m.verify?.find((x) => x.script === s);
                      const busy = verifyRunning?.msgId === m.id && verifyRunning?.script === s;
                      return (
                        <button
                          key={s}
                          className={r ? (r.ok ? 'vchip ok' : 'vchip bad') : 'vchip'}
                          disabled={!!run || !!verifyRunning}
                          onClick={() => void runVerify(m, s)}
                          title={r ? `exit ${r.code} · ${new Date(r.ts).toLocaleTimeString()}` : `${s} 실행`}
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
                    <summary>검증 출력 보기</summary>
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
                        title={`입력 ${(m.usage.inputTokens || 0).toLocaleString()} · 출력 ${(m.usage.outputTokens || 0).toLocaleString()}${m.usage.cachedTokens ? ` · 캐시 ${m.usage.cachedTokens.toLocaleString()}` : ''}${m.usage.reasoningTokens ? ` · 추론 ${m.usage.reasoningTokens.toLocaleString()}` : ''}`}
                      >
                        토큰 {fmtTokens((m.usage.inputTokens || 0) + (m.usage.outputTokens || 0))}
                      </span>
                    )}
                    {m.code !== null && m.code !== undefined && (
                      <span className={m.code === 0 ? 'code-ok' : 'code-bad'}>
                        종료 코드 {m.code}
                      </span>
                    )}
                    {m.cwd && <span title={m.cwd}>실행 위치: {m.cwd}</span>}
                    {m.work && m.work.length > 0 && (
                      <details>
                        <summary>작업 내역 {m.work.length}</summary>
                        <pre className="worklog">{m.work.join('\n')}</pre>
                      </details>
                    )}
                    {m.stderr && (
                      <details>
                        <summary>stderr 보기</summary>
                        <pre className="stderr">{m.stderr}</pre>
                      </details>
                    )}
                    {m.timeout && <span className="timeout-tag">시간 초과됨</span>}
                    {m.timeout && !run && (
                      <button className="mini-btn" onClick={() => continueRun(m)}>
                        이어서 계속
                      </button>
                    )}
                    {retryPrompts.has(m.id) && !run && (
                      <button className="mini-btn" title="실패한 프롬프트를 입력창에 복원" onClick={() => restorePromptToComposer(retryPrompts.get(m.id) || '', '실패한 프롬프트를 입력창에 복원했어. 내용을 확인한 뒤 전송해줘.')}>
                        다시 시도
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              {m.ts != null && fmtMsgTime(m.ts) && (
                <span className="msg-time" title={new Date(m.ts).toLocaleString()}>{fmtMsgTime(m.ts)}</span>
              )}
              <button className="icon-btn msg-copy" onClick={() => void copyMessage(m)} title={copiedMessageId === m.id ? '복사됨' : '메시지 복사'} aria-label="답변 복사">
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
                  ? <div className="waiting-input-status"><span aria-hidden="true" />Muse가 답변을 기다리고 있어</div>
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
                      <span className="act-tool">{a.toolKo}</span>
                      {a.target && <span className="act-target">{a.target}</span>}
                      <span className="act-status">{a.statusKo}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="msg-meta">
                <span>
                  {awaitingUserInput ? `답변 대기 중 · ${elapsed}초` : `작업 중… ${elapsed}초`} · 수신{' '}
                  {(streamText.length + streamStderr.length + streamActivity.length).toLocaleString()}자
                </span>
                {(streamStderr || streamActivity) && (
                  <details>
                    <summary>진행 로그</summary>
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
          <ChevronDownIcon size={15} /> 맨 아래로
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
            <TerminalIcon size={13} /> 실행 명령 미리보기
          </summary>
          <code>
            {buildCmdPreview(
              settings,
              input.trim() || '(프롬프트)',
              props.cliResolved || settings.cliPath || 'muse',
            )}
          </code>
          <div className="cmd-cwd">작업 폴더: {folder || '(설정/홈 폴더)'}</div>
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
                setNotice('프로젝트 상대 경로를 프롬프트에 넣었어.');
              }
              return;
            }
            const files = Array.from(event.dataTransfer.files);
            const paths = files.flatMap((file) => {
              try { const filePath = api().getPathForFile(file); return filePath ? [filePath] : []; }
              catch { return []; }
            });
            if (files.length && paths.length === 0) setNotice('파일 경로를 가져오지 못했습니다. 앱 안으로 파일을 직접 끌어다 놓아주세요.');
            else void attachFiles(paths);
          }}
        >
          {(dropActive || dropPathActive) && <div className="composer-drop-overlay">{dropPathActive ? <FileIcon size={18} /> : <ClipIcon size={18} />} {dropPathActive ? '놓아서 상대 경로 삽입' : '놓아서 파일 첨부'}</div>}
          {fileMention && <div className="composer-file-mention" id="composer-file-mention-results" role="listbox" aria-label="프로젝트 파일 경로 자동완성" aria-busy={fileMentionLoading}>
            <div className="composer-file-mention-heading">파일 경로 삽입 <span>↑↓ 선택 · Enter 삽입 · Esc 닫기</span></div>
            {!props.folder ? <div className="composer-file-mention-empty">프로젝트 폴더를 먼저 열어주세요.</div>
              : !hasBridge() ? <div className="composer-file-mention-empty">파일 자동완성은 Musician 데스크톱 앱에서 사용할 수 있어요.</div>
                : !fileMention.query ? <div className="composer-file-mention-empty">파일 이름을 계속 입력하세요.</div>
                  : fileMentionLoading ? <div className="composer-file-mention-empty">파일을 검색하는 중…</div>
                    : fileMentionResults.length ? fileMentionResults.map((result, index) => (
                      <button type="button" role="option" aria-selected={index === fileMentionIndex} id={`composer-file-mention-${index}`} key={result.path} className={index === fileMentionIndex ? 'composer-file-mention-option active' : 'composer-file-mention-option'} title={result.relativePath} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setFileMentionIndex(index)} onClick={() => acceptFileMention(result)}>
                        <FileTypeIcon size={15} name={result.relativePath} />
                        <span>{result.relativePath.split('/').pop() || result.relativePath}</span>
                        <small>{result.relativePath}</small>
                      </button>
                    )) : <div className="composer-file-mention-empty">일치하는 프로젝트 파일이 없어요.</div>}
          </div>}
          {slash && <div className="composer-slash" id="composer-slash-results" role="listbox" aria-label="슬래시 명령">
            <div className="composer-slash-heading">슬래시 명령 <span>↑↓ 선택 · Enter 실행 · Esc 닫기</span></div>
            {slashResults.length ? slashResults.map((cmd, index) => (
              <button type="button" role="option" aria-selected={index === slashIndex} id={`composer-slash-${index}`} key={cmd.id} className={index === slashIndex ? 'composer-slash-option active' : 'composer-slash-option'} title={cmd.hint} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setSlashIndex(index)} onClick={() => acceptSlashCommand(index)}>
                <code>{cmd.name}</code>
                <span>{cmd.title}</span>
                <small>{cmd.hint}</small>
              </button>
            )) : <div className="composer-file-mention-empty">일치하는 명령이 없어요. Enter를 누르면 그대로 전송돼요.</div>}
          </div>}
          {(queuedPrompts.length > 0 || queuePaused) && (
            <div className="queued-prompts" aria-label="전송 대기열">
              <div className="queued-prompts-head">
                <span>전송 대기열</span>
                <span className="queued-prompts-count">{queuedPrompts.length}</span>
                <span className="queued-prompts-info">{queuePaused ? '자동 실행 일시중지 · 요청 보존 중' : run && props.isActiveSession ? '현재 대화 완료 시 자동 실행' : run ? '이 대화로 돌아오면 이어서 실행' : '직접 실행 대기 중'}</span>
                <span className="queued-prompts-actions">
                  <button type="button" className="queue-pause-toggle" onClick={toggleQueuePause} title={queuePaused ? '대기열 자동 실행 다시 켜기' : '현재 작업 뒤 자동 실행을 멈추고 요청을 보존'}>{queuePaused ? '자동 실행 재개' : '자동 실행 일시중지'}</button>
                  {!run && queuedPrompts.length > 0 && <button type="button" className="queued-run-next" onClick={runNextQueuedPrompt} title="대기열의 다음 요청 실행"><SendIcon size={12} /> 다음 실행</button>}
                </span>
              </div>
              {queuedPrompts.length === 0 && <div className="queued-empty">대기 중인 요청은 없어. 다음 실행부터 자동으로 이어져.</div>}
              {queuedPrompts.map((prompt, index) => (
                <div className="queued-prompt" key={`${index}:${prompt.slice(0, 24)}`} title={prompt}>
                  <span className="queued-prompt-index">{index + 1}</span>
                  <span className="queued-prompt-text">{prompt}</span>
                  <span className="queued-prompt-actions">
                    <button type="button" className="queue-order-btn" onClick={() => editQueuedPrompt(index)} title="입력창에서 수정" aria-label={`${index + 1}번째 요청 입력창에서 수정`}><PencilIcon size={12} /></button>
                    <button type="button" className="queue-order-btn" disabled={index === 0} onClick={() => setQueuedPrompts((current) => moveQueuedPrompt(current, index, -1))} title="앞으로 이동" aria-label={`${index + 1}번째 요청 앞으로 이동`}>↑</button>
                    <button type="button" className="queue-order-btn" disabled={index === queuedPrompts.length - 1} onClick={() => setQueuedPrompts((current) => moveQueuedPrompt(current, index, 1))} title="뒤로 이동" aria-label={`${index + 1}번째 요청 뒤로 이동`}>↓</button>
                    <button type="button" className="icon-btn" onClick={() => setQueuedPrompts((current) => removeQueuedPrompt(current, index))} title="대기열에서 제거" aria-label={`${index + 1}번째 대기 요청 제거`}><XIcon size={12} /></button>
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
                    <button type="button" className="icon-btn attach-x" onClick={() => removeAttach(a.path)} title="제거" aria-label={`${a.name} 첨부 제거`}>
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
                    <button type="button" className="icon-btn" onClick={() => removeAttach(a.path)} title="제거" aria-label={`${a.name} 첨부 제거`}>
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
            title={run
              ? 'Ctrl+Enter로 현재 작업 뒤에 실행할 대기열에 추가할 수 있습니다.'
              : '입력창이 비어 있을 때 ↑를 눌러 이전 프롬프트를 불러올 수 있어요.'}
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
                setNotice('실행 중에는 첨부 파일을 대기열에 넣을 수 없어요. 텍스트 요청만 대기열에 추가할 수 있습니다.');
                return;
              }
              void attachPastedImage(file);
            }}
            placeholder={run ? (awaitingUserInput ? 'Muse가 답변을 기다리는 중… 다음 요청을 미리 작성할 수 있어요.' : '작업 중… 다음 요청을 미리 작성할 수 있어요.') : 'Muse에게 보내기 (Enter 전송, / 명령, 시계 예약)'}
            rows={3}
          />
          <div className="composer-bar">
            <button
              type="button"
              className="icon-btn tool-btn"
              onClick={() => void pickFiles()}
              title="파일 첨부"
              aria-label="파일 첨부"
              disabled={!!run}
            >
              <ClipIcon size={17} />
            </button>
            <button
              type="button"
              className={micOn ? 'icon-btn tool-btn mic on' : 'icon-btn tool-btn mic'}
              onClick={toggleMic}
              title={micOn ? '음성 입력 중지' : '음성 입력'}
              aria-label={micOn ? '음성 입력 중지' : '음성 입력'}
              disabled={!!run}
            >
              <MicIcon size={17} />
            </button>
            <button
              type="button"
              className="icon-btn tool-btn"
              onClick={() => props.onSchedulePrompt(input)}
              title={attach.length > 0 ? '첨부가 있으면 예약할 수 없어 (텍스트만 예약돼)' : '입력 내용을 나중에 자동 실행되도록 예약'}
              aria-label="프롬프트 예약"
              disabled={!!run || !input.trim() || attach.length > 0}
            >
              <ClockIcon size={17} />
            </button>
            {run && input.trim() && <span className="composer-draft-hint" role="status">다음 요청 초안 · + 버튼 또는 Ctrl+Enter로 대기열 추가</span>}
            <span className="bar-spacer" />
            <button
              className="tune-btn"
              onClick={() => setTuneOpen(true)}
              disabled={!!run}
              title="모델 · 권한 · 추론 설정"
            >
              <SlidersIcon size={14} />
              <span className="tune-btn-text">
                {settings.model ? modelLabel(settings.model) : 'CLI 기본값'}
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
                  title={attach.length > 0 ? '첨부 파일이 포함된 요청은 대기열에 추가할 수 없습니다.' : '현재 작업이 정상 완료된 뒤 실행할 요청 추가 (Ctrl+Enter)'}
                  aria-label="현재 작업 뒤에 요청 추가"
                ><PlusIcon size={16} /></button>
                <button type="button" className="send-btn stop" onClick={cancel} title="중지 · 남은 대기열은 보존" aria-label="응답 생성 중지">
                  <StopIcon size={15} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="send-btn"
                onClick={() => send()}
                disabled={!input.trim() && attach.length === 0}
                title="전송 (Enter)"
                aria-label="메시지 전송"
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
              ? `5시간 할당량 남음 ${wRem.toFixed(1)}% · ${fmtReset(quota.window.resetsAtMs)} · 이 앱 토큰 ${h5Total.toLocaleString()} (입력 ${tokenWin.h5.input.toLocaleString()} · 출력 ${tokenWin.h5.output.toLocaleString()})`
              : `5시간 토큰 ${h5Total.toLocaleString()} (입력 ${tokenWin.h5.input.toLocaleString()} · 출력 ${tokenWin.h5.output.toLocaleString()})${
                  wkTotal > 0 ? ` — 주간의 ${((h5Total / wkTotal) * 100).toFixed(1)}%` : ''
                }`
          }
        >
          <span className="xp-label">5시간</span>
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
              ? `주간 할당량 남음 ${kRem.toFixed(1)}% · ${fmtReset(quota.weekly.resetsAtMs)} · 이 앱 토큰 ${wkTotal.toLocaleString()} (입력 ${tokenWin.wk.input.toLocaleString()} · 출력 ${tokenWin.wk.output.toLocaleString()})`
              : `주간 토큰 ${wkTotal.toLocaleString()} (입력 ${tokenWin.wk.input.toLocaleString()} · 출력 ${tokenWin.wk.output.toLocaleString()})`
          }
        >
          <span className="xp-label">주간</span>
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
