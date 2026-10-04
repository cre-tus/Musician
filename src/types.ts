// Shared renderer-side types. Mirror of the electron/preload.js surface.

export interface CliSettings {
  cliPath: string;
  model: string;
  extraArgs: string;
  workdir: string;
  timeoutMs: number;
  theme: 'light' | 'dark';
  codeTheme: string;
  engine: 'auto' | 'msp' | 'exec';
  approvalMode: string;
  reasoningEffort: string;
  browserAgent: boolean;
  browserHome: string;
  backgroundNotifications: boolean;
}

export interface BrowserState {
  ok: boolean;
  visible: boolean;
  hasView: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  agentEnabled: boolean;
  error?: string;
}

export type BrowserShortcut =
  | 'focus-address' | 'find-in-page' | 'close-tab' | 'close-all-tabs'
  | 'recent-tab-next' | 'recent-tab-previous' | 'ordered-tab-left' | 'ordered-tab-right'
  | 'move-tab-left' | 'move-tab-right' | 'quick-open' | 'command-palette'
  | 'open-explorer' | 'toggle-sidebar' | 'toggle-editor' | 'open-settings'
  | 'reopen-closed-file' | 'find-in-files' | `select-tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export type BrowserEvent =
  | { type: 'url'; tabId: string; url: string }
  | { type: 'title'; tabId: string; title: string; url: string }
  | { type: 'loading'; tabId: string; loading: boolean; url: string }
  | { type: 'failed'; tabId: string; code: number; desc: string; url: string }
  | { type: 'shortcut'; tabId: string; shortcut: BrowserShortcut }
  | { type: 'find-result'; tabId: string; requestId: number; query: string; matches: number; activeMatchOrdinal: number; finalUpdate: boolean }
  | { type: 'agent'; tabId: string | null; method: string; params: string }
  | { type: 'agent-switch'; tabId: string };

export type TermEvent =
  | { type: 'output'; tabId: string; text: string; seq?: number }
  | { type: 'exit'; tabId: string; code: number | null; error?: string; seq?: number };

export interface BrowserTabInfo {
  tabId: string;
  active: boolean;
  attached: boolean;
  url: string;
  loading: boolean;
}

export type PaneTabKind = 'file' | 'browser' | 'files' | 'terminal';

export interface PaneTab {
  id: string;
  kind: PaneTabKind;
  title: string;
  pinned?: boolean;
  file?: OpenFile;
  url?: string;
  shell?: 'powershell' | 'cmd';
  cwd?: string;
}

export interface EditorApi {
  filePath: string;
  insertAtCursor: (text: string) => boolean;
  getSelection: () => { text: string; startLine: number; endLine: number } | null;
  revealLine: (line: number, column?: number) => boolean;
  openSymbolPicker: () => boolean;
  runCommand: (commandId: string) => boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  stderr?: string;
  code?: number | null;
  cmd?: string;
  cwd?: string;
  ts: number;
  done: boolean;
  durationMs?: number;
  changedFiles?: string[];
  usage?: TokenUsage;
  timeout?: boolean;
  changedStats?: ChangedStat[];
  verify?: VerifyResult[];
  reverted?: boolean;
  work?: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface ChangedStat {
  file: string;
  added: number;
  deleted: number;
}

export type GitStatusKind = 'M' | 'U' | 'A' | 'D' | 'R' | 'C' | 'T';

export interface VerifyResult {
  script: string;
  ok: boolean;
  code: number | null;
  tail: string;
  ts: number;
}

export interface TokenWindow {
  input: number;
  output: number;
}

export interface MspStatus {
  state: 'idle' | 'warming' | 'ok' | 'error';
  error?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
  cwd?: string;
  engine?: 'msp' | 'exec';
  mspSessionId?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface ApprovalChoice {
  choiceId: string;
  label: string;
  decision: string;
  scope: string;
  acceptsFeedback: boolean;
  rulePreview?: string | null;
}

export interface MspApproval {
  key: string;
  threadKey: string;
  mspSessionId: string;
  approval: {
    approvalId: string;
    toolName: string;
    subject: { kind?: string; command?: string; path?: string; host?: string; protocol?: string; target?: string; access?: string };
    rawArgs: string;
    choices: ApprovalChoice[];
  };
}

export interface MspUserInputOption {
  label: string;
  description?: string;
  preview?: { content: string; format: string };
}

export interface MspUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: MspUserInputOption[];
  selection: { mode: 'single' | 'multiple'; minSelections?: number; maxSelections?: number };
}

export interface MspUserInputPrompt {
  key: string;
  threadKey: string;
  sessionId: string;
  userInputId: string;
  toolName: string;
  questions: MspUserInputQuestion[];
  autoResolutionMs?: number;
}

export interface MspUserInputAnswer {
  questionId: string;
  selectedLabel?: string;
  selectedLabels?: string[];
  freeText?: string;
}

export interface HostSession {
  sessionId: string;
  title: string | null;
  name: string | null;
  workspaceRoot: string | null;
  status: string | null;
  turnCount: number;
  updatedAt: string | null;
  modelId: string | null;
}

export interface CodexSessionInfo {
  id: string;
  title: string;
  updatedAt: string;
}

export interface UsageWindow {
  usedPercent: number;
  resetsAtMs: number;
  windowDurationMins: number | null;
}

export interface SubscriptionUsage {
  tier: string;
  observedAtMs: number;
  window: UsageWindow;
  weekly: UsageWindow;
}

export interface OpenFile {
  path: string;
  name: string;
  original: string;
  content: string;
  dirty: boolean;
  showDiff: boolean;
  readOnly?: boolean;
  diskState?: 'changed' | 'missing' | 'unavailable';
  externalContent?: string;
  preview?: 'image' | 'pdf' | 'audio' | 'video' | 'binary';
}

export type CliStatus = 'unknown' | 'checking' | 'ok' | 'missing' | 'error';

export interface McpHealthEntry {
  name: string;
  ok: boolean;
  reason: string | null;
}

export interface ChatStartResult {
  ok: boolean;
  reqId?: string;
  cmd: string;
  cwd: string;
  error?: string;
  resolvedPath?: string;
  source?: string;
  engine?: 'msp' | 'exec';
  mspSessionId?: string;
  turnId?: string;
  fallback?: string;
  fallbackReason?: string;
  mcpHealth?: McpHealthEntry[] | null;
  diagnostics?: { reason: string; detail?: string } | null;
}

export interface MudexApi {
  showNotification: (sessionTitle: string, sessionId: string, status: 'success' | 'failed' | 'stopped' | 'scheduled') => Promise<{ ok: boolean }>;
  onNotificationClick: (fn: (event: { sessionId: string }) => void) => () => void;
  pickFolder: () => Promise<{ ok: boolean; cancelled?: boolean; path?: string }>;
  listDir: (dirPath: string) => Promise<{ ok: boolean; entries?: FileEntry[]; error?: string }>;
  watchDirectory: (root: string, directory: string) => Promise<{ ok: boolean; error?: string }>;
  unwatchDirectory: (root: string, directory: string) => Promise<{ ok: boolean; error?: string }>;
  onWorkspaceChanged: (fn: (event: { root: string; directory: string; path: string; eventType: 'rename' | 'change' }) => void) => () => void;
  onWorkspaceWatchError: (fn: (event: { root: string; directory: string; error: string }) => void) => () => void;
  createEntry: (dirPath: string, name: string, kind: 'file' | 'folder') => Promise<{ ok: boolean; path?: string; error?: string }>;
  renameEntry: (rootPath: string, entryPath: string, name: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  deleteEntry: (rootPath: string, entryPath: string) => Promise<{ ok: boolean; error?: string }>;
  revealEntry: (rootPath: string, entryPath: string) => Promise<{ ok: boolean; error?: string }>;
  searchFiles: (cwd: string, query: string, options?: { include?: string; exclude?: string; scope?: string }) => Promise<{ ok: boolean; files?: { path: string; relativePath: string }[]; truncated?: boolean; error?: string }>;
  searchInFiles: (cwd: string, query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; include?: string; exclude?: string; scope?: string }) => Promise<{ ok: boolean; matches?: { path: string; relativePath: string; lineNumber: number; lineText: string }[]; truncated?: boolean; error?: string }>;
  readFile: (filePath: string) => Promise<{ ok: boolean; content?: string; error?: string }>;
  pickFiles: () => Promise<{ ok: boolean; cancelled?: boolean; paths?: string[] }>;
  getPathForFile: (file: File) => string;
  savePastedImage: (name: string, base64: string, mime: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  exportMarkdown: (title: string, markdown: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
  readFileBytes: (filePath: string) => Promise<{ ok: boolean; base64?: string; ext?: string; mime?: string; error?: string }>;
  openFileDefault: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  openExternalLink: (url: string) => Promise<{ ok: boolean; error?: string }>;
  gitNumstat: (cwd: string) => Promise<{ ok: boolean; files?: ChangedStat[]; error?: string }>;
  verifyScripts: (cwd: string) => Promise<{ ok: boolean; scripts?: string[]; error?: string }>;
  verifyRun: (cwd: string, script: string) => Promise<{ ok: boolean; code?: number | null; tail?: string; error?: string }>;
  revertFiles: (cwd: string, files: string[]) => Promise<{ ok: boolean; results?: { file: string; ok: boolean; deleted?: boolean; error?: string }[]; error?: string }>;
  writeFile: (filePath: string, content: string, expectedOriginal?: string) => Promise<{ ok: boolean; error?: string }>;
  getSettings: () => Promise<{ ok: boolean; settings: CliSettings }>;
  saveSettings: (patch: Partial<CliSettings>) => Promise<{ ok: boolean; settings: CliSettings }>;
  cliTest: () => Promise<{
    ok: boolean;
    engine?: 'msp' | 'exec' | 'none';
    version?: string | null;
    msp?: { ok: boolean; error?: string; resolvedPath?: string; source?: string; server?: { name: string | null; version: string | null }; fingerprintWarning?: string | null; sessionMcp?: boolean };
    exec?: { ok: boolean; error?: string };
    code?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
    cmd: string;
    resolvedPath?: string;
    source?: string;
  }>;
  chatStart: (prompt: string, cwd: string, threadKey?: string, mspSessionId?: string) => Promise<ChatStartResult>;
  chatCancel: (reqId: string) => Promise<{ ok: boolean }>;
  mspPrewarm: (cwd: string) => Promise<{ ok: boolean; key?: string; error?: string }>;
  mspDecide: (key: string, choiceId: string, feedback?: string) => Promise<{ ok: boolean }>;
  mspUserInputAnswer: (key: string, answers: MspUserInputAnswer[]) => Promise<{ ok: boolean; error?: string }>;
  mspUserInputCancel: (key: string) => Promise<{ ok: boolean; error?: string }>;
  mspSessions: (cwd: string) => Promise<{ ok: boolean; sessions?: HostSession[]; error?: string }>;
  mspResume: (threadKey: string, mspSessionId: string, cwd: string) => Promise<{ ok: boolean; mspSessionId?: string; messages?: { role: string; text: string }[]; mcpHealth?: McpHealthEntry[] | null; error?: string }>;
  mspUsage: (cwd: string) => Promise<{ ok: boolean; usage?: SubscriptionUsage | null; error?: string }>;
  mspModels: (cwd: string) => Promise<{ ok: boolean; models?: { modelId: string; displayLabel: string; isActive: boolean; isDefault: boolean }[]; error?: string }>;
  mspSetModel: (threadKey: string, modelId: string) => Promise<{ ok: boolean; error?: string }>;
  mspSetApprovalMode: (threadKey: string, mode: string) => Promise<{ ok: boolean; error?: string }>;
  mspSetReasoning: (threadKey: string, effort: string) => Promise<{ ok: boolean; error?: string }>;
  mspWarmup: (cwd: string) => Promise<{ ok: boolean; sessions?: HostSession[]; usage?: SubscriptionUsage | null; error?: string }>;
  codexSessions: (cwd: string) => Promise<{ ok: boolean; sessions?: CodexSessionInfo[]; error?: string }>;
  codexRead: (sessionId: string, cwd: string) => Promise<{ ok: boolean; context?: string; title?: string; error?: string }>;
  codexQueue: (sessionId: string, cwd: string, context: string) => Promise<{ ok: boolean; error?: string }>;
  gitStatus: (cwd: string) => Promise<{ ok: boolean; files?: string[]; error?: string }>;
  gitShow: (cwd: string, file: string) => Promise<{ ok: boolean; content?: string; error?: string }>;
  gitStage: (cwd: string, files: string[], staged: boolean) => Promise<{ ok: boolean; error?: string }>;
  gitCommit: (cwd: string, message: string) => Promise<{ ok: boolean; hash?: string; error?: string }>;
  gitBranch: (cwd: string) => Promise<{ ok: boolean; branch?: string; counts?: string; remote?: string; error?: string }>;
  gitPull: (cwd: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  gitPush: (cwd: string) => Promise<{ ok: boolean; error?: string }>;
  gitClone: (url: string, target: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  sessionsSave: (sessions: Session[]) => Promise<{ ok: boolean; error?: string }>;
  sessionsLoad: () => Promise<{ ok: boolean; sessions?: Session[]; error?: string }>;
  rendererStateGet: (key: string) => Promise<{ ok: boolean; value?: string | null; error?: string }>;
  rendererStateSet: (key: string, value: string | null) => Promise<{ ok: boolean; error?: string }>;
  browserShow: (tabId: string, home?: string, initialUrl?: string) => Promise<{ ok: boolean; tabId?: string; error?: string }>;
  browserHide: (tabId?: string) => Promise<{ ok: boolean; error?: string }>;
  browserClose: (tabId: string) => Promise<{ ok: boolean; error?: string }>;
  browserBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ ok: boolean; error?: string }>;
  browserNavigate: (tabId: string, url: string) => Promise<{ ok: boolean; aborted?: boolean; url?: string; title?: string; timedOut?: boolean; error?: string; code?: number; desc?: string }>;
  browserBack: (tabId: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  browserForward: (tabId: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  browserReload: (tabId: string) => Promise<{ ok: boolean; error?: string }>;
  browserStop: (tabId: string) => Promise<{ ok: boolean; error?: string }>;
  browserFind: (tabId: string, text: string, forward?: boolean, findNext?: boolean) => Promise<{ ok: boolean; requestId?: number | null; tabId?: string; error?: string }>;
  browserState: (tabId: string) => Promise<BrowserState>;
  browserSource: (tabId: string, max?: number) => Promise<{ ok: boolean; url?: string; length?: number; truncated?: boolean; html?: string; error?: string }>;
  browserTabs: () => Promise<{ ok: boolean; tabs?: BrowserTabInfo[]; error?: string }>;
  browserMcpCmd: () => Promise<{ ok: boolean; command?: string; args?: string[]; server?: string; settingsPath?: string; settingsBlock?: string; registration?: string; error?: string }>;
  browserMcpRegister: () => Promise<{ ok: boolean; status?: string; path?: string; error?: string }>;
  browserHealth: () => Promise<{ ok: boolean; reason?: string | null; checkedAt: number; error?: string }>;
  onBrowserEvent: (fn: (p: BrowserEvent) => void) => () => void;
  onMspMcpHealth: (fn: (p: { key: string; mspSessionId: string | null; health: McpHealthEntry[] }) => void) => () => void;
  onMspMcpUnavailable: (fn: (p: { key: string; mspSessionId: string | null }) => void) => () => void;
  termStart: (tabId: string, shell: string, cwd: string, seq?: number) => Promise<{ ok: boolean; restarted?: boolean; shell?: string; seq?: number; error?: string }>;
  termInput: (tabId: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  termKill: (tabId: string) => Promise<{ ok: boolean; error?: string }>;
  onTermEvent: (fn: (p: TermEvent) => void) => () => void;
  onChatChunk: (fn: (p: { reqId: string; text: string }) => void) => () => void;
  onChatStderr: (fn: (p: { reqId: string; text: string }) => void) => () => void;
  onChatDone: (
    fn: (p: { reqId: string; code: number | null; signal?: string | null; error?: string; terminal?: string; durationMs?: number | null; usage?: TokenUsage | null; reason?: string | null; errorText?: string | null }) => void,
  ) => () => void;
  onMspReady: (fn: (p: { key: string; reason: string }) => void) => () => void;
  onMspPrewarmError: (fn: (p: { error: string; reason: string }) => void) => () => void;
  onMspItem: (fn: (p: { reqId: string; threadKey: string; turnId: string; item: MspItem }) => void) => () => void;
  onMspApproval: (fn: (p: MspApproval) => void) => () => void;
  onMspApprovalResolved: (fn: (p: { sessionId: string | null; approvalId: string | null }) => void) => () => void;
  onMspUserInput: (fn: (prompt: MspUserInputPrompt) => void) => () => void;
  onMspUserInputSettled: (fn: (p: { sessionId: string; userInputId: string }) => void) => () => void;
  onMspUsage: (fn: (p: { key: string; usage: SubscriptionUsage | null }) => void) => () => void;
  onMspTokens: (fn: (p: { sessionId: string | null; turnId: string | null; usage: TokenUsage | null; cumulative: { totalTokens: number } | null }) => void) => () => void;
  onMspSessionsChanged: (fn: (p: { key: string }) => void) => () => void;
  onMspHostDead: (fn: (p: { key: string; code: number | null }) => void) => () => void;
}

export interface MspItem {
  itemId: string;
  kind: string;
  status: string;
  revision: number;
  text?: string;
  summary?: string[];
  displayText?: string;
  fallbackText?: string;
  message?: string;
  visibleOutput?: string;
  tool?: string;
  args?: string;
  failureReason?: string;
  durationMs?: number;
}

declare global {
  interface Window {
    mudex?: MudexApi;
  }
}

export {};
