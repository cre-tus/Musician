import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import RightPane from './components/RightPane';
import UsageView from './components/UsageView';
import SettingsView from './components/SettingsView';
import Palette, { PaletteAction } from './components/Palette';
import QuickOpen from './components/QuickOpen';
import ConfirmDialog, { type ConfirmOptions, type ConfirmResult } from './components/ConfirmDialog';
import KeyboardShortcutsDialog from './components/KeyboardShortcutsDialog';
import { SchedulePromptDialog, ScheduledPromptListDialog } from './components/ScheduledPrompts';
import { SidebarIcon, XIcon } from './components/icons';
import { editorDraftStorageKey, findEditorDraft, readEditorDrafts, restoreEditorDraft, writeEditorDrafts } from './lib/editor-drafts.mjs';
import { mirrorStoredKey, seedDurableKeys } from './lib/durable-state.mjs';
import { mergeLiveWorkspaceTabs, readWorkspacePaneLayout, removeTabFromStoredWorkspaceLayouts, writeWorkspacePaneLayout } from './lib/workspace-pane-layout.mjs';
import { createUnavailableRestoredFile } from './lib/open-file-disk-state.mjs';
import { normalizePromptQueue } from './lib/prompt-queue.mjs';
import { reconcileOpenFileDiskState } from './lib/open-file-disk-state.mjs';
import { ensureFilesTabFallback, unpinnedPaneTabIds } from './lib/pane-tab-management.mjs';
import { detachProjectSessions } from './lib/project-sessions.mjs';
import { loadLastUsage, saveLastUsage } from './lib/usage-cache.mjs';
import { formatStr, sanitizeLang, STRINGS } from './lib/i18n.mjs';
import { LangContext } from './lib/lang';
import { hideHostSessionId, readHiddenHostSessionIds, visibleHostSessions } from './lib/host-session-filter.mjs';
import { shouldShowBackgroundNotification } from './lib/notification-rules.mjs';
import { clearUnread, createStopRegistry, markUnread } from './lib/session-alerts.mjs';
import { addScheduledPrompt, cancelScheduledPrompt, createScheduledPrompt, dueScheduledPrompts, fireableScheduledPrompt, formatRepeat, formatScheduledFireTime, markScheduledPrompt, readScheduledPrompts, rescheduleScheduledPrompt, rollRepeatingPrompt, staleScheduledPrompts, writeScheduledPrompts } from './lib/scheduled-prompts.mjs';
import { shouldParkBrowserForOverlays } from './lib/browser-overlay-park.mjs';
import { bookmarkHost, isBrowserBookmarked, normalizeBookmarkUrl, readBrowserBookmarks, toggleBrowserBookmark, writeBrowserBookmarks } from './lib/browser-bookmarks.mjs';
import { duplicateSession } from './lib/session-duplicate.mjs';
import type { BrowserBookmark } from './lib/browser-bookmarks.mjs';
import type { ScheduledPrompt } from './lib/scheduled-prompts.mjs';
import { resolveBootSessions } from './lib/session-boot-guard.mjs';
import { saveFilesSequentially } from './lib/save-file-batch.mjs';
import { isSameOrDescendantPath, normalizePathForComparison, pathsEqual } from './lib/path-utils.mjs';
import { createSingleFlight } from './lib/single-flight.mjs';
import { nextRecentTab, touchRecentTab } from './lib/recent-tab-history.mjs';
import { formatSessionTranscript, formatSessionTranscripts } from './lib/session-transcript.mjs';
import { createSessionBackup, parseSessionBackup, toImportSessions } from './lib/session-backup.mjs';
import { forkSession } from './lib/session-fork.mjs';
import { mcpChatNotice } from './lib/mcp-chat-notice.mjs';
import { readPinnedProjects, togglePinnedProject, writePinnedProjects } from './lib/pinned-projects.mjs';
import { prefillWorkspaceSearchQuery } from './lib/workspace-search-query.mjs';
import { scheduleAfterPaint } from './lib/after-paint.mjs';
import { editorNavigationStorageKey, pushEditorLocation, readEditorNavigationHistory, remapEditorNavigationPaths, removeEditorNavigationPaths, stepEditorLocation, toggleEditorLocationBookmark as toggleLocationBookmark, writeEditorNavigationHistory } from './lib/editor-navigation-history.mjs';
import type { BrowserShortcut, ChatMessage, CliSettings, CliStatus, EditorApi, GitStatusKind, HostSession, MspStatus, PaneTab, PaneTabKind, Session, SubscriptionUsage } from './types';
import {
  addProject,
  api,
  hasBridge,
  loadFolder,
  loadProjects,
  loadSessions,
  newSession,
  porcelainPath,
  porcelainStaged,
  porcelainStatus,
  removeProject,
  saveFolder,
  saveProjects,
  saveSessions,
  sessionTitle,
  uid,
} from './lib/mudex';

const DEFAULT_SETTINGS: CliSettings = {
  cliPath: '',
  model: '',
  extraArgs: '',
  workdir: '',
  timeoutMs: 0,
  theme: 'dark',
  codeTheme: 'auto',
  engine: 'auto',
  approvalMode: '',
  reasoningEffort: '',
  browserAgent: true,
  browserHome: '',
  backgroundNotifications: true,
  lang: 'ko',
};

type ClosedPaneTab =
  | { kind: 'file'; path: string; pinned?: boolean }
  | { kind: 'browser'; title: string; url?: string }
  | { kind: 'terminal'; title: string; shell?: 'powershell' | 'cmd'; cwd?: string }
  | { kind: 'files'; title: string };

function loadClosedPaneTabs(): ClosedPaneTab[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem('mudex:closed-tabs:v1') || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item): ClosedPaneTab[] => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      if (value.kind === 'file' && typeof value.path === 'string') return [{ kind: 'file', path: value.path, pinned: value.pinned === true }];
      if (value.kind === 'browser' && typeof value.title === 'string') return [{ kind: 'browser', title: value.title, ...(typeof value.url === 'string' ? { url: value.url } : {}) }];
      if (value.kind === 'terminal' && typeof value.title === 'string') return [{ kind: 'terminal', title: value.title, shell: value.shell === 'cmd' ? 'cmd' : 'powershell', ...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}) }];
      if (value.kind === 'files' && typeof value.title === 'string') return [{ kind: 'files', title: value.title }];
      return [];
    }).slice(-20);
  } catch {
    return [];
  }
}

function closedPaneTabSnapshot(tab: PaneTab): ClosedPaneTab | null {
  if (tab.kind === 'file' && tab.file) return { kind: 'file', path: tab.file.path, ...(tab.pinned ? { pinned: true } : {}) };
  if (tab.kind === 'browser') return { kind: 'browser', title: tab.title, ...(tab.url ? { url: tab.url } : {}) };
  if (tab.kind === 'terminal') return { kind: 'terminal', title: tab.title, shell: tab.shell, ...(tab.cwd ? { cwd: tab.cwd } : {}) };
  if (tab.kind === 'files') return { kind: 'files', title: tab.title };
  return null;
}

function setPaneTabPinnedOrder(tabs: PaneTab[], tabId: string, pinned: boolean): PaneTab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId && tab.kind === 'file');
  if (index < 0 || !!tabs[index].pinned === pinned) return tabs;
  const next = [...tabs];
  const [tab] = next.splice(index, 1);
  const updated = { ...tab, pinned };
  const firstUnpinned = next.findIndex((candidate) => !candidate.pinned);
  const insertAt = pinned
    ? (firstUnpinned < 0 ? next.length : firstUnpinned)
    : next.reduce((lastPinned, candidate, candidateIndex) => candidate.pinned ? candidateIndex + 1 : lastPinned, 0);
  next.splice(insertAt, 0, updated);
  return next;
}

function basename(p: string): string {
  return String(p || '').split(/[\\/]/).pop() || p;
}

function replacePathPrefix(value: string, oldPrefix: string, newPrefix: string): string {
  const suffix = value.slice(oldPrefix.length).replace(/^[\\/]+/, '');
  if (!suffix) return newPrefix;
  const separator = newPrefix.includes('\\') ? '\\' : '/';
  return `${newPrefix}${newPrefix.endsWith('\\') || newPrefix.endsWith('/') ? '' : separator}${suffix}`;
}

function loadNum(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

function loadString(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function loadRecentFiles(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem('mudex:recent-files:v1') || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 100) : [];
  } catch {
    return [];
  }
}

function loadClosedFilePaths(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem('mudex:closed-files:v1') || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-20) : [];
  } catch {
    return [];
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// A session keeps the default title it was created with, whatever language
// the UI shows now — so both languages' defaults count as "untitled".
function isDefaultThreadTitle(title: string): boolean {
  return title === STRINGS.ko.common.newThread || title === STRINGS.en.common.newThread;
}

function beginDrag(e: React.MouseEvent, onDx: (dx: number) => void) {
  e.preventDefault();
  const x0 = e.clientX;
  const mv = (ev: MouseEvent) => onDx(ev.clientX - x0);
  const up = () => {
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}

export default function App() {
  const initialRef = useRef<Session[] | null>(null);
  if (!initialRef.current) {
    const loaded = loadSessions();
    initialRef.current = loaded.length > 0 ? loaded : [newSession(undefined, sanitizeLang(loadString('mudex:lang')))];
  }
  const tabsRef = useRef<PaneTab[] | null>(null);
  if (!tabsRef.current) tabsRef.current = [{ id: uid('tab'), kind: 'files', title: STRINGS[sanitizeLang(loadString('mudex:lang'))].app.filesTab }];
  const [tabs, setTabs] = useState<PaneTab[]>(tabsRef.current);
  const [activeTabId, setActiveTabId] = useState<string>(tabsRef.current[0].id);
  const [tabsHydrated, setTabsHydrated] = useState(false);
  const [durableReady, setDurableReady] = useState(false);
  const [recentFiles, setRecentFiles] = useState<string[]>(loadRecentFiles);
  const [sessions, setSessions] = useState<Session[]>(initialRef.current);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [draftSessionIds, setDraftSessionIds] = useState<string[]>([]);
  const [queuedSessionCounts, setQueuedSessionCounts] = useState<Record<string, number>>({});
  const updateDraftSessionStatus = useCallback((sessionId: string, hasDraft: boolean) => {
    setDraftSessionIds((previous) => {
      if (hasDraft) return previous.includes(sessionId) ? previous : [...previous, sessionId];
      return previous.filter((id) => id !== sessionId);
    });
  }, []);
  const updateQueuedSessionCount = useCallback((sessionId: string, count: number) => {
    setQueuedSessionCounts((previous) => {
      if (count > 0 && previous[sessionId] === count) return previous;
      if (count <= 0 && previous[sessionId] === undefined) return previous;
      const next = { ...previous };
      if (count > 0) next[sessionId] = count;
      else delete next[sessionId];
      return next;
    });
  }, []);
  const [activeId, setActiveId] = useState<string>(() => {
    const savedId = loadString('mudex:active-session:v1');
    return initialRef.current?.some((session) => session.id === savedId) ? savedId : initialRef.current![0].id;
  });
  const sessionIdsSignature = sessions.map((session) => session.id).join('\0');
  useEffect(() => {
    const drafts: string[] = [];
    const queued: Record<string, number> = {};
    for (const session of sessions) {
      try {
        if (localStorage.getItem(`mudex:draft:${session.id}`)?.trim()) drafts.push(session.id);
      } catch { /* A single unavailable preference should not hide other sessions. */ }
      try {
        const count = normalizePromptQueue(JSON.parse(localStorage.getItem(`mudex:queue:${session.id}`) || '[]')).length;
        if (count > 0) queued[session.id] = count;
      } catch { /* Ignore one malformed stored queue and continue scanning. */ }
    }
    setDraftSessionIds(drafts);
    setQueuedSessionCounts(queued);
  }, [sessionIdsSignature]);
  const [settings, setSettings] = useState<CliSettings>(DEFAULT_SETTINGS);
  const [cliStatus, setCliStatus] = useState<CliStatus>('unknown');
  const [cliResolved, setCliResolved] = useState('');
  const [folder, setFolder] = useState(() => {
    const savedActiveId = loadString('mudex:active-session:v1');
    return initialRef.current?.find((session) => session.id === savedActiveId)?.cwd || loadFolder();
  });
  const [projects, setProjects] = useState<string[]>(() => {
    const list = loadProjects();
    const f = folder;
    return f && !list.includes(f) ? [f, ...list] : list;
  });
  useEffect(() => {
    saveProjects(projects);
  }, [projects]);
  const [pinnedProjects, setPinnedProjects] = useState<string[]>(() => readPinnedProjects());
  useEffect(() => writePinnedProjects(pinnedProjects), [pinnedProjects]);
  const [treeVersion, setTreeVersion] = useState(0);
  const [editorVisible, setEditorVisible] = useState(() => loadBool('mudex:editor-visible', true));
  const [savingAllFiles, setSavingAllFiles] = useState(false);
  const [view, setView] = useState<'thread' | 'usage' | 'settings'>('thread');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [goToLineRequest, setGoToLineRequest] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [wordWrap, setWordWrap] = useState(() => loadBool('mudex:editor-word-wrap:v1', false));
  const [editorFontSize, setEditorFontSize] = useState(() => clamp(Math.round(loadNum('mudex:editor-font-size:v1', 13)), 10, 24));
  const [fileSearchMode, setFileSearchMode] = useState<'name' | 'content'>('name');
  const [fileSearchFocusRequest, setFileSearchFocusRequest] = useState(0);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [editorNavigation, setEditorNavigation] = useState(() => readEditorNavigationHistory(folder));
  const [sessionSearchFocusRequest, setSessionSearchFocusRequest] = useState(0);
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const runningIdsRef = useRef(runningIds);
  runningIdsRef.current = runningIds;
  const [unreadIds, setUnreadIds] = useState<string[]>([]);
  const stopRegistryRef = useRef(createStopRegistry());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const [scheduled, setScheduled] = useState<ScheduledPrompt[]>(() => readScheduledPrompts());
  const scheduledRef = useRef(scheduled);
  scheduledRef.current = scheduled;
  const [scheduleDraft, setScheduleDraft] = useState<{ sessionId: string; text: string } | null>(null);
  const [scheduleListOpen, setScheduleListOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledPrompt | null>(null);
  const [scheduledFire, setScheduledFire] = useState<{ sessionId: string; text: string; nonce: number } | null>(null);
  const scheduledFiringRef = useRef<{ id: string; sessionId: string; nonce: number; since: number } | null>(null);
  const scheduledNonceRef = useRef(0);
  useEffect(() => writeScheduledPrompts(scheduled), [scheduled]);
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>(() => readBrowserBookmarks());
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  useEffect(() => writeBrowserBookmarks(bookmarks), [bookmarks]);
  const [groupBy, setGroupBy] = useState<'project' | 'status'>(() => {
    try {
      return (localStorage.getItem('mudex:groupby') as 'project' | 'status') || 'project';
    } catch {
      return 'project';
    }
  });
  const [dark, setDark] = useState(true);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState('');
  const notify = (message: string, kind?: string) => {
    setNotice(message);
    setNoticeKind(kind === 'git' ? 'git' : '');
  };
  const [confirmRequest, setConfirmRequest] = useState<ConfirmOptions | null>(null);
  const confirmResolverRef = useRef<((result: ConfirmResult) => void) | null>(null);
  const omittedDraftNoticeRef = useRef(false);
  const gateToastSeenRef = useRef<Set<string>>(new Set());
  const [hostSessions, setHostSessions] = useState<HostSession[]>([]);
  const [changed, setChanged] = useState<string[]>([]);
  const [changedKinds, setChangedKinds] = useState<Record<string, GitStatusKind>>({});
  const [changedStaged, setChangedStaged] = useState<Record<string, boolean>>({});
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [mspStatus, setMspStatus] = useState<MspStatus>({ state: 'idle' });
  const [codexSignal, setCodexSignal] = useState(0);
  const [claudeSignal, setClaudeSignal] = useState(0);
  const [tuneSignal, setTuneSignal] = useState(0);
  const [quota, setQuota] = useState<SubscriptionUsage | null>(() => loadLastUsage(localStorage));
  const [sideW, setSideW] = useState(() => clamp(loadNum('mudex:sidew', 284), 200, 480));
  const [chatRatio, setChatRatio] = useState(() => clamp(loadNum('mudex:chatratio', 0.45), 0.25, 0.75));
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const activeSessionTitle = sessions.find((session) => session.id === activeId)?.title.trim() || '';
  const workspaceTitle = folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  const hasUnsavedFiles = tabs.some((tab) => tab.kind === 'file' && !!tab.file?.dirty && !tab.file.readOnly);

  useEffect(() => {
    const labels = [
      activeSessionTitle && !isDefaultThreadTitle(activeSessionTitle) ? activeSessionTitle : '',
      workspaceTitle,
      'Musician',
    ].filter(Boolean);
    document.title = `${hasUnsavedFiles ? '● ' : ''}${labels.join(' — ')}`;
  }, [activeSessionTitle, workspaceTitle, hasUnsavedFiles]);

  const getChatRatioBounds = () => {
    const width = wrapRef.current?.clientWidth || 800;
    const min = clamp(340 / width, 0.25, 0.75);
    const max = clamp(1 - 320 / width, min, 0.75);
    return { min, max };
  };
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const keepPanesUsable = () => {
      const { min, max } = getChatRatioBounds();
      setChatRatio((ratio) => clamp(ratio, min, max));
    };
    keepPanesUsable();
    const observer = new ResizeObserver(keepPanesUsable);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('mudex:sidew', String(sideW));
      localStorage.setItem('mudex:chatratio', String(chatRatio));
    } catch {
      /* ignore */
    }
  }, [sideW, chatRatio]);
  const editorApiRef = useRef<EditorApi | null>(null);
  const editorNavigationRef = useRef(editorNavigation);
  editorNavigationRef.current = editorNavigation;
  const editorNavigationFolderRef = useRef(folder);
  const pendingEditorLocationRef = useRef<{ path: string; line: number; column: number } | null>(null);
  const pendingEditorLocationTimerRef = useRef<number | null>(null);
  const navigateEditorLocationRef = useRef<(direction: 1 | -1) => boolean>(() => false);
  const pendingLineRevealRef = useRef<{ path: string; line: number; column: number; attempts: number; wasActive: boolean } | null>(null);
  const pendingEditorInsertionRef = useRef<{ path: string; code: string; attempts: number; wasActive: boolean } | null>(null);
  const openFilesViewerRef = useRef<(() => void) | null>(null);
  const openWorkspaceSearchRef = useRef<(() => void) | null>(null);
  const latestTabsRef = useRef(tabs);
  const refreshOpenFileFromDiskRef = useRef<(path: string) => void>(() => {});
  const latestActiveTabRef = useRef(activeTabId);
  const recentPaneTabIdsRef = useRef<string[]>([]);
  const recentSessionIdsRef = useRef<string[]>([]);
  const closeTabRef = useRef<(id: string) => void>(() => {});
  const closeTabsRef = useRef<(ids: string[]) => void>(() => {});
  const saveAllFilesRef = useRef<() => void>(() => {});
  const savingAllFilesRef = useRef(false);
  const reopenClosedFileRef = useRef<() => void>(() => {});
  const switchRecentSessionRef = useRef<(direction: 1 | -1) => void>(() => {});
  const newChatRef = useRef<() => void>(() => {});
  const openTerminalRef = useRef<() => void>(() => {});
  useEffect(() => () => {
    if (pendingEditorLocationTimerRef.current !== null) window.clearTimeout(pendingEditorLocationTimerRef.current);
  }, []);
  useEffect(() => {
    if (editorNavigationFolderRef.current === folder) return;
    editorNavigationFolderRef.current = folder;
    if (pendingEditorLocationTimerRef.current !== null) window.clearTimeout(pendingEditorLocationTimerRef.current);
    pendingEditorLocationTimerRef.current = null;
    pendingEditorLocationRef.current = null;
    const restored = readEditorNavigationHistory(folder);
    editorNavigationRef.current = restored;
    setEditorNavigation(restored);
  }, [folder]);
  const closedFilePathsRef = useRef<string[]>([]);
  const closedFilePathsLoadedRef = useRef(false);
  if (!closedFilePathsLoadedRef.current) {
    closedFilePathsRef.current = loadClosedFilePaths();
    closedFilePathsLoadedRef.current = true;
  }
  const closedPaneTabsRef = useRef<ClosedPaneTab[]>([]);
  const closedPaneTabsLoadedRef = useRef(false);
  if (!closedPaneTabsLoadedRef.current) {
    closedPaneTabsRef.current = loadClosedPaneTabs();
    closedPaneTabsLoadedRef.current = true;
  }
  const reopeningClosedFileRef = useRef(false);
  const openingFilesRef = useRef(createSingleFlight());
  latestTabsRef.current = tabs;
  latestActiveTabRef.current = activeTabId;

  useEffect(() => {
    recentPaneTabIdsRef.current = touchRecentTab(recentPaneTabIdsRef.current, activeTabId, tabs.map((tab) => tab.id));
  }, [activeTabId, tabs]);

  useEffect(() => {
    const available = sessions.filter((session) => !session.archived);
    const availableIds = new Set(available.map((session) => session.id));
    const fallbackHistory = [...available]
      .sort((a, b) => (b.messages[b.messages.length - 1]?.ts || b.createdAt) - (a.messages[a.messages.length - 1]?.ts || a.createdAt))
      .map((session) => session.id);
    recentSessionIdsRef.current = touchRecentTab(
      recentSessionIdsRef.current.length ? recentSessionIdsRef.current : fallbackHistory,
      activeId,
      availableIds,
    );
  }, [activeId, sessions]);

  const switchPaneTab = (direction: 1 | -1) => {
    const currentTabs = latestTabsRef.current;
    if (currentTabs.length < 2) return false;
    const currentIndex = currentTabs.findIndex((tab) => tab.id === latestActiveTabRef.current);
    const nextIndex = currentIndex < 0
      ? (direction > 0 ? 0 : currentTabs.length - 1)
      : (currentIndex + direction + currentTabs.length) % currentTabs.length;
    const nextId = currentTabs[nextIndex].id;
    latestActiveTabRef.current = nextId;
    setActiveTabId(nextId);
    setEditorVisible(true);
    return true;
  };

  const switchRecentPaneTab = (direction: 1 | -1) => {
    const currentTabs = latestTabsRef.current;
    if (currentTabs.length < 2) return false;
    const currentId = latestActiveTabRef.current;
    const openIds = new Set(currentTabs.map((tab) => tab.id));
    const nextId = nextRecentTab(recentPaneTabIdsRef.current, currentId, openIds, direction);
    if (!nextId) return switchPaneTab(direction);
    latestActiveTabRef.current = nextId;
    recentPaneTabIdsRef.current = touchRecentTab(recentPaneTabIdsRef.current, nextId, openIds);
    setActiveTabId(nextId);
    setEditorVisible(true);
    return true;
  };

  const movePaneTab = (direction: 1 | -1) => {
    const currentTabs = latestTabsRef.current;
    const currentIndex = currentTabs.findIndex((tab) => tab.id === latestActiveTabRef.current);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentTabs.length) return false;
    const nextTabs = [...currentTabs];
    [nextTabs[currentIndex], nextTabs[nextIndex]] = [nextTabs[nextIndex], nextTabs[currentIndex]];
    latestTabsRef.current = nextTabs;
    setTabs(nextTabs);
    return true;
  };

  const updateClosedFilePaths = (paths: string[]) => {
    const next = paths.slice(-20);
    closedFilePathsRef.current = next;
    try { localStorage.setItem('mudex:closed-files:v1', JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  };

  const updateClosedPaneTabs = (closedTabs: ClosedPaneTab[]) => {
    const next = closedTabs.slice(-20);
    closedPaneTabsRef.current = next;
    try { localStorage.setItem('mudex:closed-tabs:v1', JSON.stringify(next)); } catch { /* convenience history */ }
  };

  const requestConfirm = (options: ConfirmOptions) => new Promise<ConfirmResult>((resolve) => {
    if (confirmResolverRef.current) { resolve('cancel'); return; }
    confirmResolverRef.current = resolve;
    setConfirmRequest(options);
  });
  const resolveConfirm = (result: ConfirmResult) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmRequest(null);
    resolve?.(result);
  };

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0] ?? null;
  const openFilePaths = tabs.filter((tab) => tab.kind === 'file' && tab.file && !tab.file.readOnly).map((tab) => tab.file!.path);
  const openFileWatchKey = openFilePaths.map(normalizePathForComparison).sort().join('\0');
  const openFileWatchDirectories = useMemo(() => {
    const directories = new Map<string, string>();
    for (const filePath of openFilePaths) {
      const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
      const directory = separator === 2 && filePath[1] === ':' ? filePath.slice(0, 3) : separator > 0 ? filePath.slice(0, separator) : folder;
      if (folder && isSameOrDescendantPath(folder, directory)) directories.set(normalizePathForComparison(directory), directory);
    }
    return [...directories.values()];
    // A content edit changes the tab object but not its watcher directory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, openFileWatchKey]);

  // Local token aggregates (MSP-reported usage only) for the chat strip.
  const tokenWin = useMemo(() => {
    const now = Date.now();
    const h5 = { input: 0, output: 0 };
    const wk = { input: 0, output: 0 };
    for (const s of sessions) {
      for (const m of s.messages) {
        if (!m.usage) continue;
        const age = now - m.ts;
        if (age < 0) continue;
        if (age <= 7 * 86400000) {
          wk.input += m.usage.inputTokens || 0;
          wk.output += m.usage.outputTokens || 0;
        }
        if (age <= 5 * 3600000) {
          h5.input += m.usage.inputTokens || 0;
          h5.output += m.usage.outputTokens || 0;
        }
      }
    }
    return { h5, wk };
  }, [sessions]);

  const refreshMsp = useCallback((cwd: string) => {
    if (!hasBridge()) return;
    setMspStatus({ state: 'warming' });
    api()
      .mspWarmup(cwd || '')
      .then((r) => {
        if (r.ok) {
          setHostSessions(visibleHostSessions(r.sessions || [], readHiddenHostSessionIds()));
          if (r.usage) {
            setQuota(r.usage);
            saveLastUsage(localStorage, r.usage);
          }
          setMspStatus({ state: 'ok' });
        } else {
          setMspStatus({ state: 'error', error: r.error });
        }
      })
      .catch((e) => setMspStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) }));
  }, []);

  // MSP host sessions: follow push events (initial load comes from warmup).
  useEffect(() => {
    if (!hasBridge()) return;
    const off = api().onMspSessionsChanged(() => {
      api()
        .mspSessions(folder || '')
        .then((r) => {
          if (r.ok) setHostSessions(visibleHostSessions(r.sessions || [], readHiddenHostSessionIds()));
        })
        .catch(() => {});
    });
    return () => {
      off();
    };
  }, [folder]);

  // Right-pane changed files: refresh on folder change + every finished chat.
  const refreshChanged = useCallback(async () => {
    if (!hasBridge() || !folder) {
      setChanged([]);
      setChangedKinds({});
      setChangedStaged({});
      return;
    }
    try {
      const r = await api().gitStatus(folder);
      const entries = r.ok && r.files ? r.files.slice(0, 50) : [];
      const parsed = entries.map((entry) => ({ path: porcelainPath(entry), kind: porcelainStatus(entry), staged: porcelainStaged(entry) })).filter((entry) => !!entry.path);
      setChanged(parsed.map((entry) => entry.path));
      setChangedKinds(Object.fromEntries(parsed.map((entry) => [entry.path.replace(/\\/g, '/').toLowerCase(), entry.kind])));
      setChangedStaged(Object.fromEntries(parsed.filter((entry) => entry.staged).map((entry) => [entry.path.replace(/\\/g, '/').toLowerCase(), true])));
    } catch {
      /* keep the previous list */
    }
  }, [folder]);

  useEffect(() => {
    if (!hasBridge()) return;
    refreshChanged();
    const off = api().onChatDone(() => {
      refreshChanged();
    });
    return () => {
      off();
    };
  }, [refreshChanged]);

  // Keep the explorer and Git changes in sync with edits made outside Musician.
  useEffect(() => {
    if (!hasBridge() || !folder) return;
    let timer: number | undefined;
    const changedPaths = new Set<string>();
    const off = api().onWorkspaceChanged((event) => {
      if (event?.path) changedPaths.add(event.path);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        setTreeVersion((version) => version + 1);
        void refreshChanged();
        for (const changedPath of changedPaths) refreshOpenFileFromDiskRef.current(changedPath);
        changedPaths.clear();
      }, 250);
    });
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      off();
    };
  }, [folder, refreshChanged]);

  useEffect(() => {
    if (!hasBridge() || !folder) return;
    let disposed = false;
    const registered: string[] = [];
    for (const directory of openFileWatchDirectories) {
      void api().watchDirectory(folder, directory).then((result) => {
        if (!result.ok) return;
        if (disposed) void api().unwatchDirectory(folder, directory);
        else registered.push(directory);
      }).catch(() => {});
    }
    return () => {
      disposed = true;
      for (const directory of registered) void api().unwatchDirectory(folder, directory);
    };
  }, [folder, openFileWatchDirectories]);

  // Quota follows push events (initial load comes from warmup).
  useEffect(() => {
    if (!hasBridge()) return;
    const off = api().onMspUsage((p) => {
      if (p.usage) saveLastUsage(localStorage, p.usage);
      setQuota((prev) => p.usage ?? prev);
    });
    return () => {
      off();
    };
  }, []);

  // Serve re-announces a gated effort downgrade every turn; toast once
  // per host+gate so the user learns ultra fell back to xhigh.
  useEffect(() => {
    if (!hasBridge()) return;
    const off = api().onMspGateFallback((p) => {
      const id = `${p.key}::${p.gate}`;
      if (gateToastSeenRef.current.has(id)) return;
      gateToastSeenRef.current.add(id);
      notify(formatStr(STRINGS[langRef.current].app.gateFallback, { requested: p.requested, fallback: p.fallback }));
    });
    return () => {
      off();
    };
  }, []);

  // The agent can retarget the visible browser view: follow it so the pane
  // header and controls match the page on screen.
  useEffect(() => {
    if (!hasBridge()) return;
    const off = api().onBrowserEvent((ev) => {
      if (ev.type !== 'agent-switch') return;
      const target = latestTabsRef.current.find((tab) => tab.id === ev.tabId && tab.kind === 'browser');
      if (!target || latestActiveTabRef.current === target.id) return;
      latestActiveTabRef.current = target.id;
      recentPaneTabIdsRef.current = touchRecentTab(recentPaneTabIdsRef.current, target.id, latestTabsRef.current.map((tab) => tab.id));
      setActiveTabId(target.id);
      setEditorVisible(true);
      setNotice(STRINGS[langRef.current].app.agentSwitchedTab);
    });
    return () => {
      off();
    };
  }, []);

  // MSP: connect on launch + folder change (exec-only mode skips it).
  useEffect(() => {
    if (!hasBridge()) return;
    if (settings.engine === 'exec') {
      setMspStatus({ state: 'idle' });
    } else {
      refreshMsp(folder);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, settings.engine]);

  // Boot: settings + folder + CLI probe + MSP prewarm.
  useEffect(() => {
    const bootFolder = sessions.find((session) => session.id === activeId)?.cwd || loadFolder();
    setFolder(bootFolder);
    setProjects((prev) => addProject(prev, bootFolder));
    if (!hasBridge()) return;
    // Warm `muse serve` for the last folder so the first chat is fast.
    // Main also prewarms the default host at launch; this covers a saved
    // folder that differs from it. Fire-and-forget: failures surface via
    // onMspPrewarmError and lazy ensureHost retries on first use.
    api()
      .mspPrewarm(bootFolder)
      .catch(() => {});
    api()
      .getSettings()
      .then((r) => {
        if (r.ok) setSettings({ ...r.settings });
      })
      .catch(() => {});
    // File backup wins when non-empty (survives quota + crash-before-flush),
    // unless the user already added/deleted/edited sessions while the async
    // load was in flight — overwriting then would wipe the change
    // (added session vanishes, deleted one resurrects).
    const bootSessions = sessionsRef.current;
    let bootCancelled = false;
    api()
      .sessionsLoad()
      .then((r) => {
        if (bootCancelled || !r.ok) return;
        const applied = resolveBootSessions(sessionsRef.current, bootSessions, r.sessions);
        if (applied === sessionsRef.current) return;
        setSessions(applied);
        setActiveId((prev) => (applied.some((s) => s.id === prev) ? prev : applied[0].id));
      })
      .catch(() => {});
    setCliStatus('checking');
    api()
      .cliTest()
      .then((r) => {
        setCliStatus(r.ok ? 'ok' : r.error === 'CLI_NOT_FOUND' ? 'missing' : 'error');
        setCliResolved(r.resolvedPath || '');
      })
      .catch(() => setCliStatus('error'));
    return () => { bootCancelled = true; };
  }, []);

  useEffect(() => {
    saveSessions(sessions);
    if (hasBridge()) api().sessionsSave(sessions).catch(() => {});
  }, [sessions]);

  // Shared delivery path for tick fires and manual fire-now: nonce,
  // in-flight guard, background toast, session activation, notice.
  const fireScheduledItem = (item: ScheduledPrompt) => {
    scheduledNonceRef.current += 1;
    scheduledFiringRef.current = { id: item.id, sessionId: item.sessionId, nonce: scheduledNonceRef.current, since: Date.now() };
    setScheduledFire({ sessionId: item.sessionId, text: item.text, nonce: scheduledNonceRef.current });
    const wasActive = activeIdRef.current === item.sessionId;
    const title = sessionsRef.current.find((session) => session.id === item.sessionId)?.title || av.threadFallback;
    if (hasBridge() && shouldShowBackgroundNotification({
      enabled: settingsRef.current.backgroundNotifications,
      isActiveSession: wasActive,
      windowFocused: document.hasFocus(),
      willContinueAutomatically: false,
    })) {
      void api().showNotification(title, item.sessionId, 'scheduled').catch(() => {});
    }
    setActiveId(item.sessionId);
    setView('thread');
    setNotice(formatStr(av.schedFired, { title }));
  };

  const fireScheduledNow = (id: string) => {
    if (scheduledFiringRef.current) {
      setNotice(av.schedBusy);
      return;
    }
    const item = fireableScheduledPrompt(scheduledRef.current, id, sessionsRef.current, null);
    if (!item) {
      setNotice(av.schedCannotRun);
      return;
    }
    fireScheduledItem(item);
    setScheduleListOpen(false);
  };

  // Scheduled prompts: every 20s, drop reservations of deleted sessions,
  // retire stale ones, and fire the oldest due item whose session exists and
  // is idle. Delivery activates the session so its ChatView runs the prompt
  // in its own thread; the item is marked fired when the ChatView consumes
  // the delivery, missed when delivery fails with the session idle.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const current = scheduledRef.current;
      let next = current;
      const knownIds = new Set(sessionsRef.current.map((session) => session.id));
      if (next.some((item) => !knownIds.has(item.sessionId))) {
        next = next.filter((item) => knownIds.has(item.sessionId));
      }
      // Only one-shot items retire as missed; repeating ones fire as catch-up.
      for (const item of staleScheduledPrompts(next, now)) {
        if (item.repeat === 'once') next = markScheduledPrompt(next, item.id, 'missed');
      }
      const firing = scheduledFiringRef.current;
      if (firing) {
        // The ChatView reports consumption (marked fired there). Busy
        // sessions keep waiting — the prompt runs when the current work
        // ends; only idle-but-unstarted deliveries expire.
        if (!runningIdsRef.current.includes(firing.sessionId) && now - firing.since > 180000) {
          next = markScheduledPrompt(next, firing.id, 'missed');
          scheduledFiringRef.current = null;
          setScheduledFire(null);
        }
      } else {
        const liveIds = new Set(sessionsRef.current.filter((session) => !session.archived).map((session) => session.id));
        const target = dueScheduledPrompts(next, now).find(
          (item) => liveIds.has(item.sessionId) && !runningIdsRef.current.includes(item.sessionId),
        );
        if (target) fireScheduledItem(target);
      }
      if (next !== current) setScheduled(next);
    };
    tick();
    const timer = window.setInterval(tick, 20000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('mudex:active-session:v1', activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  // Durable seed: the file copy in userData outlives crashes and restarts,
  // while sessionStorage dies with the window and localStorage can lag on a
  // forced kill. Seed missing keys first, then let restore read them.
  useEffect(() => {
    let cancelled = false;
    setDurableReady(false);
    const run = async () => {
      if (hasBridge()) {
        const apiObj = api();
        const durableApi = {
          get: (key: string) => apiObj.rendererStateGet(key),
          set: (key: string, value: string | null) => apiObj.rendererStateSet(key, value),
        };
        const seeds = [
          { key: editorDraftStorageKey(folder || ''), storage: sessionStorage },
          { key: editorNavigationStorageKey(folder || ''), storage: localStorage },
        ];
        if (folder) seeds.push({ key: editorDraftStorageKey(''), storage: sessionStorage });
        await seedDurableKeys(durableApi, seeds);
      }
      if (cancelled) return;
      const nav = readEditorNavigationHistory(folder);
      editorNavigationRef.current = nav;
      setEditorNavigation(nav);
      setDurableReady(true);
    };
    void run().catch(() => {
      if (!cancelled) setDurableReady(true);
    });
    return () => { cancelled = true; };
  }, [folder]);

  // Restore pane tabs from metadata only. File buffers always come from disk,
  // so opening the app again cannot silently resurrect stale editor contents.
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      if (!durableReady) return;
      const saved = readWorkspacePaneLayout(folder);
      if (!saved || !Array.isArray(saved.tabs)) {
        if (!cancelled) {
          const emptyTab: PaneTab = { id: uid('tab'), kind: 'files', title: av.filesTab };
          const persistentTabs = latestTabsRef.current.filter((tab) => tab.kind === 'terminal' || tab.kind === 'browser');
          setTabs([...persistentTabs, emptyTab]);
          setActiveTabId(emptyTab.id);
          setTabsHydrated(true);
        }
        return;
      }

      const editorDrafts = readEditorDrafts(undefined, folder);
      const recoveredDraftNames: string[] = [];
      const changedOnDiskDraftNames: string[] = [];
      const unavailableFileNames: string[] = [];
      let unavailableDraftCount = 0;
      const storedTabs = saved.tabs.slice(-40);
      const restored = await Promise.all(storedTabs.map(async (item): Promise<PaneTab | null> => {
        if (!item || typeof item !== 'object') return null;
        const tab = item as Partial<PaneTab>;
        if (typeof tab.id !== 'string' || !tab.id || typeof tab.title !== 'string') return null;
        if (tab.kind === 'file') {
          const filePath = tab.file?.path;
          if (typeof filePath !== 'string' || !filePath) return null;
          const draft = findEditorDraft(editorDrafts, filePath);
          if (!hasBridge()) {
            unavailableFileNames.push(basename(filePath));
            if (draft) unavailableDraftCount++;
            return {
              id: tab.id,
              kind: 'file',
              title: tab.title,
              pinned: tab.pinned === true,
              file: createUnavailableRestoredFile(filePath, draft),
            };
          }
          try {
            const result = await api().readFile(filePath);
            if (!result.ok) {
              unavailableFileNames.push(basename(filePath));
              if (draft) unavailableDraftCount++;
              return {
                id: tab.id,
                kind: 'file',
                title: tab.title,
                pinned: tab.pinned === true,
                file: createUnavailableRestoredFile(filePath, draft),
              };
            }
            const content = result.content || '';
            if (draft) {
              const restoredDraft = restoreEditorDraft(content, draft);
              if (restoredDraft.dirty) recoveredDraftNames.push(basename(filePath));
              if (restoredDraft.diskChanged) changedOnDiskDraftNames.push(basename(filePath));
              return {
                id: tab.id,
                kind: 'file',
                title: tab.title,
                pinned: tab.pinned === true,
                file: { path: filePath, name: basename(filePath), ...restoredDraft, showDiff: false },
              };
            }
            return {
              id: tab.id,
              kind: 'file',
              title: tab.title,
              pinned: tab.pinned === true,
              file: { path: filePath, name: basename(filePath), original: content, content, dirty: false, showDiff: false },
            };
          } catch {
            unavailableFileNames.push(basename(filePath));
            if (draft) unavailableDraftCount++;
            return {
              id: tab.id,
              kind: 'file',
              title: tab.title,
              pinned: tab.pinned === true,
              file: createUnavailableRestoredFile(filePath, draft),
            };
          }
        }
        if (tab.kind === 'files') return { id: tab.id, kind: 'files', title: tab.title };
        if (tab.kind === 'browser') {
          return { id: tab.id, kind: 'browser', title: tab.title, url: typeof tab.url === 'string' ? tab.url : undefined };
        }
        if (tab.kind === 'terminal') {
          return {
            id: tab.id,
            kind: 'terminal',
            title: tab.title,
            shell: tab.shell === 'cmd' ? 'cmd' : 'powershell',
            cwd: typeof tab.cwd === 'string' ? tab.cwd : folder || undefined,
          };
        }
        return null;
      }));
      if (cancelled) return;
      let nextTabs = restored.filter((tab): tab is PaneTab => !!tab);
      const livePersistentTabs = latestTabsRef.current.filter((tab) => tab.kind === 'terminal' || tab.kind === 'browser');
      nextTabs = mergeLiveWorkspaceTabs(nextTabs, livePersistentTabs);
      nextTabs = nextTabs.map((tab, index) => ({ tab, index }))
        .sort((a, b) => Number(!!b.tab.pinned) - Number(!!a.tab.pinned) || a.index - b.index)
        .map(({ tab }) => tab);
      // An empty tabset bricks the pane (no strip, no recovery target),
      // and stored layouts can legitimately be empty once closed tabs are
      // purged everywhere — always fall back to the Files tab.
      nextTabs = ensureFilesTabFallback(nextTabs, () => ({ id: uid('tab'), kind: 'files', title: av.filesTab }));
      setTabs(nextTabs);
      const selectedId = typeof saved.activeTabId === 'string' ? saved.activeTabId : '';
      setActiveTabId(nextTabs.some((tab) => tab.id === selectedId) ? selectedId : (nextTabs[0]?.id || ''));
      if (unavailableFileNames.length > 0) {
        setNotice(formatStr(av.restoreUnavailable, {
          n: unavailableFileNames.length,
          draft: unavailableDraftCount ? formatStr(av.restoreUnavailableDraft, { n: unavailableDraftCount }) : '',
          names: unavailableFileNames.slice(0, 3).join(', '),
        }));
      } else if (changedOnDiskDraftNames.length > 0) {
        setNotice(formatStr(av.restoreDiskChanged, { names: changedOnDiskDraftNames.slice(0, 3).join(', ') }));
      } else if (recoveredDraftNames.length > 0) {
        setNotice(formatStr(av.restoreDrafts, { n: recoveredDraftNames.length }));
      }
      setTabsHydrated(true);
    };
    void restore().catch(() => {
      if (!cancelled) setTabsHydrated(true);
    });
    return () => { cancelled = true; };
  }, [folder, durableReady]);

  // Keep a small backup of dirty editor buffers so a crash, restart, or reload
  // can restore them: sessionStorage for the sync read path, mirrored to the
  // durable file copy. Disk baselines are kept for conflict checks.
  useEffect(() => {
    if (!tabsHydrated || !durableReady) return;
    const timer = window.setTimeout(() => {
      const result = writeEditorDrafts(tabs, activeTabId, undefined, folder);
      if (hasBridge()) {
        const apiObj = api();
        mirrorStoredKey(
          { set: (key: string, value: string | null) => apiObj.rendererStateSet(key, value) },
          sessionStorage,
          editorDraftStorageKey(folder || ''),
        );
      }
      if (result.omittedCount > 0 && !omittedDraftNoticeRef.current) {
        omittedDraftNoticeRef.current = true;
        setNotice(av.draftBackupLimited);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [tabs, activeTabId, tabsHydrated, folder, durableReady]);

  // Mirror navigation history and bookmarks to the durable file copy.
  useEffect(() => {
    if (!durableReady || !hasBridge()) return;
    const apiObj = api();
    mirrorStoredKey(
      { set: (key: string, value: string | null) => apiObj.rendererStateSet(key, value) },
      localStorage,
      editorNavigationStorageKey(folder || ''),
    );
  }, [editorNavigation, folder, durableReady]);

  useEffect(() => {
    try {
      localStorage.setItem('mudex:editor-visible', String(editorVisible));
    } catch {
      /* ignore */
    }
  }, [editorVisible]);

  useEffect(() => {
    try {
      localStorage.setItem('mudex:recent-files:v1', JSON.stringify(recentFiles));
    } catch {
      /* ignore */
    }
  }, [recentFiles]);

  useEffect(() => {
    if (!tabsHydrated) return;
    writeWorkspacePaneLayout(folder, tabs, activeTabId);
  }, [tabs, activeTabId, tabsHydrated, folder]);

  // Warn before closing with unsaved editor buffers.
  useEffect(() => {
    if (!tabs.some((t) => t.kind === 'file' && t.file && t.file.dirty && !t.file.readOnly)) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [tabs]);

  // Theme: settings.theme drives the mode; dark is the default.
  useEffect(() => {
    setDark(settings.theme !== 'light');
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const lang = sanitizeLang(settings.lang);
  // App sits above LangContext.Provider, so it reads STRINGS directly.
  const av = STRINGS[lang].app;
  const common = STRINGS[lang].common;
  // Mount-once effects below read the live language through this ref.
  const langRef = useRef(lang);
  langRef.current = lang;
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('mudex:lang', lang);
    } catch {
      /* the crash screen falls back to Korean */
    }
  }, [lang]);

  useEffect(() => {
    try {
      localStorage.setItem('mudex:groupby', groupBy);
    } catch {
      /* ignore */
    }
  }, [groupBy]);

  useEffect(() => {
    try { localStorage.setItem('mudex:editor-word-wrap:v1', String(wordWrap)); } catch { /* preference only */ }
  }, [wordWrap]);
  useEffect(() => {
    try { localStorage.setItem('mudex:editor-font-size:v1', String(editorFontSize)); } catch { /* preference only */ }
  }, [editorFontSize]);

  // Keyboard shortcuts: sidebar, command palette, quick open, explorer, and tabs.
  useEffect(() => {
    const adjustEditorFont = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('.shortcuts-dialog') || !(e.ctrlKey || e.metaKey)) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target?.closest('.monaco-editor')) return;
      const key = e.key.toLowerCase();
      if (key === '+' || key === '=' || e.code === 'NumpadAdd') {
        e.preventDefault();
        e.stopPropagation();
        setEditorFontSize((size) => clamp(size + 1, 10, 24));
      } else if (key === '-' || key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        e.stopPropagation();
        setEditorFontSize((size) => clamp(size - 1, 10, 24));
      } else if (key === '0') {
        e.preventDefault();
        e.stopPropagation();
        setEditorFontSize(13);
      }
    };
    const toggleWrap = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('.shortcuts-dialog') || !e.altKey || e.ctrlKey || e.metaKey || e.key.toLowerCase() !== 'z') return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .xterm-helper-textarea')
        && !target.closest('.monaco-editor')) return;
      e.preventDefault();
      e.stopPropagation();
      setWordWrap((enabled) => !enabled);
    };
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target?.closest('.monaco-editor') && navigateEditorLocationRef.current(e.key === 'ArrowLeft' ? -1 : 1)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key === 'F1' && !(e.target instanceof HTMLElement && e.target.closest('.monaco-editor'))) {
        e.preventDefault();
        setQuickOpen(false);
        setPaletteOpen((v) => !v);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (!e.shiftKey && e.code === 'Comma') {
        e.preventDefault();
        setQuickOpen(false);
        setPaletteOpen(false);
        setView('settings');
      } else if (e.shiftKey && e.code === 'Slash') {
        e.preventDefault();
        setPaletteOpen(false);
        setQuickOpen(false);
        setShortcutsOpen(true);
      } else if (e.shiftKey && e.code === 'Backquote') {
        e.preventDefault();
        openTerminalRef.current();
      } else if (!e.shiftKey && !e.altKey && k === 'n') {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target?.closest('.monaco-editor') || document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        setQuickOpen(false);
        setPaletteOpen(false);
        newChatRef.current();
        setView('thread');
      } else if (e.altKey && !e.shiftKey && k === 's') {
        e.preventDefault();
        setView('thread');
        setSidebarVisible(true);
        setSessionSearchFocusRequest((request) => request + 1);
      } else if (e.altKey && !e.shiftKey && k === 'r') {
        e.preventDefault();
        setPaletteOpen(false);
        setQuickOpen(false);
        setScheduleListOpen(true);
      } else if (e.altKey && k === 'e') {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target?.closest('input, textarea, select, [contenteditable="true"], .monaco-editor, .xterm-helper-textarea')) return;
        e.preventDefault();
        setView('thread');
        setEditorVisible((visible) => !visible);
      } else if (k === 'b') {
        e.preventDefault();
        setSidebarVisible((v) => !v);
      } else if (k === 'k') {
        const t = e.target as HTMLElement | null;
        if (t && t.closest && t.closest('.monaco-editor')) return;
        e.preventDefault();
        setQuickOpen(false);
        setPaletteOpen((v) => !v);
      } else if (k === 'p') {
        e.preventDefault();
        if (e.shiftKey) {
          setQuickOpen(false);
          setPaletteOpen((v) => !v);
        } else {
          setPaletteOpen(false);
          setQuickOpen(true);
        }
      } else if (k === 'g' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setGoToLineRequest((request) => request + 1);
      } else if (k === 'o' && e.shiftKey && !e.altKey && editorApiRef.current?.openSymbolPicker) {
        e.preventDefault();
        editorApiRef.current.openSymbolPicker();
      } else if (k === 't' && e.shiftKey) {
        e.preventDefault();
        reopenClosedFileRef.current();
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault();
        openWorkspaceSearchRef.current?.();
      } else if (k === 'e' && e.shiftKey) {
        e.preventDefault();
        openFilesViewerRef.current?.();
      } else if ((k === 'arrowleft' || k === 'arrowright') && e.shiftKey) {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target?.closest('input, textarea, select, [contenteditable="true"], .monaco-editor, .xterm-helper-textarea')) return;
        if (latestTabsRef.current.length < 2) return;
        e.preventDefault();
        movePaneTab(k === 'arrowright' ? 1 : -1);
      } else if (k === 'tab') {
        const currentTabs = latestTabsRef.current;
        if (currentTabs.length < 2) return;
        e.preventDefault();
        const direction = e.shiftKey ? -1 : 1;
        switchRecentPaneTab(direction);
      } else if (!e.shiftKey && /^[1-9]$/.test(k)) {
        const currentTabs = latestTabsRef.current;
        const index = k === '9' ? currentTabs.length - 1 : Number(k) - 1;
        const targetTab = currentTabs[index];
        e.preventDefault();
        if (!targetTab || targetTab.id === latestActiveTabRef.current) return;
        latestActiveTabRef.current = targetTab.id;
        setActiveTabId(targetTab.id);
        setEditorVisible(true);
      } else if ((k === 'pageup' || k === 'pagedown') && e.altKey && !e.shiftKey) {
        e.preventDefault();
        switchRecentSessionRef.current(k === 'pagedown' ? 1 : -1);
      } else if (k === 'pageup' || k === 'pagedown') {
        if (latestTabsRef.current.length < 2) return;
        e.preventDefault();
        const direction = k === 'pagedown' ? 1 : -1;
        if (e.shiftKey) movePaneTab(direction);
        else switchPaneTab(direction);
      } else if (k === 'w') {
        if (e.shiftKey) {
          const currentTabs = latestTabsRef.current;
          if (!currentTabs.length) return;
          e.preventDefault();
          closeTabsRef.current(currentTabs.map((tab) => tab.id));
          return;
        }
        const currentTabId = latestActiveTabRef.current;
        if (!currentTabId) return;
        e.preventDefault();
        closeTabRef.current(currentTabId);
      } else if (k === 's' && e.shiftKey) {
        e.preventDefault();
        saveAllFilesRef.current();
      }
    };
    window.addEventListener('keydown', adjustEditorFont, true);
    window.addEventListener('keydown', toggleWrap, true);
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', adjustEditorFont, true);
      window.removeEventListener('keydown', toggleWrap, true);
      window.removeEventListener('keydown', h);
    };
  }, []);

  // ------------------------------------------------------------ sessions
  const appendUser = (sessionId: string, msg: ChatMessage) =>
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, cwd: s.cwd || folder || undefined, messages: [...s.messages, msg] } : s,
      ),
    );
  const appendAssistant = (sessionId: string, msg: ChatMessage) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messages: [...s.messages, msg] } : s)),
    );
    // A background session finished a turn — flag it until the user opens it.
    if (sessionId !== activeIdRef.current) setUnreadIds((prev) => markUnread(prev, sessionId));
  };
  useEffect(() => {
    setUnreadIds((prev) => clearUnread(prev, activeId));
  }, [activeId]);
  const stopSession = (sessionId: string) => {
    stopRegistryRef.current.request(sessionId);
  };

  const titleMaybe = (sessionId: string, firstPrompt: string) =>
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId && isDefaultThreadTitle(s.title) && s.messages.length <= 1
          ? { ...s, title: sessionTitle(firstPrompt, lang) }
          : s,
      ),
    );

  const patchMessage = (sessionId: string, msgId: string, patch: Partial<ChatMessage>) =>
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, messages: s.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) } : s,
      ),
    );

  const linkMsp = (sessionId: string, mspSessionId: string, engine: 'msp' | 'exec') =>
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, mspSessionId: mspSessionId || undefined, engine } : s)),
    );

  const resumeHostSession = async (hostSessionId: string) => {
    if (!hasBridge() || resumingId) return;
    const linked = sessions.find((session) => session.mspSessionId === hostSessionId);
    if (linked && runningIds.includes(linked.id)) {
      setActiveId(linked.id);
      return;
    }
    const activeSession = sessions.find((session) => session.id === activeId);
    const reusable = linked || (activeSession && activeSession.messages.length === 0 && !runningIds.includes(activeSession.id) ? activeSession : null);
    const created = reusable ? null : newSession(folder || undefined, lang);
    const threadId = reusable?.id || created!.id;
    setResumingId(hostSessionId);
    try {
      const result = await api().mspResume(threadId, hostSessionId, folder || '');
      if (!result.ok) throw new Error(result.error || common.unknownError);
      const now = Date.now();
      const messages: ChatMessage[] = (result.messages || []).map((message, index) => ({
        id: `rm-${now}-${index}`,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        text: message.text,
        ts: now,
        done: true,
      }));
      setSessions((previous) => {
        const nextSession = {
          ...(reusable || created!),
          cwd: reusable?.cwd || folder || undefined,
          engine: 'msp' as const,
          mspSessionId: result.mspSessionId || hostSessionId,
          messages,
        };
        return reusable
          ? previous.map((session) => session.id === threadId ? nextSession : session)
          : [nextSession, ...previous];
      });
      setActiveId(threadId);
      const mcpNotice = mcpChatNotice(result.mcpHealth, lang);
      if (mcpNotice) setNotice(mcpNotice);
    } catch (error) {
      setNotice(formatStr(av.resumeFailed, { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setResumingId(null);
    }
  };

  const deleteHostSession = async (hostSessionId: string) => {
    if (resumingId) return;
    const target = hostSessions.find((h) => h.sessionId === hostSessionId);
    if (!target) return;
    const label = target.title || target.name || hostSessionId.slice(0, 8);
    if (await requestConfirm({ title: av.delHostTitle, message: formatStr(av.delHostMsg, { label }), confirmLabel: common.delete, destructive: true }) !== 'confirm') return;
    const hidden = hideHostSessionId(hostSessionId);
    setHostSessions((previous) => visibleHostSessions(previous, hidden));
  };

  const newChat = () => {
    const s = newSession(undefined, lang);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  };

  const forkSessionFrom = (sessionId: string, messageId: string) => {
    const source = sessions.find((session) => session.id === sessionId);
    if (!source) return;
    const forked = forkSession(source, messageId, {
      createId: () => uid('s'),
      now: Date.now(),
      title: `${source.title} (${av.forkSuffix})`,
    });
    if (!forked) return;
    setSessions((prev) => [forked, ...prev]);
    setActiveId(forked.id);
    setView('thread');
    setNotice(formatStr(av.forkedOk, { title: source.title }));
  };
  newChatRef.current = newChat;

  const clearSessionLocalState = (id: string) => {
    for (const key of [`mudex:draft:${id}`, `mudex:queue:${id}`, `mudex:queue-paused:${id}`, `mudex:chat-scroll:v1:${id}`]) {
      try { localStorage.removeItem(key); } catch { /* optional per-session preferences */ }
    }
    setDraftSessionIds((previous) => previous.filter((sessionId) => sessionId !== id));
    setQueuedSessionCounts((previous) => {
      if (previous[id] === undefined) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const deleteSession = async (id: string) => {
    const target = sessions.find((s) => s.id === id);
    if (runningIds.includes(id)) {
      setNotice(av.delRunningThread);
      return;
    }
    if (await requestConfirm({ title: av.delThreadTitle, message: formatStr(av.delThreadMsg, { title: target?.title || av.threadFallback }), confirmLabel: av.delThreadBtn, destructive: true }) !== 'confirm') return;
    clearSessionLocalState(id);
    // Updaters must stay pure (StrictMode double-invokes them): compute the
    // next list from the current render snapshot, then set both states.
    const next = sessions.filter((s) => s.id !== id);
    const fixed = next.length > 0 ? next : [newSession(undefined, lang)];
    setSessions(fixed);
    if (id === activeId) setActiveId(fixed[0].id);
  };

  const deleteSessions = async (ids: string[]): Promise<boolean> => {
    const targetIds = new Set(ids);
    const targets = sessions.filter((session) => targetIds.has(session.id));
    if (targets.length === 0) return false;
    if (targets.some((session) => runningIdsRef.current.includes(session.id))) {
      setNotice(av.delRunningThread);
      return false;
    }
    const names = targets.slice(0, 5).map((session) => `• ${session.title}`).join('\n');
    const remaining = targets.length > 5 ? formatStr(av.listMore, { n: targets.length - 5 }) : '';
    const result = await requestConfirm({
      title: formatStr(av.delThreadsTitle, { n: targets.length }),
      message: formatStr(av.delThreadsMsg, { names, rest: remaining }),
      confirmLabel: formatStr(av.delThreadsBtn, { n: targets.length }),
      destructive: true,
    });
    if (result !== 'confirm') return false;
    if (targets.some((session) => runningIdsRef.current.includes(session.id))) {
      setNotice(av.delCancelledRace);
      return false;
    }
    targetIds.forEach(clearSessionLocalState);
    const next = sessions.filter((session) => !targetIds.has(session.id));
    const fixed = next.length > 0 ? next : [newSession(undefined, lang)];
    setSessions(fixed);
    if (targetIds.has(activeId)) setActiveId(fixed[0].id);
    return true;
  };

  const renameSession = (id: string, title: string) => {
    const nextTitle = title.trim().slice(0, 80);
    if (!nextTitle) return;
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: nextTitle } : s));
  };

  const toggleSessionPinned = (id: string) => {
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, pinned: !s.pinned } : s));
  };

  const toggleSessionsPinned = (ids: string[]) => {
    if (ids.length === 0) return;
    const targetIds = new Set(ids);
    setSessions((previous) => {
      const targets = previous.filter((session) => targetIds.has(session.id));
      const shouldPin = !targets.length || targets.some((session) => !session.pinned);
      return previous.map((session) => targetIds.has(session.id) ? { ...session, pinned: shouldPin } : session);
    });
  };

  const toggleSessionArchived = (id: string) => {
    if (runningIds.includes(id)) {
      setNotice(av.archiveRunning);
      return;
    }
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, archived: !s.archived } : s));
  };

  const toggleSessionsArchived = (ids: string[]) => {
    if (ids.length === 0) return;
    const targetIds = new Set(ids);
    const targets = sessions.filter((session) => targetIds.has(session.id));
    const shouldArchive = targets.some((session) => !session.archived);
    if (shouldArchive && targets.some((session) => runningIdsRef.current.includes(session.id))) {
      setNotice(av.archiveRunning);
      return;
    }
    setSessions((previous) => previous.map((session) => targetIds.has(session.id) ? { ...session, archived: shouldArchive } : session));
  };

  const copySessionTranscript = async (session: Session) => {
    try {
      await navigator.clipboard.writeText(formatSessionTranscript(session, { lang }));
      setNotice(formatStr(av.copiedTranscript, { title: session.title }));
    } catch {
      setNotice(av.copyTranscriptFailed);
    }
  };

  const exportSessionTranscripts = async (ids: string[]): Promise<boolean> => {
    const targetIds = new Set(ids);
    const selectedSessions = sessions.filter((session) => targetIds.has(session.id));
    if (!selectedSessions.length) return false;
    try {
      const result = await api().exportMarkdown(
        formatStr(av.exportFileName, { n: selectedSessions.length }),
        formatSessionTranscripts(selectedSessions, { projectFallback: folder, lang }),
      );
      if (!result.ok) {
        setNotice(formatStr(av.exportFailed, { error: result.error || common.unknownError }));
        return false;
      }
      if (result.canceled) return false;
      setNotice(formatStr(av.exportedOk, { n: selectedSessions.length, tail: result.path ? formatStr(av.exportedPathTail, { path: result.path }) : av.exportedNoPath }));
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? formatStr(av.exportFailed, { error: error.message }) : av.exportFailedBare);
      return false;
    }
  };

  const backupSessions = async (ids: string[]): Promise<boolean> => {
    const targetIds = new Set(ids);
    const selectedSessions = sessions.filter((session) => targetIds.has(session.id));
    if (!selectedSessions.length) return false;
    try {
      const result = await api().exportBackup(
        formatStr(av.backupFileName, { n: selectedSessions.length }),
        createSessionBackup(selectedSessions),
      );
      if (!result.ok) {
        setNotice(formatStr(av.backupFailed, { error: result.error || common.unknownError }));
        return false;
      }
      if (result.canceled) return false;
      setNotice(formatStr(av.backupedOk, { n: selectedSessions.length, tail: result.path ? formatStr(av.exportedPathTail, { path: result.path }) : av.exportedNoPath }));
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? formatStr(av.backupFailed, { error: error.message }) : av.backupFailedBare);
      return false;
    }
  };

  const importSessions = async (): Promise<boolean> => {
    try {
      const picked = await api().pickBackup();
      if (!picked.ok || picked.cancelled || !picked.paths || picked.paths.length === 0) {
        setNotice(av.importCanceled);
        return false;
      }
      const read = await api().readFile(picked.paths[0]);
      if (!read.ok || read.content === undefined) {
        setNotice(formatStr(av.importReadFailed, { error: read.error || common.unknownError }));
        return false;
      }
      const parsed = parseSessionBackup(read.content);
      if (!parsed.ok) {
        setNotice(formatStr(av.importParseFailed, { error: parsed.error }));
        return false;
      }
      const now = Date.now();
      const fresh = toImportSessions(parsed.sessions, { createId: () => uid('id'), now });
      setSessions((prev) => [...fresh, ...prev]);
      setNotice(formatStr(av.importedOk, { n: fresh.length }));
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? formatStr(av.importReadFailed, { error: error.message }) : av.importFailedBare);
      return false;
    }
  };

  const hasProjectRun = () => sessions.some((session) => runningIds.includes(session.id) && (session.cwd || folder) === folder);

  const renameExplorerEntry = async (entryPath: string, newName: string): Promise<boolean> => {
    if (!folder) return false;
    if (hasProjectRun()) {
      setNotice(av.renameBlockedRun);
      return false;
    }
    const affected = tabs.filter((tab) => tab.kind === 'file' && tab.file && isSameOrDescendantPath(entryPath, tab.file.path));
    if (affected.some((tab) => tab.kind === 'file' && tab.file?.dirty)) {
      setNotice(av.renameDirtyTabs);
      return false;
    }
    try {
      const result = await api().renameEntry(folder, entryPath, newName);
      if (!result.ok || !result.path) {
        const message = result.error === 'ALREADY_EXISTS'
          ? av.renameExists
          : result.error === 'BAD_NAME'
            ? av.renameBadName
            : result.error === 'OUTSIDE_WORKSPACE'
              ? av.renameOutside
              : result.error === 'SYMLINK_UNSUPPORTED'
                ? av.renameSymlink
                : result.error || av.renameFailed;
        setNotice(message);
        return false;
      }
      setTabs((prev) => prev.map((tab) => {
        if (tab.kind !== 'file' || !tab.file || !isSameOrDescendantPath(entryPath, tab.file.path)) return tab;
        const nextPath = replacePathPrefix(tab.file.path, entryPath, result.path!);
        const name = basename(nextPath);
        return { ...tab, title: name, file: { ...tab.file, path: nextPath, name } };
      }));
      setRecentFiles((prev) => [
        ...new Set(prev.map((filePath) =>
          isSameOrDescendantPath(entryPath, filePath) ? replacePathPrefix(filePath, entryPath, result.path!) : filePath,
        )),
      ]);
      updateClosedFilePaths(closedFilePathsRef.current.map((filePath) =>
        isSameOrDescendantPath(entryPath, filePath) ? replacePathPrefix(filePath, entryPath, result.path!) : filePath,
      ));
      updateClosedPaneTabs(closedPaneTabsRef.current.map((tab) => tab.kind === 'file' && isSameOrDescendantPath(entryPath, tab.path)
        ? { ...tab, path: replacePathPrefix(tab.path, entryPath, result.path!) }
        : tab));
      const remappedNavigation = remapEditorNavigationPaths(editorNavigationRef.current, entryPath, result.path!);
      editorNavigationRef.current = remappedNavigation;
      setEditorNavigation(remappedNavigation);
      writeEditorNavigationHistory(folder, remappedNavigation);
      setNotice(av.renamedOk);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const deleteExplorerEntry = async (entryPath: string, isDir: boolean): Promise<boolean> => {
    if (!folder) return false;
    if (hasProjectRun()) {
      setNotice(av.deleteBlockedRun);
      return false;
    }
    const affected = tabs.filter((tab) => tab.kind === 'file' && tab.file && isSameOrDescendantPath(entryPath, tab.file.path));
    if (affected.some((tab) => tab.kind === 'file' && tab.file?.dirty)) {
      setNotice(av.deleteDirtyTabs);
      return false;
    }
    try {
      const result = await api().deleteEntry(folder, entryPath);
      if (!result.ok) {
        const message = result.error === 'OUTSIDE_WORKSPACE'
          ? av.deleteOutside
          : result.error === 'SYMLINK_UNSUPPORTED'
            ? av.deleteSymlink
            : result.error || av.deleteFailed;
        setNotice(message);
        return false;
      }
      const removedIds = new Set(affected.map((tab) => tab.id));
      const remaining = latestTabsRef.current.filter((tab) => !removedIds.has(tab.id));
      for (const tab of affected) removeTabFromStoredWorkspaceLayouts(tab.id);
      setTabs(remaining);
      setActiveTabId((current) => removedIds.has(current) ? (remaining[0]?.id || '') : current);
      setRecentFiles((prev) => prev.filter((filePath) => !isSameOrDescendantPath(entryPath, filePath)));
      updateClosedFilePaths(closedFilePathsRef.current.filter((filePath) => !isSameOrDescendantPath(entryPath, filePath)));
      updateClosedPaneTabs(closedPaneTabsRef.current.filter((tab) => tab.kind !== 'file' || !isSameOrDescendantPath(entryPath, tab.path)));
      const prunedNavigation = removeEditorNavigationPaths(editorNavigationRef.current, entryPath);
      editorNavigationRef.current = prunedNavigation;
      setEditorNavigation(prunedNavigation);
      writeEditorNavigationHistory(folder, prunedNavigation);
      setNotice(isDir ? av.trashedDir : av.trashedFile);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const commitGitFiles = async (message: string): Promise<boolean> => {
    if (!folder) return false;
    if (hasProjectRun()) {
      notify(av.commitBlockedRun, 'git');
      return false;
    }
    try {
      const result = await api().gitCommit(folder, message);
      if (!result.ok) {
        const notice = result.error === 'NO_CHANGES'
          ? av.commitNoStaged
          : result.error === 'EMPTY_MESSAGE'
            ? STRINGS[lang].files.commitNeedMsg
            : result.error === 'MESSAGE_TOO_LONG'
              ? STRINGS[lang].files.commitTooLong
              : result.error === 'GIT_NOT_FOUND'
                ? STRINGS[lang].files.gitNotFound
                : result.error || av.commitFailedBare;
        notify(notice, 'git');
        return false;
      }
      notify(result.hash ? formatStr(av.committedHash, { hash: result.hash }) : av.committedOk, 'git');
      void refreshChanged();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  // ------------------------------------------------------------ files
  const setWorkspaceFolder = (f: string) => {
    if (pathsEqual(folder, f)) {
      setTreeVersion((v) => v + 1);
      return;
    }
    // Freeze the old workspace on legacy terminals before the explorer folder
    // changes. Otherwise their cwd label and future terminal launches drift.
    const currentTabs = latestTabsRef.current.map((tab) =>
      tab.kind === 'terminal' && !tab.cwd ? { ...tab, cwd: folder || undefined } : tab,
    );
    writeEditorDrafts(currentTabs, latestActiveTabRef.current, undefined, folder);
    writeWorkspacePaneLayout(folder, currentTabs, latestActiveTabRef.current);
    setTabs(currentTabs);
    setTabsHydrated(false);
    setFolder(f);
    saveFolder(f);
    setTreeVersion((v) => v + 1);
  };

  const activateFolder = (f: string) => {
    if (!f) return;
    setWorkspaceFolder(f);
    setProjects((prev) => addProject(prev, f));
  };

  const switchProjectFolder = (f: string) => {
    if (!f) return;
    activateFolder(f);
    const matchingSession = sessions
      .filter((session) => !session.archived && !!session.cwd && pathsEqual(session.cwd, f))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.messages[b.messages.length - 1]?.ts || b.createdAt) - (a.messages[a.messages.length - 1]?.ts || a.createdAt))[0];
    if (matchingSession) {
      gotoThread(matchingSession.id);
      return;
    }
    const activeSession = sessions.find((session) => session.id === activeId);
    if (activeSession && !activeSession.cwd && activeSession.messages.length === 0) {
      setSessions((previous) => previous.map((session) => session.id === activeSession.id ? { ...session, cwd: f } : session));
      setActiveId(activeSession.id);
      setView('thread');
      return;
    }
    newChatInFolder(f);
  };

  const removeProjectFolder = (f: string) => {
    const next = removeProject(projects, f);
    setProjects(next);
    setSessions((previous) => detachProjectSessions(previous, f));
    if (pathsEqual(f, folder)) {
      if (next[0]) switchProjectFolder(next[0]);
      else setWorkspaceFolder('');
    }
  };

  const pickFolder = async () => {
    if (!hasBridge()) {
      setNotice(av.pickFolderNeedApp);
      return;
    }
    try {
      const res = await api().pickFolder();
      if (res.ok && res.path) switchProjectFolder(res.path);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const newChatInFolder = (f: string) => {
    activateFolder(f);
    const s = newSession(f, lang);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setView('thread');
  };

  const openFile = async (filePath: string, pinned = false): Promise<boolean> => {
    if (!hasBridge()) {
      setNotice(av.openFileNeedApp);
      return false;
    }
    const existing = tabs.find((t) => t.kind === 'file' && t.file && pathsEqual(t.file.path, filePath));
    if (existing) {
      if (pinned && !existing.pinned) setTabs((previous) => setPaneTabPinnedOrder(previous, existing.id, true));
      setRecentFiles((prev) => [filePath, ...prev.filter((path) => path !== filePath)].slice(0, 100));
      setActiveTabId(existing.id);
      setEditorVisible(true);
      return true;
    }
    const pathKey = normalizePathForComparison(filePath);
    return openingFilesRef.current(pathKey, async () => {
    try {
      const extension = filePath.toLowerCase().split('.').pop() || '';
      const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'];
      const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'];
      const videoExtensions = ['mp4', 'mov', 'mkv', 'webm', 'm4v'];
      const binaryExtensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'gz', 'bz2', 'xz', 'tar', 'woff', 'woff2', 'ttf', 'otf', 'wasm', 'tif', 'tiff', 'heic', 'heif', 'raw', 'cr2', 'dng', 'mid', 'midi', 'avi', 'mpeg', 'mpg'];
      const preview = imageExtensions.includes(extension) ? 'image'
        : extension === 'pdf' ? 'pdf'
          : audioExtensions.includes(extension) ? 'audio'
            : videoExtensions.includes(extension) ? 'video'
              : binaryExtensions.includes(extension) ? 'binary'
                : undefined;
      let content = '';
      if (!preview) {
        const res = await api().readFile(filePath);
        if (!res.ok) {
          setNotice(
            (res.error || '').startsWith('TOO_LARGE:')
              ? av.fileTooLargeOpen
              : formatStr(av.openFileFailed, { error: res.error }),
          );
          return false;
        }
        content = res.content ?? '';
      }
      const tab: PaneTab = {
        id: uid('tab'),
        kind: 'file',
        title: basename(filePath),
        ...(pinned ? { pinned: true } : {}),
        file: {
          path: filePath,
          name: basename(filePath),
          original: content,
          content,
          dirty: false,
          showDiff: false,
          ...(preview ? { readOnly: true, preview } : {}),
        },
      };
      setTabs((prev) => [...prev, tab]);
      setRecentFiles((prev) => [filePath, ...prev.filter((path) => path !== filePath)].slice(0, 100));
      setActiveTabId(tab.id);
      setEditorVisible(true);
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return false;
    }
    });
  };

  const reopenClosedTab = async (requestedTab?: ClosedPaneTab) => {
    if (reopeningClosedFileRef.current) return;
    const closedTabs = closedPaneTabsRef.current;
    const closedTab = requestedTab || closedTabs[closedTabs.length - 1];
    if (closedTab) {
      if (!closedTabs.includes(closedTab)) return;
      reopeningClosedFileRef.current = true;
      try {
        if (closedTab.kind === 'file') {
          if (await openFile(closedTab.path, !!closedTab.pinned)) {
            updateClosedPaneTabs(closedPaneTabsRef.current.filter((item) => item !== closedTab));
            const index = closedFilePathsRef.current.map((path) => normalizePathForComparison(path)).lastIndexOf(normalizePathForComparison(closedTab.path));
            if (index >= 0) updateClosedFilePaths(closedFilePathsRef.current.filter((_, pathIndex) => pathIndex !== index));
          }
          return;
        }
        let restoredTab: PaneTab | null = null;
        if (closedTab.kind === 'files') {
          restoredTab = latestTabsRef.current.find((tab) => tab.kind === 'files') || {
            id: uid('tab'), kind: 'files', title: closedTab.title,
          };
        } else if (closedTab.kind === 'browser') {
          restoredTab = { id: uid('tab'), kind: 'browser', title: closedTab.title, url: closedTab.url };
        } else if (closedTab.kind === 'terminal') {
          restoredTab = {
            id: uid('tab'), kind: 'terminal', title: closedTab.title,
            shell: closedTab.shell || 'powershell', cwd: closedTab.cwd || folder || undefined,
          };
        }
        if (!restoredTab) return;
        const alreadyOpen = latestTabsRef.current.some((tab) => tab.id === restoredTab!.id);
        if (!alreadyOpen) setTabs((previous) => [...previous, restoredTab!]);
        setActiveTabId(restoredTab.id);
        setEditorVisible(true);
        updateClosedPaneTabs(closedPaneTabsRef.current.filter((item) => item !== closedTab));
        if (closedTab.kind === 'terminal') setNotice(av.termTabRestored);
        else if (closedTab.kind === 'browser') setNotice(av.browserTabRestored);
        return;
      } finally {
        reopeningClosedFileRef.current = false;
      }
    }
    const filePath = closedFilePathsRef.current[closedFilePathsRef.current.length - 1];
    if (!filePath) {
      setNotice(av.noClosedTabs);
      return;
    }
    reopeningClosedFileRef.current = true;
    try {
      if (await openFile(filePath)) {
        updateClosedFilePaths(closedFilePathsRef.current.slice(0, -1));
      }
    } finally {
      reopeningClosedFileRef.current = false;
    }
  };
  reopenClosedFileRef.current = () => { void reopenClosedTab(); };

  const retryPendingLineReveal = useCallback((request: NonNullable<typeof pendingLineRevealRef.current> | null = pendingLineRevealRef.current) => {
    const pending = request;
    if (!pending || pendingLineRevealRef.current !== pending) return;
    const activeTab = latestTabsRef.current.find((tab) => tab.id === latestActiveTabRef.current);
    if (activeTab?.file?.path && pathsEqual(activeTab.file.path, pending.path)) {
      pending.wasActive = true;
      if (activeTab.file.preview) {
        pendingLineRevealRef.current = null;
        setNotice(STRINGS[langRef.current].app.revealPreviewBlocked);
        return;
      }
      const editor = editorApiRef.current;
      if (editor?.filePath && pathsEqual(editor.filePath, pending.path) && editor.revealLine(pending.line, pending.column)) {
        pendingLineRevealRef.current = null;
        return;
      }
    } else if (pending.wasActive) {
      pendingLineRevealRef.current = null;
      return;
    }
    pending.attempts += 1;
    if (pending.attempts >= 100) {
      pendingLineRevealRef.current = null;
      if (pending.wasActive) setNotice(STRINGS[langRef.current].app.revealLate);
      return;
    }
    window.setTimeout(() => retryPendingLineReveal(pending), 50);
  }, []);

  const retryPendingEditorInsertion = useCallback((request: NonNullable<typeof pendingEditorInsertionRef.current> | null = pendingEditorInsertionRef.current) => {
    const pending = request;
    if (!pending || pendingEditorInsertionRef.current !== pending) return;
    const activeTab = latestTabsRef.current.find((tab) => tab.id === latestActiveTabRef.current);
    if (activeTab?.file?.path && pathsEqual(activeTab.file.path, pending.path)) {
      pending.wasActive = true;
      if (activeTab.file.preview) {
        pendingEditorInsertionRef.current = null;
        setNotice(STRINGS[langRef.current].app.insertPreviewBlocked);
        return;
      }
      const editor = editorApiRef.current;
      if (editor?.filePath && pathsEqual(editor.filePath, pending.path) && editor.insertAtCursor(pending.code)) {
        pendingEditorInsertionRef.current = null;
        return;
      }
    } else if (pending.wasActive) {
      pendingEditorInsertionRef.current = null;
      return;
    }
    pending.attempts += 1;
    if (pending.attempts >= 100) {
      pendingEditorInsertionRef.current = null;
      if (pending.wasActive) setNotice(STRINGS[langRef.current].app.insertLate);
      return;
    }
    window.setTimeout(() => retryPendingEditorInsertion(pending), 50);
  }, []);

  const openFileAtLine = async (filePath: string, line: number, column = 1, pinned = false) => {
    const request = { path: filePath, line, column, attempts: 0, wasActive: false };
    pendingLineRevealRef.current = request;
    if (!await openFile(filePath, pinned)) {
      if (pendingLineRevealRef.current === request) pendingLineRevealRef.current = null;
      return false;
    }
    retryPendingLineReveal(request);
    return true;
  };

  const rememberEditorLocation = (location: { path: string; line: number; column: number }) => {
    const current = editorNavigationRef.current;
    const next = { ...pushEditorLocation(current.entries, current.index, location), bookmarks: current.bookmarks };
    editorNavigationRef.current = next;
    setEditorNavigation(next);
    writeEditorNavigationHistory(folder, next);
  };

  const toggleEditorLocationBookmark = (location: { path: string; line: number; column: number }) => {
    const current = editorNavigationRef.current;
    const result = toggleLocationBookmark(current.bookmarks, location);
    const next = { ...current, bookmarks: result.bookmarks };
    editorNavigationRef.current = next;
    setEditorNavigation(next);
    writeEditorNavigationHistory(folder, next);
    setNotice(result.bookmarked ? av.locBookmarked : av.locUnbookmarked);
  };

  const onEditorCursorLocationChange = (path: string, line: number, column: number) => {
    pendingEditorLocationRef.current = { path, line, column };
    if (pendingEditorLocationTimerRef.current !== null) window.clearTimeout(pendingEditorLocationTimerRef.current);
    pendingEditorLocationTimerRef.current = window.setTimeout(() => {
      pendingEditorLocationTimerRef.current = null;
      const pending = pendingEditorLocationRef.current;
      pendingEditorLocationRef.current = null;
      if (pending) rememberEditorLocation(pending);
    }, 650);
  };

  const flushPendingEditorLocation = () => {
    if (pendingEditorLocationTimerRef.current !== null) {
      window.clearTimeout(pendingEditorLocationTimerRef.current);
      pendingEditorLocationTimerRef.current = null;
      const pending = pendingEditorLocationRef.current;
      pendingEditorLocationRef.current = null;
      if (pending) rememberEditorLocation(pending);
    }
  };

  const navigateEditorLocationToIndex = (targetIndex: number) => {
    flushPendingEditorLocation();
    const previousIndex = editorNavigationRef.current.index;
    const targetLocation = editorNavigationRef.current.entries[targetIndex];
    if (!targetLocation || targetIndex === previousIndex) return false;
    const next = { ...editorNavigationRef.current, index: targetIndex };
    editorNavigationRef.current = next;
    setEditorNavigation(next);
    writeEditorNavigationHistory(folder, next);
    setView('thread');
    setEditorVisible(true);
    void openFileAtLine(targetLocation.path, targetLocation.line, targetLocation.column).then((opened) => {
      if (opened) return;
      if (editorNavigationRef.current.index !== targetIndex) return;
      const restored = { ...editorNavigationRef.current, index: previousIndex };
      editorNavigationRef.current = restored;
      setEditorNavigation(restored);
      writeEditorNavigationHistory(folder, restored);
    });
    return true;
  };

  const navigateEditorLocation = (direction: 1 | -1) => {
    flushPendingEditorLocation();
    const target = stepEditorLocation(editorNavigationRef.current.entries, editorNavigationRef.current.index, direction);
    return target.location ? navigateEditorLocationToIndex(target.index) : false;
  };
  navigateEditorLocationRef.current = navigateEditorLocation;

  const navigateEditorToLocation = (location: { path: string; line: number; column: number }) => {
    flushPendingEditorLocation();
    const index = editorNavigationRef.current.entries.findIndex((entry) => pathsEqual(entry.path, location.path)
      && entry.line === location.line && entry.column === location.column);
    if (index >= 0) return navigateEditorLocationToIndex(index);
    setView('thread');
    setEditorVisible(true);
    void openFileAtLine(location.path, location.line, location.column);
    return true;
  };

  const changeFile = (tabId: string, content: string) =>
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId && t.file ? { ...t, file: { ...t.file, content, dirty: content !== t.file.original } } : t,
      ),
    );

  const refreshOpenFileFromDisk = async (changedPath: string) => {
    const openTabs = latestTabsRef.current.filter((tab) => tab.kind === 'file' && tab.file && !tab.file.readOnly && pathsEqual(tab.file.path, changedPath));
    if (!openTabs.length || !hasBridge()) return;
    let result: { ok: boolean; content?: string; error?: string };
    try { result = await api().readFile(changedPath); }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    setTabs((previous) => previous.map((tab) => {
      if (tab.kind !== 'file' || !tab.file || !pathsEqual(tab.file.path, changedPath)) return tab;
      const file = reconcileOpenFileDiskState(tab.file, result);
      return file === tab.file ? tab : { ...tab, file };
    }));
  };
  refreshOpenFileFromDiskRef.current = (path) => { void refreshOpenFileFromDisk(path); };

  const saveFile = async (tabId: string) => {
    const target = tabs.find((t) => t.id === tabId && t.kind === 'file' && t.file);
    if (!target || !target.file || !hasBridge()) return;
    if (target.file.readOnly) return;
    const file = target.file;
    const contentToSave = file.content;
    try {
      let res = await api().writeFile(file.path, contentToSave, file.original);
      if (!res.ok && res.error === 'FILE_CHANGED') {
        const overwrite = await requestConfirm({ title: av.extChangeTitle, message: formatStr(av.extChangeMsg, { name: file.name }), confirmLabel: av.extChangeBtn, destructive: true });
        if (overwrite !== 'confirm') {
          setTabs((previous) => previous.map((tab) => tab.id === tabId && tab.file ? { ...tab, file: { ...tab.file, diskState: 'changed' } } : tab));
          setNotice(av.extChangeKept);
          return false;
        }
        res = await api().writeFile(file.path, contentToSave);
      }
      if (!res.ok) {
        const diskState = res.error === 'FILE_MISSING' ? 'missing' : res.error === 'FILE_CHANGED' ? 'changed' : res.error ? 'unavailable' : undefined;
        if (diskState) setTabs((previous) => previous.map((tab) => tab.id === tabId && tab.file ? { ...tab, file: { ...tab.file, diskState, ...(diskState === 'missing' ? { externalContent: undefined } : {}) } } : tab));
        setNotice(res.error === 'FILE_MISSING' ? av.fileDeletedOnDisk : formatStr(av.saveFailed, { error: res.error }));
        return false;
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId && t.file ? { ...t, file: { ...t.file, original: contentToSave, dirty: t.file.content !== contentToSave, diskState: undefined, externalContent: undefined } } : t,
        ),
      );
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const saveAllFiles = async () => {
    if (savingAllFilesRef.current) return;
    const dirtyFiles = tabs.filter((tab) => tab.kind === 'file' && tab.file?.dirty && !tab.file.readOnly);
    if (!dirtyFiles.length) return;
    savingAllFilesRef.current = true;
    setSavingAllFiles(true);
    try {
      const { saved, failed } = await saveFilesSequentially(dirtyFiles, (tab) => saveFile(tab.id));
      if (failed.length) setNotice(formatStr(av.saveAllPartial, {
        saved: saved.length,
        failed: failed.length,
        names: failed.slice(0, 4).map((tab) => tab.title).join(', '),
        more: failed.length > 4 ? formatStr(av.saveAllMore, { n: failed.length - 4 }) : '',
      }));
      else setNotice(formatStr(av.saveAllOk, { n: saved.length }));
    } finally {
      savingAllFilesRef.current = false;
      setSavingAllFiles(false);
    }
  };
  saveAllFilesRef.current = () => { void saveAllFiles(); };

  const reloadFile = async (tabId: string) => {
    const target = tabs.find((t) => t.id === tabId && t.kind === 'file' && t.file);
    if (!target?.file || !hasBridge()) return;
    const file = target.file;
    if (file.dirty && await requestConfirm({ title: av.reloadTitle, message: formatStr(av.reloadMsg, { name: file.name }), confirmLabel: av.reloadBtn, destructive: true }) !== 'confirm') return;
    try {
      const result = await api().readFile(file.path);
      if (!result.ok || result.content === undefined) {
        setNotice(result.error === 'TOO_LARGE' ? av.reloadTooLarge : formatStr(av.reloadFailed, { error: result.error || common.unknownError }));
        return;
      }
      setTabs((prev) => prev.map((tab) => tab.id === tabId && tab.file
        ? { ...tab, file: { ...tab.file, original: result.content!, content: result.content!, dirty: false, showDiff: false, diskState: undefined, externalContent: undefined } }
        : tab));
      setNotice(av.reloadedOk);
    } catch (error) {
      setNotice(formatStr(av.reloadFailed, { error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const openFileExternally = async (filePath: string) => {
    if (!hasBridge()) return;
    try {
      const result = await api().openFileDefault(filePath);
      setNotice(result.ok ? formatStr(av.openedExternal, { name: basename(filePath) }) : formatStr(av.openExternalFailed, { error: result.error || common.unknownError }));
    } catch (error) {
      setNotice(formatStr(av.openExternalFailed, { error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const closeTab = async (tabId: string) => {
    const target = tabs.find((tab) => tab.id === tabId);
    if (target?.kind === 'file' && target.file?.dirty && !target.file.readOnly) {
      const choice = await requestConfirm({ title: av.unsavedTitle, message: formatStr(av.unsavedMsgOne, { title: target.title }), confirmLabel: av.unsavedDiscardOne, alternateLabel: av.unsavedSaveClose, destructive: true });
      if (choice === 'cancel') return;
      if (choice === 'alternate' && !await saveFile(tabId)) return;
    }
    if (target?.kind === 'file' && target.file) {
      updateClosedFilePaths([...closedFilePathsRef.current, target.file.path]);
    }
    const closedSnapshot = target ? closedPaneTabSnapshot(target) : null;
    if (closedSnapshot) updateClosedPaneTabs([...closedPaneTabsRef.current, closedSnapshot]);
    removeTabFromStoredWorkspaceLayouts(tabId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (tabId === activeTabId && next.length > 0) {
        const idx = Math.max(0, prev.findIndex((t) => t.id === tabId) - 1);
        setActiveTabId(next[Math.min(idx, next.length - 1)].id);
      } else if (tabId === activeTabId) {
        setActiveTabId('');
      }
      return next;
    });
  };
  closeTabRef.current = closeTab;

  const closeTabs = async (tabIds: string[]) => {
    const closingIds = new Set(tabIds);
    const closing = tabs.filter((tab) => closingIds.has(tab.id));
    if (!closing.length) return;
    const dirty = closing.filter((tab) => tab.kind === 'file' && tab.file?.dirty && !tab.file.readOnly);
    if (dirty.length) {
      const names = dirty.slice(0, 4).map((tab) => `• ${tab.title}`).join('\n');
      const rest = dirty.length > 4 ? formatStr(av.listMore, { n: dirty.length - 4 }) : '';
      const choice = await requestConfirm({ title: av.unsavedTitle, message: formatStr(av.unsavedMsgMany, { n: dirty.length, names, rest }), confirmLabel: formatStr(av.unsavedDiscardMany, { n: dirty.length }), alternateLabel: av.unsavedSaveCloseAll, destructive: true });
      if (choice === 'cancel') return;
      if (choice === 'alternate') {
        for (const tab of dirty) {
          if (!await saveFile(tab.id)) return;
        }
      }
    }
    updateClosedFilePaths([
      ...closedFilePathsRef.current,
      ...closing.filter((tab) => tab.kind === 'file' && tab.file).map((tab) => tab.file!.path),
    ]);
    updateClosedPaneTabs([
      ...closedPaneTabsRef.current,
      ...closing.map(closedPaneTabSnapshot).filter((tab): tab is ClosedPaneTab => !!tab),
    ]);
    const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    const remaining = tabs.filter((tab) => !closingIds.has(tab.id));
    for (const tab of closing) removeTabFromStoredWorkspaceLayouts(tab.id);
    setTabs(remaining);
    if (closingIds.has(activeTabId)) {
      const nextIndex = Math.min(Math.max(0, activeIndex - 1), remaining.length - 1);
      setActiveTabId(remaining[nextIndex]?.id || '');
    }
  };
  closeTabsRef.current = closeTabs;

  const reorderTabs = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    setTabs((prev) => {
      const from = prev.findIndex((tab) => tab.id === fromId);
      const to = prev.findIndex((tab) => tab.id === toId);
      if (from < 0 || to < 0) return prev;
      if (!!prev[from].pinned !== !!prev[to].pinned) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setActiveTabId(toId);
  };

  const toggleTabPinned = (tabId: string) => {
    setTabs((previous) => {
      const tab = previous.find((candidate) => candidate.id === tabId && candidate.kind === 'file');
      return tab ? setPaneTabPinnedOrder(previous, tabId, !tab.pinned) : previous;
    });
  };

  const toggleDiff = (tabId: string) =>
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId && t.file ? { ...t, file: { ...t.file, showDiff: !t.file.showDiff } } : t)),
    );

  const newPaneTab = (kind: PaneTabKind, cwd?: string, url?: string) => {
    if (kind === 'files') {
      const existing = tabs.find((t) => t.kind === 'files');
      if (existing) {
        setActiveTabId(existing.id);
        setEditorVisible(true);
        return;
      }
    }
    const tab: PaneTab = {
      id: uid('tab'),
      kind,
      title: kind === 'browser' ? av.newBrowserTab : kind === 'terminal' ? (cwd ? formatStr(av.termIn, { name: basename(cwd) }) : av.termTab) : av.filesTab,
      ...(kind === 'terminal' ? { shell: 'powershell' as const, cwd: cwd || folder || undefined } : {}),
      ...(kind === 'browser' && url ? { url } : {}),
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setEditorVisible(true);
  };

  const openTerminalAt = (cwd: string) => {
    const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const target = normalize(cwd);
    const existing = tabs.find((tab) => tab.kind === 'terminal' && normalize(tab.cwd || folder) === target);
    if (existing) {
      setActiveTabId(existing.id);
      setEditorVisible(true);
      return;
    }
    newPaneTab('terminal', cwd);
  };

  const openTerminal = () => {
    setView('thread');
    setEditorVisible(true);
    openTerminalAt(folder);
  };
  openTerminalRef.current = openTerminal;

  const pickFileTab = async () => {
    if (!hasBridge()) {
      setNotice(av.openFileNeedApp);
      return;
    }
    try {
      const res = await api().pickFiles();
      if (res.ok && res.paths) {
        for (const p of res.paths.slice(0, 10)) await openFile(p);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const browserTitle = (tabId: string, title: string) =>
    setTabs((prev) => (prev.some((t) => t.id === tabId && t.title !== title) ? prev.map((t) => (t.id === tabId ? { ...t, title } : t)) : prev));

  const browserUrl = (tabId: string, url: string) =>
    setTabs((prev) => (prev.some((t) => t.id === tabId && t.url !== url) ? prev.map((t) => (t.id === tabId ? { ...t, url } : t)) : prev));

  const openBookmark = (url: string) => {
    // Active browser tab navigates in place (Chrome-like); otherwise a new tab.
    const active = latestTabsRef.current.find((t) => t.id === latestActiveTabRef.current);
    if (active?.kind === 'browser') {
      setEditorVisible(true);
      if (hasBridge()) void api().browserNavigate(active.id, url).catch(() => setNotice(av.bookmarkOpenFailed));
    } else {
      newPaneTab('browser', undefined, url);
    }
  };

  const toggleBookmark = (tabId: string, url: string) => {
    if (!normalizeBookmarkUrl(url)) {
      setNotice(av.bookmarkBadUrl);
      return;
    }
    const live = latestTabsRef.current.find((t) => t.id === tabId);
    const title = live?.kind === 'browser' ? live.title : '';
    const was = isBrowserBookmarked(bookmarksRef.current, url);
    setBookmarks((prev) => toggleBrowserBookmark(prev, url, title));
    setNotice(was ? av.bookmarkRemoved : av.bookmarkSaved);
  };

  const termShell = (tabId: string, shell: 'powershell' | 'cmd') =>
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, shell } : t)));

  const openGitDiff = async (file: string, cwd: string) => {
    if (!hasBridge() || !cwd) {
      notify(av.gitDiffFailed, 'git');
      return;
    }
    const abs = `${cwd}${cwd.endsWith('\\') || cwd.endsWith('/') ? '' : '\\'}${file.replace(/\//g, '\\')}`;
    try {
      const head = await api().gitShow(cwd, file);
      const disk = await api().readFile(abs);
      if (!disk.ok) {
        setNotice(formatStr(av.readFileFailed, { error: disk.error }));
        return;
      }
      const key = `git:${cwd}:${file}`;
      const entry = {
        path: key,
        name: `${file} (git diff)`,
        original: head.ok ? head.content ?? '' : '',
        content: disk.content ?? '',
        dirty: false,
        showDiff: true,
        readOnly: true,
      };
      const hit = tabs.find((t) => t.kind === 'file' && t.file && t.file.path === key);
      if (hit) {
        setTabs((prev) => prev.map((t) => (t.id === hit.id ? { ...t, file: entry } : t)));
        setActiveTabId(hit.id);
      } else {
        const tab: PaneTab = { id: uid('tab'), kind: 'file', title: `${file} (diff)`, file: entry };
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
      }
      setEditorVisible(true);
      setView('thread');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const insertToEditor = (code: string) => {
    const target = tabs.find((t) => t.id === activeTabId && t.kind === 'file' && t.file && !t.file.readOnly)
      || tabs.find((t) => t.kind === 'file' && t.file && !t.file.readOnly);
    if (!target) {
      setNotice(av.noEditorForInsert);
      return;
    }
    const request = { path: target.file!.path, code, attempts: 0, wasActive: false };
    pendingEditorInsertionRef.current = request;
    setActiveTabId(target.id);
    setEditorVisible(true);
    retryPendingEditorInsertion(request);
  };

  // ------------------------------------------------------------ settings
  const persistSettings = async (next: CliSettings) => {
    const needRecheck = next.cliPath !== settings.cliPath || next.engine !== settings.engine;
    setSettings(next);
    if (!hasBridge()) return;
    try {
      await api().saveSettings(next);
      if (!needRecheck) return;
      setCliStatus('checking');
      const r = await api().cliTest();
      setCliStatus(r.ok ? 'ok' : r.error === 'CLI_NOT_FOUND' ? 'missing' : 'error');
      setCliResolved(r.resolvedPath || '');
    } catch {
      setCliStatus('error');
    }
  };

  const patchSettings = (patch: Partial<CliSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (hasBridge()) api().saveSettings(next).catch(() => {});
      return next;
    });
  };

  const monacoTheme = settings.codeTheme === 'auto' ? (dark ? 'vs-dark' : 'vs') : settings.codeTheme;

  const gotoThread = (id: string) => {
    const targetSession = sessions.find((session) => session.id === id);
    if (!targetSession) return;
    if (targetSession?.cwd && !pathsEqual(targetSession.cwd, folder)) {
      setWorkspaceFolder(targetSession.cwd);
      setProjects((previous) => addProject(previous, targetSession.cwd!));
    }
    setSessions((prev) => prev.map((s) => s.id === id && s.archived ? { ...s, archived: false } : s));
    setActiveId(id);
    setView('thread');
    setPaletteOpen(false);
  };

  const gotoThreadRef = useRef(gotoThread);
  gotoThreadRef.current = gotoThread;

  const duplicateSessionById = (id: string) => {
    const source = sessionsRef.current.find((s) => s.id === id);
    const copy = source ? duplicateSession(source, { lang }) : null;
    if (!copy) {
      setNotice(av.dupFailed);
      return;
    }
    setSessions((prev) => {
      const at = prev.findIndex((s) => s.id === id);
      const next = [...prev];
      next.splice(at < 0 ? next.length : at + 1, 0, copy);
      return next;
    });
    setNotice(formatStr(av.dupOk, { title: copy.title }));
    scheduleAfterPaint(() => gotoThreadRef.current(copy.id));
  };
  useEffect(() => {
    if (!hasBridge()) return;
    return api().onNotificationClick(({ sessionId }) => gotoThreadRef.current(sessionId));
  }, []);

  const switchRecentSession = (direction: 1 | -1) => {
    const availableIds = recentSessionIdsRef.current.filter((id) => sessions.some((session) => session.id === id && !session.archived));
    if (availableIds.length < 2) {
      setNotice(av.noOtherRecent);
      return;
    }
    const currentIndex = availableIds.indexOf(activeId);
    const nextIndex = currentIndex < 0
      ? (direction < 0 ? availableIds.length - 1 : 0)
      : (currentIndex + direction + availableIds.length) % availableIds.length;
    gotoThread(availableIds[nextIndex]);
  };
  switchRecentSessionRef.current = switchRecentSession;

  const openCodex = () => {
    setView('thread');
    setCodexSignal((n) => n + 1);
  };

  const openClaude = () => {
    setView('thread');
    setClaudeSignal((n) => n + 1);
  };

  const openBrowser = () => {
    setView('thread');
    setEditorVisible(true);
    const existing = tabs.find((t) => t.kind === 'browser');
    if (existing) setActiveTabId(existing.id);
    else newPaneTab('browser');
  };

  const openFilesViewer = () => {
    setView('thread');
    setEditorVisible(true);
    const existing = tabs.find((t) => t.kind === 'files');
    if (existing) setActiveTabId(existing.id);
    else newPaneTab('files');
  };
  openFilesViewerRef.current = openFilesViewer;
  const openWorkspaceSearch = () => {
    const selection = editorApiRef.current?.getSelection()?.text;
    setFileSearchQuery(prefillWorkspaceSearchQuery(selection));
    setFileSearchMode('content');
    setFileSearchFocusRequest((value) => value + 1);
    openFilesViewer();
  };
  openWorkspaceSearchRef.current = openWorkspaceSearch;

  const openQuickFile = (filePath: string, line?: number, column?: number, pinned = false) => {
    setView('thread');
    if (line) void openFileAtLine(filePath, line, column, pinned);
    else void openFile(filePath, pinned);
  };

  const activeEditableFileTab = tabs.find((tab) =>
    tab.id === activeTabId && tab.kind === 'file' && !!tab.file && !tab.file.readOnly,
  );
  const savedFileTabIds = tabs
    .filter((tab) => tab.kind === 'file' && tab.file && (!tab.file.dirty || tab.file.readOnly))
    .map((tab) => tab.id);
  const tabSelectionActions: PaletteAction[] = tabs.map((tab, index) => {
    const shortcut = index < 8 ? `Ctrl+${index + 1}` : index === tabs.length - 1 ? 'Ctrl+9' : '';
    const location = tab.kind === 'file' && tab.file
      ? tab.file.path
      : tab.kind === 'terminal'
        ? tab.cwd || folder
        : tab.kind === 'browser'
          ? tab.url || ''
          : folder;
    const modified = tab.kind === 'file' && tab.file?.dirty && !tab.file.readOnly;
    return {
      id: `switch-tab-${tab.id}`,
      title: formatStr(av.palGotoTab, { prefix: tab.id === activeTabId ? av.palCurrentPrefix : '', title: tab.title, modified: modified ? av.palModified : '' }),
      hint: [shortcut, location].filter(Boolean).join(' · ') || undefined,
      keywords: ['switch tab', 'open tab', tab.kind, tab.title, ...(tab.file ? [tab.file.name, tab.file.path] : []), tab.cwd || '', tab.url || '', ...(modified ? ['수정됨', 'dirty'] : [])],
      run: () => {
        latestActiveTabRef.current = tab.id;
        setActiveTabId(tab.id);
        setView('thread');
        setEditorVisible(true);
        setPaletteOpen(false);
      },
    };
  });
  const closableUnpinnedTabIds = unpinnedPaneTabIds(tabs);
  const availableProjects = [...new Set([...projects, ...sessions.map((session) => session.cwd || '').filter(Boolean)])];
  const projectActions: PaletteAction[] = availableProjects.flatMap((project) => {
    const name = basename(project) || project;
    const projectKey = encodeURIComponent(project);
    const isPinned = pinnedProjects.some((path) => pathsEqual(path, project));
    return [
      {
        id: `open-project-${projectKey}`,
        title: formatStr(av.palSwitchProject, { name }),
        hint: project,
        keywords: ['open project', 'switch workspace', '프로젝트 전환', '작업 폴더', project],
        run: () => { switchProjectFolder(project); setPaletteOpen(false); },
      },
      {
        id: `new-project-session-${projectKey}`,
        title: formatStr(av.palNewSession, { name }),
        hint: project,
        keywords: ['new session in project', 'new thread in folder', '프로젝트 새 세션', project],
        run: () => { newChatInFolder(project); setPaletteOpen(false); },
      },
      {
        id: `open-project-terminal-${projectKey}`,
        title: formatStr(av.palProjectTerm, { name }),
        hint: project,
        keywords: ['open terminal in project', 'terminal here', '프로젝트 터미널', project],
        run: () => { openTerminalAt(project); setPaletteOpen(false); },
      },
      {
        id: `toggle-pin-project-${projectKey}`,
        title: formatStr(isPinned ? av.palUnpinProject : av.palPinProject, { name }),
        hint: project,
        keywords: ['pin project', 'unpin project', 'favorite workspace', '프로젝트 고정', '프로젝트 즐겨찾기', project],
        run: () => {
          setPinnedProjects((previous) => togglePinnedProject(previous, project));
          setPaletteOpen(false);
        },
      },
    ];
  });
  const sessionActions: PaletteAction[] = sessions.flatMap((session) => {
    const run = (action: () => void) => () => {
      action();
      setPaletteOpen(false);
    };
    const location = session.cwd ? ` · ${basename(session.cwd)}` : '';
    return [
      {
        id: `toggle-pin-session-${session.id}`,
        title: formatStr(session.pinned ? av.palUnpinSession : av.palPinSession, { title: session.title }),
        hint: location.trim(),
        keywords: ['pin session', 'unpin session', '고정', '즐겨찾기', session.title, session.cwd || ''],
        run: run(() => toggleSessionPinned(session.id)),
      },
      {
        id: `toggle-archive-session-${session.id}`,
        title: formatStr(session.archived ? av.palUnarchive : av.palArchive, { title: session.title }),
        hint: location.trim(),
        keywords: ['archive session', 'unarchive session', '보관', '보관 해제', session.title, session.cwd || ''],
        run: run(() => toggleSessionArchived(session.id)),
      },
      {
        id: `copy-transcript-session-${session.id}`,
        title: formatStr(av.palCopyTranscript, { title: session.title }),
        hint: session.messages.length ? formatStr(av.palMsgCount, { n: session.messages.length }) : av.palNoMessages,
        keywords: ['copy transcript', 'export conversation', '대화 복사', '대화 내보내기', session.title, session.cwd || ''],
        run: run(() => { void copySessionTranscript(session); }),
      },
      {
        id: `duplicate-session-${session.id}`,
        title: formatStr(av.palDupSession, { title: session.title }),
        hint: session.messages.length ? formatStr(av.palMsgCount, { n: session.messages.length }) : av.palNoMessages,
        // NOTE: no '스레드 복제' keyword — it startsWith-matches the '스레드'
        // token and would outrank the '새 스레드' new-thread action.
        keywords: ['duplicate session', 'clone session', 'copy session', '세션 복제', '복제', '사본', session.title, session.cwd || ''],
        run: run(() => duplicateSessionById(session.id)),
      },
    ];
  });
  const closedPaneTabName = (tab: ClosedPaneTab) => tab.kind === 'file'
    ? tab.path.split(/[\\/]/).pop() || tab.path
    : tab.title;
  const closedPaneTabKind = (tab: ClosedPaneTab) => tab.kind === 'file' ? av.palKindFile : tab.kind === 'files' ? av.palKindFiles : tab.kind === 'terminal' ? av.palKindTerm : av.palKindBrowser;
  const latestClosedPaneTab = closedPaneTabsRef.current[closedPaneTabsRef.current.length - 1];
  const recentlyClosedTabActions: PaletteAction[] = closedPaneTabsRef.current
    .slice(0, -1)
    .slice(-8)
    .reverse()
    .map((tab, order) => ({
      id: `reopen-recent-tab-${tab.kind}-${order}-${encodeURIComponent(closedPaneTabName(tab))}`,
      title: formatStr(av.palReopenRecent, { name: closedPaneTabName(tab) }),
      hint: tab.kind === 'file' ? tab.path : closedPaneTabKind(tab),
      keywords: ['reopen closed tab', 'recently closed tab', 'restore tab', '닫은 탭 복구', '최근 닫은 탭', closedPaneTabName(tab), tab.kind === 'file' ? tab.path : ''],
      run: () => { setPaletteOpen(false); void reopenClosedTab(tab); },
    }));
  // Composer slash commands: every id maps to an existing affordance.
  const runSlashCommand = (sessionId: string, id: string) => {
    setPaletteOpen(false);
    setQuickOpen(false);
    switch (id) {
      case 'new':
        newChat();
        setView('thread');
        break;
      case 'model':
        setActiveId(sessionId);
        setView('thread');
        setTuneSignal((signal) => signal + 1);
        break;
      case 'usage':
        setView('usage');
        break;
      case 'settings':
        setView('settings');
        break;
      case 'shortcuts':
        setShortcutsOpen(true);
        break;
      case 'schedule':
        setScheduleListOpen(true);
        break;
      case 'export':
        void exportSessionTranscripts([sessionId]);
        break;
      case 'diff':
        openFilesViewer();
        break;
      case 'terminal':
        openTerminal();
        break;
      default:
        break;
    }
  };

  const pendingScheduledCount = scheduled.filter((item) => item.status === 'pending').length;
  const bookmarkActions: PaletteAction[] = bookmarks.map((mark) => ({
    id: `open-bookmark-${encodeURIComponent(mark.url)}`,
    title: formatStr(av.palOpenBookmark, { title: mark.title }),
    hint: bookmarkHost(mark.url),
    keywords: ['bookmark', 'open bookmark', '북마크', '즐겨찾기', mark.title, mark.url],
    run: () => { openBookmark(mark.url); setPaletteOpen(false); },
  }));
  const paletteActions: PaletteAction[] = [
    { id: 'new', title: common.newThread, hint: 'Ctrl+N', keywords: ['new chat', 'new thread'], run: () => { newChat(); setView('thread'); setPaletteOpen(false); } },
    { id: 'scheduled-prompts', title: STRINGS[lang].shortcuts.nl06, hint: pendingScheduledCount > 0 ? formatStr(av.palSchedCount, { n: pendingScheduledCount }) : 'Ctrl+Alt+R', keywords: ['scheduled prompt', 'reservation', 'timer', 'schedule', '예약', '스케줄', '타이머'], run: () => { setScheduleListOpen(true); setPaletteOpen(false); } },
    { id: 'tune-model', title: av.palTune, keywords: ['tune model', 'model settings', 'reasoning', 'approval', '모델 변경', '추론', '권한'], run: () => { setView('thread'); setTuneSignal((signal) => signal + 1); setPaletteOpen(false); } },
    { id: 'export-active-transcript', title: av.palExportActive, keywords: ['export transcript', 'export conversation', 'markdown', '대화 내보내기', '내보내기'], run: () => { setPaletteOpen(false); void exportSessionTranscripts([activeId]); } },
    { id: 'focus-composer', title: av.palFocusComposer, keywords: ['focus composer', 'focus prompt', 'chat input', '메시지 입력', '프롬프트 입력'], run: () => {
      setView('thread');
      setPaletteOpen(false);
      scheduleAfterPaint(() => document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus());
    } },
    { id: 'reset-panel-sizes', title: av.palResetPanels, keywords: ['reset panel sizes', 'default panel width', 'reset layout', '패널 크기 초기화', '패널 너비 복원'], run: () => { setSideW(284); setChatRatio(0.45); setPaletteOpen(false); } },
    { id: 'search-sessions', title: av.palSearchSessions, hint: 'Ctrl+Alt+S', keywords: ['search sessions', 'find thread', '대화 검색', '스레드 검색'], run: () => { setSidebarVisible(true); setSessionSearchFocusRequest((request) => request + 1); setView('thread'); setPaletteOpen(false); } },
    ...(sessions.filter((session) => !session.archived).length > 1 ? [
      { id: 'previous-session', title: av.palPrevSession, keywords: ['previous session', 'recent chat', '이전 스레드', '최근 대화'], run: () => { switchRecentSession(-1); setPaletteOpen(false); } },
      { id: 'next-session', title: av.palNextSession, keywords: ['next session', 'recent chat', '다음 스레드', '최근 대화'], run: () => { switchRecentSession(1); setPaletteOpen(false); } },
    ] : []),
    ...sessionActions,
    ...projectActions,
    ...(closableUnpinnedTabIds.length ? [{
      id: 'close-unpinned-tabs',
      title: av.palCloseUnpinned,
      hint: formatStr(av.palTabsCount, { n: closableUnpinnedTabIds.length }),
      keywords: ['close unpinned tabs', 'close tabs', '고정하지 않은 탭 닫기', '탭 정리'],
      run: () => { setPaletteOpen(false); void closeTabs(closableUnpinnedTabIds); },
    }] : []),
    { id: 'quick-open', title: av.palQuickOpen, hint: 'Ctrl+P', keywords: ['quick open', 'recent files', '파일 검색'], run: () => { setQuickOpen(true); setPaletteOpen(false); } },
    ...bookmarkActions,
    ...recentlyClosedTabActions,
    { id: 'keyboard-shortcuts', title: av.palShortcuts, hint: 'Ctrl+Shift+/', keywords: ['keyboard shortcuts', 'shortcut reference', '단축키 도움말'], run: () => { setShortcutsOpen(true); setPaletteOpen(false); } },
    {
      id: 'reopen-closed-file',
      title: latestClosedPaneTab ? formatStr(av.palReopenClosed, { name: closedPaneTabName(latestClosedPaneTab) }) : av.palReopenClosedBare,
      hint: `Ctrl+Shift+T${latestClosedPaneTab ? ` · ${closedPaneTabKind(latestClosedPaneTab)}` : ''}`,
      keywords: ['reopen closed tab', 'undo close tab', '탭 복구', '최근 닫은 탭', latestClosedPaneTab ? closedPaneTabName(latestClosedPaneTab) : '', latestClosedPaneTab?.kind === 'file' ? latestClosedPaneTab.path : ''],
      run: () => { setPaletteOpen(false); reopenClosedFileRef.current(); },
    },
    { id: 'files', title: av.palExplorer, hint: 'Ctrl+Shift+E', keywords: ['explorer', 'file tree', '파일 목록'], run: () => { openFilesViewer(); setPaletteOpen(false); } },
    { id: 'find-in-files', title: av.palFindInFiles, hint: 'Ctrl+Shift+F', keywords: ['find in files', 'search in files', '코드 검색'], run: () => { openWorkspaceSearch(); setPaletteOpen(false); } },
    ...(activeEditableFileTab ? [{ id: 'go-to-line', title: av.palGotoLine, hint: 'Ctrl+G', keywords: ['go to line', 'navigate line', '줄 이동', '라인 이동'], run: () => { setGoToLineRequest((request) => request + 1); setPaletteOpen(false); setEditorVisible(true); } }] : []),
    ...(editorNavigation.index > 0 ? [{ id: 'editor-location-back', title: av.palLocBack, hint: 'Alt+←', keywords: ['back', 'previous location', 'navigation history', '이전 코드 위치', '뒤로 이동'], run: () => { setPaletteOpen(false); navigateEditorLocation(-1); } }] : []),
    ...(editorNavigation.index >= 0 && editorNavigation.index < editorNavigation.entries.length - 1 ? [{ id: 'editor-location-forward', title: av.palLocFwd, hint: 'Alt+→', keywords: ['forward', 'next location', 'navigation history', '다음 코드 위치', '앞으로 이동'], run: () => { setPaletteOpen(false); navigateEditorLocation(1); } }] : []),
    ...(activeEditableFileTab ? [{ id: 'go-to-symbol', title: av.palGotoSymbol, hint: 'Ctrl+Shift+O', keywords: ['go to symbol', 'outline', 'symbol navigation', '기호 찾기', '함수로 이동', '클래스로 이동'], run: () => { setPaletteOpen(false); setEditorVisible(true); scheduleAfterPaint(() => editorApiRef.current?.openSymbolPicker()); } }] : []),
    ...(activeEditableFileTab ? [
      { id: 'go-to-definition', title: av.palGotoDef, hint: 'F12', keywords: ['go to definition', 'navigate to definition', '정의로 이동', '선언으로 이동'], run: () => { setPaletteOpen(false); setView('thread'); setEditorVisible(true); scheduleAfterPaint(() => editorApiRef.current?.runCommand('editor.action.revealDefinition')); } },
      { id: 'peek-definition', title: av.palPeekDef, hint: 'Alt+F12', keywords: ['peek definition', 'inline definition', '정의 미리보기'], run: () => { setPaletteOpen(false); setView('thread'); setEditorVisible(true); scheduleAfterPaint(() => editorApiRef.current?.runCommand('editor.action.peekDefinition')); } },
      { id: 'find-references', title: av.palFindRefs, hint: 'Shift+F12', keywords: ['find references', 'go to references', '참조 찾기', '사용 위치 찾기'], run: () => { setPaletteOpen(false); setView('thread'); setEditorVisible(true); scheduleAfterPaint(() => editorApiRef.current?.runCommand('editor.action.goToReferences')); } },
      { id: 'go-to-type-definition', title: av.palGotoTypeDef, hint: 'Ctrl+F12', keywords: ['go to type definition', 'type definition', '형식 정의로 이동'], run: () => { setPaletteOpen(false); setView('thread'); setEditorVisible(true); scheduleAfterPaint(() => editorApiRef.current?.runCommand('editor.action.goToTypeDefinition')); } },
      { id: 'format-document', title: av.palFormatDoc, hint: 'Shift+Alt+F', keywords: ['format document', 'format code', '코드 정렬', '서식 정리'], run: () => { setPaletteOpen(false); setView('thread'); setEditorVisible(true); scheduleAfterPaint(() => editorApiRef.current?.runCommand('editor.action.formatDocument')); } },
      { id: 'format-selection', title: av.palFormatSel, hint: 'Ctrl+K Ctrl+F', keywords: ['format selection', 'format selected code', '선택 코드 정렬'], run: () => { setPaletteOpen(false); setView('thread'); setEditorVisible(true); scheduleAfterPaint(() => editorApiRef.current?.runCommand('editor.action.formatSelection')); } },
      { id: 'fold-all', title: av.palFoldAll, hint: 'Ctrl+K Ctrl+0', keywords: ['fold all', 'collapse all', '코드 접기', '모두 접기'], run: () => { setPaletteOpen(false); setView('thread'); setEditorVisible(true); scheduleAfterPaint(() => editorApiRef.current?.runCommand('editor.foldAll')); } },
      { id: 'unfold-all', title: av.palUnfoldAll, hint: 'Ctrl+K Ctrl+J', keywords: ['unfold all', 'expand all', '코드 펼치기', '모두 펼치기'], run: () => { setPaletteOpen(false); setView('thread'); setEditorVisible(true); scheduleAfterPaint(() => editorApiRef.current?.runCommand('editor.unfoldAll')); } },
    ] : []),
    ...(activeEditableFileTab ? [{ id: 'toggle-word-wrap', title: wordWrap ? av.palWrapOff : av.palWrapOn, hint: 'Alt+Z', keywords: ['word wrap', 'toggle wrap', '줄바꿈', '긴 줄'], run: () => { setWordWrap((enabled) => !enabled); setPaletteOpen(false); setEditorVisible(true); } }] : []),
    ...(activeEditableFileTab ? [{ id: 'editor-font-increase', title: av.palFontBigger, hint: 'Ctrl+=', keywords: ['font size', 'zoom in', '글자 크기 키우기'], run: () => { setEditorFontSize((size) => clamp(size + 1, 10, 24)); setPaletteOpen(false); } }] : []),
    ...(activeEditableFileTab ? [{ id: 'editor-font-decrease', title: av.palFontSmaller, hint: 'Ctrl+-', keywords: ['font size', 'zoom out', '글자 크기 줄이기'], run: () => { setEditorFontSize((size) => clamp(size - 1, 10, 24)); setPaletteOpen(false); } }] : []),
    ...(activeEditableFileTab && editorFontSize !== 13 ? [{ id: 'editor-font-reset', title: av.palFontReset, hint: 'Ctrl+0', keywords: ['font size', 'reset zoom', '글자 크기 초기화'], run: () => { setEditorFontSize(13); setPaletteOpen(false); } }] : []),
    ...tabSelectionActions,
    ...(activeEditableFileTab ? [{ id: 'save-current-file', title: av.palSaveFile, hint: 'Ctrl+S', keywords: ['save file', 'save current file', '파일 저장'], run: () => { setPaletteOpen(false); void saveFile(activeEditableFileTab.id); } }] : []),
    { id: 'save-all-files', title: av.palSaveAll, hint: 'Ctrl+Shift+S', keywords: ['save all', 'save files', '모두 저장'], run: () => { setPaletteOpen(false); void saveAllFiles(); } },
    ...(savedFileTabIds.length > 0 ? [{ id: 'close-saved-file-tabs', title: formatStr(av.palCloseSaved, { n: savedFileTabIds.length }), keywords: ['close saved files', 'close clean tabs', '저장된 탭 정리'], run: () => { setPaletteOpen(false); void closeTabs(savedFileTabIds); } }] : []),
    { id: 'close-all-tabs', title: av.palCloseAll, hint: 'Ctrl+Shift+W', keywords: ['close all tabs', 'close editors', '탭 모두 닫기'], run: () => { setPaletteOpen(false); void closeTabs(tabs.map((tab) => tab.id)); } },
    { id: 'next-tab', title: av.palNextTab, hint: 'Ctrl+PageDown', keywords: ['next tab', 'switch tab', '다음 편집기'], run: () => { switchPaneTab(1); setPaletteOpen(false); } },
    { id: 'previous-tab', title: av.palPrevTab, hint: 'Ctrl+PageUp', keywords: ['previous tab', 'switch tab', '이전 편집기'], run: () => { switchPaneTab(-1); setPaletteOpen(false); } },
    { id: 'move-tab-left', title: av.palMoveLeft, hint: 'Ctrl+Shift+PageUp', keywords: ['move tab left', 'reorder tab', '탭 순서'], run: () => { movePaneTab(-1); setPaletteOpen(false); } },
    { id: 'move-tab-right', title: av.palMoveRight, hint: 'Ctrl+Shift+PageDown', keywords: ['move tab right', 'reorder tab', '탭 순서'], run: () => { movePaneTab(1); setPaletteOpen(false); } },
    { id: 'folder', title: av.palOpenFolder, keywords: ['open folder', '프로젝트 열기'], run: () => { setPaletteOpen(false); void pickFolder(); } },
    { id: 'editor', title: editorVisible ? av.palHideEditor : av.palShowEditor, hint: 'Ctrl+Alt+E', keywords: ['editor', 'toggle editor'], run: () => { setView('thread'); setEditorVisible((v) => !v); setPaletteOpen(false); } },
    { id: 'browser', title: av.palOpenBrowser, keywords: ['open browser'], run: () => { openBrowser(); setPaletteOpen(false); } },
    { id: 'terminal', title: av.palNewTerm, hint: 'Ctrl+Shift+`', keywords: ['open terminal', 'new terminal', '터미널 열기'], run: () => { openTerminal(); setPaletteOpen(false); } },
    { id: 'usage', title: av.palUsage, keywords: ['usage', 'token usage'], run: () => { setView('usage'); setPaletteOpen(false); } },
    { id: 'settings', title: STRINGS[lang].shortcuts.nl16, hint: 'Ctrl+,', keywords: ['settings', 'preferences'], run: () => { setView('settings'); setPaletteOpen(false); } },
    { id: 'sidebar', title: sidebarVisible ? av.palHideSidebar : av.palShowSidebar, hint: 'Ctrl+B', keywords: ['toggle sidebar'], run: () => { setSidebarVisible((v) => !v); setPaletteOpen(false); } },
  ];
  // The native browser view paints above React UI — park it under overlays.
  const parkBrowser = shouldParkBrowserForOverlays({
    palette: paletteOpen,
    quickOpen,
    shortcuts: shortcutsOpen,
    confirm: confirmRequest,
    scheduleDraft,
    scheduleList: scheduleListOpen,
    scheduleEdit: editingSchedule,
  });

  return (
    <LangContext.Provider value={lang}>
    <div className="app">
      {sidebarVisible && (
        <>
        <Sidebar
          sessions={sessions}
          draftSessionIds={draftSessionIds}
          queuedSessionCounts={queuedSessionCounts}
          activeId={active?.id ?? ''}
          groupBy={groupBy}
          runningIds={runningIds}
          unreadIds={unreadIds}
          onStopSession={stopSession}
          hostSessions={hostSessions}
          resumingId={resumingId}
          sessionSearchFocusRequest={sessionSearchFocusRequest}
          onResume={resumeHostSession}
          onDeleteHostSession={deleteHostSession}
          width={sideW}
          msp={mspStatus}
          cliStatus={cliStatus}
          onNew={() => { newChat(); setView('thread'); }}
          onSelect={gotoThread}
          onDelete={deleteSession}
          onTogglePinned={toggleSessionPinned}
          onTogglePinnedMany={toggleSessionsPinned}
          onToggleArchivedMany={toggleSessionsArchived}
          onDeleteMany={deleteSessions}
          onExportMany={exportSessionTranscripts}
          onBackupMany={backupSessions}
          onImport={() => { void importSessions(); }}
          onToggleArchived={toggleSessionArchived}
          onRename={renameSession}
          onCollapse={() => setSidebarVisible(false)}
          onOpenSettings={() => setView('settings')}
          onOpenCodex={openCodex}
          onOpenClaude={openClaude}
          onOpenFiles={openFilesViewer}
          projects={projects}
          pinnedProjects={pinnedProjects}
          onToggleProjectPinned={(project) => setPinnedProjects((previous) => togglePinnedProject(previous, project))}
          activeFolder={folder}
          onAddProject={() => { void pickFolder(); }}
          onSelectProject={switchProjectFolder}
          onRemoveProject={removeProjectFolder}
          onNewSessionInFolder={newChatInFolder}
        />
        <div
          className="drag-v"
          title={av.dragSidebarTitle}
          role="separator"
          aria-orientation="vertical"
          aria-label={av.dragSidebarLabel}
          aria-valuemin={200}
          aria-valuemax={480}
          aria-valuenow={sideW}
          aria-valuetext={formatStr(av.dragPx, { w: sideW })}
          tabIndex={0}
          onMouseDown={(e) => {
            const s = sideW;
            beginDrag(e, (dx) => setSideW(clamp(Math.round(s + dx), 200, 480)));
          }}
          onDoubleClick={() => setSideW(284)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              setSideW((width) => clamp(width + (event.key === 'ArrowRight' ? 16 : -16), 200, 480));
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              setSideW(event.key === 'Home' ? 200 : 480);
            }
          }}
        />
        </>
      )}
      <main className="main">
        {!sidebarVisible && (
          <button className="expand-btn" onClick={() => setSidebarVisible(true)} title={av.expandSidebarTitle}>
            <SidebarIcon size={16} />
          </button>
        )}
        {view === 'usage' && (
          <UsageView sessions={sessions} folder={folder} onBack={() => setView('thread')} onSelectThread={gotoThread} />
        )}
        {view === 'settings' && (
          <SettingsView
            settings={settings}
            cliStatus={cliStatus}
            cliResolved={cliResolved}
            folder={folder}
            groupBy={groupBy}
            onGroupBy={setGroupBy}
            onSave={persistSettings}
            onBack={() => setView('thread')}
          />
        )}
        <div ref={wrapRef} className={`thread-wrap${view === 'thread' ? '' : ' hidden'}${editorVisible ? ' with-editor' : ''}`}>
        {sessions.filter((s) => s.id === activeId || runningIds.includes(s.id)).map((s) => (
          <ChatView
            key={s.id}
            session={s}
            isActiveSession={s.id === activeId}
            paneActive={view === 'thread' && s.id === activeId}
            settings={settings}
            cliResolved={cliResolved}
            cliStatus={cliStatus}
            folder={folder}
            editorVisible={editorVisible}
            onToggleEditor={() => setEditorVisible((v) => !v)}
            onAppendUser={(msg) => appendUser(s.id, msg)}
            onAppendAssistant={(msg) => appendAssistant(s.id, msg)}
            onTitleMaybe={(firstPrompt) => titleMaybe(s.id, firstPrompt)}
            onInsertToEditor={insertToEditor}
            onOpenSettings={() => setView('settings')}
            onOpenGitDiff={openGitDiff}
            onOpenFileAtLine={openFileAtLine}
            onConfirm={requestConfirm}
            onRunningChange={(r) => setRunningIds((prev) => r ? (prev.includes(s.id) ? prev : [...prev, s.id]) : prev.filter((id) => id !== s.id))}
            onRegisterStop={(stop) => stopRegistryRef.current.register(s.id, stop)}
            onMspSession={(mspSessionId, engine) => linkMsp(s.id, mspSessionId, engine)}
            onPatchSettings={patchSettings}
            onSessionOverride={(patch) => setSessions((prev) => prev.map((row) => row.id === s.id ? { ...row, ...patch } : row))}
            onForkSession={(messageId) => forkSessionFrom(s.id, messageId)}
            onUpdateMessage={(msgId, patch) => patchMessage(s.id, msgId, patch)}
            onDraftStatus={updateDraftSessionStatus}
            onQueueStatus={updateQueuedSessionCount}
            onSchedulePrompt={(text) => setScheduleDraft({ sessionId: s.id, text })}
            scheduledFire={scheduledFire && scheduledFire.sessionId === s.id ? scheduledFire : null}
            onScheduledConsumed={(nonce) => {
              const firing = scheduledFiringRef.current;
              if (firing && firing.sessionId === s.id && firing.nonce === nonce) {
                setScheduled((prev) => {
                  const item = prev.find((row) => row.id === firing.id);
                  if (item && item.repeat !== 'once') return rollRepeatingPrompt(prev, firing.id, Date.now());
                  return markScheduledPrompt(prev, firing.id, 'fired');
                });
                scheduledFiringRef.current = null;
                setScheduledFire(null);
              }
            }}
            onSlashCommand={(id) => runSlashCommand(s.id, id)}
            codexSignal={s.id === activeId ? codexSignal : 0}
            claudeSignal={s.id === activeId ? claudeSignal : 0}
            tuneSignal={s.id === activeId ? tuneSignal : 0}
            tokenWin={tokenWin}
            quota={quota}
            paneStyle={s.id !== activeId ? { display: 'none' } : editorVisible ? { flex: `0 0 ${Math.round(chatRatio * 1000) / 10}%`, minWidth: 340 } : undefined}
          />
        ))}
        {editorVisible && (
          <>
          <div
            className="drag-v"
            title={av.dragChatTitle}
            role="separator"
            aria-orientation="vertical"
            aria-label={av.dragChatLabel}
            aria-valuemin={Math.round(getChatRatioBounds().min * 100)}
            aria-valuemax={Math.round(getChatRatioBounds().max * 100)}
            aria-valuenow={Math.round(chatRatio * 100)}
            aria-valuetext={formatStr(av.dragPct, { p: Math.round(chatRatio * 100) })}
            tabIndex={0}
            onMouseDown={(e) => {
              const s = chatRatio;
              const w = wrapRef.current?.getBoundingClientRect().width || 800;
              const { min, max } = getChatRatioBounds();
              beginDrag(e, (dx) => setChatRatio(clamp(s + dx / w, min, max)));
            }}
            onDoubleClick={() => setChatRatio(0.45)}
            onKeyDown={(event) => {
              const { min, max } = getChatRatioBounds();
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const change = event.key === 'ArrowRight' ? 0.02 : -0.02;
                setChatRatio((ratio) => clamp(ratio + change, min, max));
              } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                setChatRatio(event.key === 'Home' ? min : max);
              }
            }}
          />
          <RightPane
            tabs={tabs}
            activeId={activeTabId}
            monacoTheme={monacoTheme}
            dark={dark}
            folder={folder}
            treeVersion={treeVersion}
            onRefreshTree={() => setTreeVersion((v) => v + 1)}
            changedFiles={changed}
            changedKinds={changedKinds}
            changedStaged={changedStaged}
            recentFiles={recentFiles}
            home={settings.browserHome}
            agentEnabled={settings.browserAgent}
            paneActive={view === 'thread'}
            editorApiRef={editorApiRef}
            goToLineRequest={goToLineRequest}
            onRequestGoToLine={() => setGoToLineRequest((request) => request + 1)}
            wordWrap={wordWrap}
            editorFontSize={editorFontSize}
            onToggleWordWrap={() => setWordWrap((enabled) => !enabled)}
            onChangeEditorFontSize={(delta) => setEditorFontSize((size) => clamp(size + delta, 10, 24))}
            onSelectTab={setActiveTabId}
            onBackToChat={() => setEditorVisible(false)}
            onReorderTabs={reorderTabs}
            onToggleTabPinned={toggleTabPinned}
            onSwitchTab={(mode) => {
              if (mode === 'recent-next') switchRecentPaneTab(1);
              else if (mode === 'recent-previous') switchRecentPaneTab(-1);
              else switchPaneTab(mode === 'ordered-right' ? 1 : -1);
            }}
            onCloseTab={closeTab}
            onCloseTabs={closeTabs}
            onNewTab={newPaneTab}
            onPickFileTab={pickFileTab}
            onFileChange={changeFile}
            onFileSave={saveFile}
            onOpenFileExternal={openFileExternally}
            onSaveAllFiles={() => { void saveAllFiles(); }}
            savingAllFiles={savingAllFiles}
            onReloadFile={reloadFile}
            onFileToggleDiff={toggleDiff}
            onSearchSelection={openWorkspaceSearch}
            onCursorLocationChange={onEditorCursorLocationChange}
            canNavigateEditorBack={editorNavigation.index > 0}
            canNavigateEditorForward={editorNavigation.index >= 0 && editorNavigation.index < editorNavigation.entries.length - 1}
            editorNavigationEntries={editorNavigation.entries}
            editorNavigationIndex={editorNavigation.index}
            editorNavigationBookmarks={editorNavigation.bookmarks}
            onNavigateEditorToLocation={navigateEditorToLocation}
            onToggleEditorLocationBookmark={toggleEditorLocationBookmark}
            onNavigateEditorBack={() => { navigateEditorLocation(-1); }}
            onNavigateEditorForward={() => { navigateEditorLocation(1); }}
            onOpenFile={openFile}
            onOpenFileAtLine={(filePath, line, pinned) => { void openFileAtLine(filePath, line, 1, pinned); }}
            fileSearchMode={fileSearchMode}
            fileSearchFocusRequest={fileSearchFocusRequest}
            fileSearchQuery={fileSearchQuery}
            onSearchModeChange={setFileSearchMode}
            onOpenChanged={(f) => openGitDiff(f, folder)}
            onRefreshChanged={refreshChanged}
            onCommitFiles={commitGitFiles}
            onPickFolder={pickFolder}
            onOpenTerminalAt={openTerminalAt}
            onRenameEntry={renameExplorerEntry}
            onDeleteEntry={deleteExplorerEntry}
            onBrowserTitle={browserTitle}
            onBrowserUrl={browserUrl}
            parkBrowser={parkBrowser}
            bookmarks={bookmarks}
            onToggleBookmark={toggleBookmark}
            onBrowserAppShortcut={(shortcut: BrowserShortcut) => {
              if (shortcut === 'quick-open') { setPaletteOpen(false); setQuickOpen(true); }
              else if (shortcut === 'command-palette') { setQuickOpen(false); setPaletteOpen(true); }
              else if (shortcut === 'open-explorer') openFilesViewerRef.current?.();
              else if (shortcut === 'toggle-sidebar') setSidebarVisible((visible) => !visible);
              else if (shortcut === 'toggle-editor') { setView('thread'); setEditorVisible((visible) => !visible); }
              else if (shortcut === 'open-settings') { setPaletteOpen(false); setQuickOpen(false); setView('settings'); }
              else if (shortcut === 'reopen-closed-file') reopenClosedFileRef.current();
              else if (shortcut === 'find-in-files') {
                openWorkspaceSearchRef.current?.();
              } else if (shortcut.startsWith('select-tab-')) {
                const currentTabs = latestTabsRef.current;
                const requested = Number(shortcut.slice('select-tab-'.length));
                const targetTab = currentTabs[requested === 9 ? currentTabs.length - 1 : requested - 1];
                if (targetTab) {
                  latestActiveTabRef.current = targetTab.id;
                  setActiveTabId(targetTab.id);
                  setView('thread');
                  setEditorVisible(true);
                }
              }
            }}
            onTermShell={termShell}
            onNotice={notify}
          />
          </>
        )}
        </div>
      </main>
      {paletteOpen && (
        <Palette
          sessions={sessions}
          actions={paletteActions}
          onSelectThread={gotoThread}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {quickOpen && (
        <QuickOpen
          cwd={folder}
          treeVersion={treeVersion}
          recentFiles={recentFiles}
          openFiles={tabs.flatMap((tab) => tab.kind === 'file' && tab.file ? [{ path: tab.file.path, dirty: !!tab.file.dirty, active: tab.id === activeTabId, diskState: tab.file.diskState }] : [])}
          onOpen={openQuickFile}
          onClose={() => setQuickOpen(false)}
        />
      )}
      {shortcutsOpen && <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {confirmRequest && <ConfirmDialog
        {...confirmRequest}
        onResolve={resolveConfirm}
      />}
      {scheduleDraft && (
        <SchedulePromptDialog
          draft={scheduleDraft.text.trim()}
          sessionTitle={sessions.find((session) => session.id === scheduleDraft.sessionId)?.title || av.threadFallback}
          onSchedule={(fireAt, repeat) => {
            const item = createScheduledPrompt({ sessionId: scheduleDraft.sessionId, text: scheduleDraft.text, fireAt, repeat });
            if (!item) {
              setNotice(av.schedInvalid);
              return;
            }
            const next = addScheduledPrompt(scheduledRef.current, item);
            if (next.every((row) => row.id !== item.id)) {
              setNotice(av.schedFull);
              return;
            }
            setScheduled(next);
            setScheduleDraft(null);
            setNotice(formatStr(av.schedCreated, {
              time: formatScheduledFireTime(item.fireAt, Date.now(), lang),
              suffix: item.repeat === 'once' ? av.schedOnceSuffix : formatStr(av.schedRepeatSuffix, { repeat: formatRepeat(item.repeat, lang) }),
            }));
          }}
          onClose={() => setScheduleDraft(null)}
        />
      )}
      {scheduleListOpen && (
        <ScheduledPromptListDialog
          items={scheduled}
          sessionTitleOf={(id) => sessions.find((session) => session.id === id)?.title || av.schedDeletedThread}
          onCancel={(id) => setScheduled((prev) => cancelScheduledPrompt(prev, id))}
          onFireNow={fireScheduledNow}
          onEdit={(id) => {
            const item = scheduledRef.current.find((row) => row.id === id && row.status === 'pending');
            if (item) setEditingSchedule(item);
          }}
          onClose={() => setScheduleListOpen(false)}
        />
      )}
      {editingSchedule && (
        <SchedulePromptDialog
          mode="edit"
          draft={editingSchedule.text}
          sessionTitle={sessions.find((session) => session.id === editingSchedule.sessionId)?.title || av.threadFallback}
          initialFireAt={editingSchedule.fireAt}
          initialRepeat={editingSchedule.repeat}
          onSchedule={(fireAt, repeat, text) => {
            const target = editingSchedule;
            const live = scheduledRef.current.find((row) => row.id === target.id && row.status === 'pending');
            if (!live) {
              setEditingSchedule(null);
              setNotice(av.schedGone);
              return;
            }
            setScheduled(rescheduleScheduledPrompt(scheduledRef.current, target.id, { fireAt, repeat, text }));
            setEditingSchedule(null);
            setNotice(formatStr(av.schedUpdated, {
              time: formatScheduledFireTime(fireAt, Date.now(), lang),
              suffix: repeat === 'once' ? av.schedOnceSuffix : formatStr(av.schedRepeatSuffix, { repeat: formatRepeat(repeat, lang) }),
            }));
          }}
          onClose={() => setEditingSchedule(null)}
        />
      )}
      {notice && (
        <div className={noticeKind === 'git' ? 'toast toast-git' : 'toast'} role="alert">
          <span>{notice}</span>
          <button className="icon-btn" onClick={() => { setNotice(''); setNoticeKind(''); }} title={common.close}>
            <XIcon size={14} />
          </button>
        </div>
      )}
    </div>
    </LangContext.Provider>
  );
}
