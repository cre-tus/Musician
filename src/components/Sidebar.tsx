import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CliStatus, HostSession, MspStatus, Session } from '../types';
import { timeAgo } from '../lib/mudex';
import { parseSidebarGroupState, toggleSidebarGroup } from '../lib/sidebar-group-state.mjs';
import { adjacentSessionIndex } from '../lib/sidebar-session-navigation.mjs';
import { compareSidebarSessions, readSidebarSessionSort, writeSidebarSessionSort } from '../lib/sidebar-session-sort.mjs';
import { fuzzyMatchIndexes, scoreSidebarSession } from '../lib/sidebar-session-search.mjs';
import { matchesSidebarSessionQuery, parseSidebarSessionQuery } from '../lib/sidebar-session-query.mjs';
import { countSidebarSessionFilters, filterSidebarSessions, isSidebarSessionFailed, readSidebarSessionFilter, writeSidebarSessionFilter } from '../lib/sidebar-session-filter.mjs';
import { allVisibleSidebarSessionsSelected, selectSidebarSessionRange, selectVisibleSidebarSessions, toggleSidebarSessionSelection, visibleSidebarSessionSelection } from '../lib/sidebar-session-selection.mjs';
import { normalizePathForComparison } from '../lib/path-utils.mjs';
import { filterHostSessions } from '../lib/host-session-filter.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import {
  ArchiveIcon,
  ChatIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExplorerIcon,
  ExportIcon,
  FolderIcon,
  GuitarIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
  SlidersIcon,
  StarIcon,
  TrashIcon,
  UnarchiveIcon,
  XIcon,
} from './icons';

interface Props {
  sessions: Session[];
  draftSessionIds: string[];
  queuedSessionCounts: Record<string, number>;
  activeId: string;
  groupBy: 'project' | 'status';
  runningIds: string[];
  cliStatus: CliStatus;
  hostSessions: HostSession[];
  resumingId: string | null;
  sessionSearchFocusRequest: number;
  width?: number;
  msp: MspStatus;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePinned: (id: string) => void;
  onTogglePinnedMany: (ids: string[]) => void;
  onToggleArchivedMany: (ids: string[]) => void;
  onDeleteMany: (ids: string[]) => Promise<boolean>;
  onExportMany: (ids: string[]) => Promise<boolean>;
  onToggleArchived: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onResume: (hostSessionId: string) => void;
  onDeleteHostSession: (hostSessionId: string) => void;
  onCollapse: () => void;
  onOpenSettings: () => void;
  onOpenCodex: () => void;
  onOpenFiles: () => void;
  projects: string[];
  pinnedProjects: string[];
  onToggleProjectPinned: (projectPath: string) => void;
  activeFolder: string;
  onAddProject: () => void;
  onSelectProject: (folder: string) => void;
  onRemoveProject: (folder: string) => void;
  onNewSessionInFolder: (folder: string) => void;
}

function baseName(p: string): string {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
}

function compactProjectPath(p: string): string {
  return String(p || '').split(/[\\/]/).filter(Boolean).slice(-2).join('/');
}

function lastTs(s: Session): number {
  const last = s.messages[s.messages.length - 1];
  return last ? last.ts : s.createdAt;
}

function sessionSearchRank(s: Session, query: string): number {
  const q = query.toLowerCase();
  if (s.title.toLowerCase().includes(q)) return 0;
  if ((s.cwd || '').toLowerCase().includes(q)) return 1;
  return s.messages.some((message) => message.text.toLowerCase().includes(q)) ? 2 : 3;
}

interface Group {
  key: string;
  title: string;
  sub?: string;
  items: Session[];
}

function highlightSidebarText(value: string, query: string): React.ReactNode {
  const chars = Array.from(value);
  const matched = new Set(fuzzyMatchIndexes(value, query));
  if (!matched.size) return value;
  const parts: React.ReactNode[] = [];
  let start = 0;
  while (start < chars.length) {
    const isMatch = matched.has(start);
    let end = start + 1;
    while (end < chars.length && matched.has(end) === isMatch) end += 1;
    const text = chars.slice(start, end).join('');
    parts.push(isMatch ? <mark className="sidebar-search-highlight" key={start}>{text}</mark> : <React.Fragment key={start}>{text}</React.Fragment>);
    start = end;
  }
  return parts;
}

export default function Sidebar(props: Props) {
  const draftSessionIdSet = useMemo(() => new Set(props.draftSessionIds), [props.draftSessionIds]);
  const [query, setQuery] = useState('');
  const [queryHelpOpen, setQueryHelpOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<'all' | 'pinned' | 'running' | 'failed' | 'draft' | 'queued'>(() => readSidebarSessionFilter());
  const [sessionSort, setSessionSort] = useState<'recent' | 'oldest' | 'name'>(() => readSidebarSessionSort());
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [openGroupsByMode, setOpenGroupsByMode] = useState<Record<'project' | 'status', Record<string, boolean>>>(() => {
    const read = (mode: 'project' | 'status') => {
      try { return parseSidebarGroupState(localStorage.getItem(`mudex:sidebar-groups:v1:${mode}`) || '{}'); } catch { return {}; }
    };
    return { project: read('project'), status: read('status') };
  });
  const openGroups = openGroupsByMode[props.groupBy];
  const [archiveOpen, setArchiveOpen] = useState(() => {
    try { return localStorage.getItem('mudex:sidebar-archive-open:v1') === 'true'; } catch { return false; }
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [hostQuery, setHostQuery] = useState('');
  const visibleHostSessions = useMemo(
    () => filterHostSessions(props.hostSessions, hostQuery, []),
    [props.hostSessions, hostQuery],
  );
  const sessionSearchRef = useRef<HTMLInputElement | null>(null);
  const sessionSearchShellRef = useRef<HTMLDivElement | null>(null);
  const cancelRenameRef = useRef(false);
  const { sessions, activeId, groupBy, runningIds, cliStatus } = props;
  const mspState = props.msp?.state || 'idle';
  const cliText =
    cliStatus === 'ok'
      ? 'Muse 준비됨'
      : cliStatus === 'missing'
        ? 'CLI 없음'
        : cliStatus === 'checking'
          ? '확인 중…'
          : cliStatus === 'error'
            ? 'CLI 오류'
            : '미확인';
  const cliDot =
    cliStatus === 'ok'
      ? 's-dot ok'
      : cliStatus === 'missing' || cliStatus === 'error'
        ? 's-dot bad'
        : cliStatus === 'checking'
          ? 's-dot busy'
          : 's-dot';
  const profileSub =
    mspState === 'warming'
      ? `${cliText} · MSP 연결 중…`
      : mspState === 'error'
        ? `${cliText} · MSP 실패`
        : mspState === 'ok'
          ? `${cliText} · MSP 연결됨`
          : cliText;
  const [profileOpen, setProfileOpen] = useState(false);
  const profileDialogRef = useRef<HTMLElement | null>(null);
  const profileReturnFocusRef = useRef<HTMLElement | null>(null);

  const focusSeenRef = useRef(props.sessionSearchFocusRequest);
  useEffect(() => {
    if (props.sessionSearchFocusRequest === focusSeenRef.current) return; // mount: don't steal focus
    focusSeenRef.current = props.sessionSearchFocusRequest;
    if (props.sessionSearchFocusRequest > 0) sessionSearchRef.current?.focus();
  }, [props.sessionSearchFocusRequest]);

  useEffect(() => {
    if (!queryHelpOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !sessionSearchShellRef.current?.contains(event.target)) setQueryHelpOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [queryHelpOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('mudex:sidebar-groups:v1:project', JSON.stringify(openGroupsByMode.project));
      localStorage.setItem('mudex:sidebar-groups:v1:status', JSON.stringify(openGroupsByMode.status));
    } catch { /* Sidebar layout is a convenience preference. */ }
  }, [openGroupsByMode]);

  useEffect(() => {
    try { localStorage.setItem('mudex:sidebar-archive-open:v1', String(archiveOpen)); } catch { /* preference only */ }
  }, [archiveOpen]);

  useEffect(() => writeSidebarSessionSort(sessionSort), [sessionSort]);
  useEffect(() => writeSidebarSessionFilter(sessionFilter), [sessionFilter]);

  useEffect(() => {
    if (!profileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setProfileOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [profileOpen]);

  useEffect(() => {
    if (!profileOpen) {
      const returnTarget = profileReturnFocusRef.current;
      profileReturnFocusRef.current = null;
      if (returnTarget?.isConnected) scheduleAfterPaint(() => returnTarget.focus({ preventScroll: true }));
      return;
    }
    profileReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return scheduleAfterPaint(() => {
      const firstControl = profileDialogRef.current?.querySelector<HTMLElement>('button:not(:disabled)');
      (firstControl || profileDialogRef.current)?.focus({ preventScroll: true });
    });
  }, [profileOpen]);

  const parsedQuery = useMemo(() => parseSidebarSessionQuery(query), [query]);
  const q = parsedQuery.text.toLowerCase();
  const hasQuery = !!query.trim();
  const queuedSessionIds = useMemo(() => Object.keys(props.queuedSessionCounts).filter((id) => props.queuedSessionCounts[id] > 0), [props.queuedSessionCounts]);
  const failedSessionIds = useMemo(() => sessions.filter(isSidebarSessionFailed).map((session) => session.id), [sessions]);
  const queryState = useMemo(() => ({ runningIds, failedIds: failedSessionIds, draftIds: props.draftSessionIds, queuedIds: queuedSessionIds }), [runningIds, failedSessionIds, props.draftSessionIds, queuedSessionIds]);
  const sessionSearchScores = useMemo(
    () => new Map(sessions.map((session) => [session.id, q ? scoreSidebarSession(session, q) : 0])),
    [sessions, q],
  );
  const filtered = useMemo(
    () => sessions.filter((session) => (sessionSearchScores.get(session.id) ?? -1) >= 0
      && matchesSidebarSessionQuery(session, parsedQuery.filters, queryState)),
    [sessions, sessionSearchScores, parsedQuery.filters, queryState],
  );
  const matchingActiveSessions = useMemo(() => filtered.filter((s) => !s.archived), [filtered]);
  const sessionFilterCounts = useMemo(() => countSidebarSessionFilters(matchingActiveSessions, runningIds, props.draftSessionIds, queuedSessionIds), [matchingActiveSessions, runningIds, props.draftSessionIds, queuedSessionIds]);
  const activeFiltered = useMemo(
    () => filterSidebarSessions(matchingActiveSessions, sessionFilter, runningIds, props.draftSessionIds, queuedSessionIds),
    [matchingActiveSessions, sessionFilter, runningIds, props.draftSessionIds, queuedSessionIds],
  );
  const archivedItems = useMemo(
    () => filtered.filter((s) => s.archived).sort((a, b) => (q ? (sessionSearchScores.get(b.id) || 0) - (sessionSearchScores.get(a.id) || 0) : 0)
      || Number(!!b.pinned) - Number(!!a.pinned) || compareSidebarSessions(a, b, sessionSort)),
    [filtered, sessionSort, q, sessionSearchScores],
  );
  const visibleSessionIds = useMemo(() => [
    ...activeFiltered.map((session) => session.id),
    ...(selectionMode && (hasQuery || archiveOpen) ? archivedItems.map((session) => session.id) : []),
  ], [activeFiltered, archivedItems, archiveOpen, hasQuery, selectionMode]);
  const selectedVisibleIds = useMemo(
    () => visibleSidebarSessionSelection(selectedSessionIds, visibleSessionIds),
    [selectedSessionIds, visibleSessionIds],
  );
  const allVisibleSelected = allVisibleSidebarSessionsSelected(selectedSessionIds, visibleSessionIds);
  const selectedAllPinned = selectedVisibleIds.length > 0
    && selectedVisibleIds.every((id) => [...activeFiltered, ...archivedItems].find((session) => session.id === id)?.pinned);
  const selectedAllArchived = selectedVisibleIds.length > 0
    && selectedVisibleIds.every((id) => archivedItems.some((session) => session.id === id));
  const selectedContainsRunning = selectedVisibleIds.some((id) => runningIds.includes(id));

  useEffect(() => {
    setSelectedSessionIds([]);
    selectionAnchorRef.current = null;
  }, [query, sessionFilter]);

  const selectSession = (sessionId: string, extendRange = false) => {
    const anchorId = selectionAnchorRef.current;
    if (extendRange && anchorId) {
      const renderedIds = Array.from(document.querySelectorAll<HTMLElement>('.sidebar .thread-row[data-session-id]'))
        .map((row) => row.dataset.sessionId || '').filter(Boolean);
      setSelectedSessionIds((previous) => selectSidebarSessionRange(previous, renderedIds, anchorId, sessionId));
      return;
    }
    selectionAnchorRef.current = sessionId;
    setSelectedSessionIds((previous) => toggleSidebarSessionSelection(previous, sessionId));
  };
  const addSearchToken = (token: string) => {
    const input = sessionSearchRef.current;
    const start = input?.selectionStart ?? query.length;
    const end = input?.selectionEnd ?? query.length;
    const prefix = query.slice(0, start);
    const suffix = query.slice(end);
    const spacer = prefix && !/\s$/.test(prefix) ? ' ' : '';
    const suffixSpacer = suffix && !/^\s/.test(suffix) ? ' ' : '';
    const next = `${prefix}${spacer}${token}${suffixSpacer}${suffix}`;
    const cursor = prefix.length + spacer.length + token.length + suffixSpacer.length;
    setQuery(next);
    setQueryHelpOpen(false);
    scheduleAfterPaint(() => {
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
  };

  const startRename = (s: Session) => {
    cancelRenameRef.current = false;
    setEditingId(s.id);
    setEditTitle(s.title);
  };
  const finishRename = () => {
    if (!cancelRenameRef.current && editingId) props.onRename(editingId, editTitle);
    cancelRenameRef.current = false;
    setEditingId(null);
  };
  const sessionTitleSelector = '.sidebar .side-groups .thread-row:not(.host) button.thread-title, .sidebar .archive-list .thread-title';
  const handleSessionTitleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, session: Session | null) => {
    if (event.key === 'F2' && session) {
      event.preventDefault();
      startRename(session);
      return;
    }
    const buttons = Array.from(document.querySelectorAll<HTMLElement>(sessionTitleSelector));
    const nextIndex = adjacentSessionIndex(buttons.indexOf(event.currentTarget), buttons.length, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    const next = buttons[nextIndex];
    const targetId = next?.closest<HTMLElement>('.thread-row')?.dataset.sessionId;
    next?.focus();
    if (selectionMode && event.shiftKey && targetId && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      selectSession(targetId, true);
    }
  };

  const pinnedProjectKeys = useMemo(
    () => new Set(props.pinnedProjects.map((path) => normalizePathForComparison(path))),
    [props.pinnedProjects],
  );
  const isProjectPinned = (path?: string) => !!path && pinnedProjectKeys.has(normalizePathForComparison(path));
  const groups: Group[] = useMemo(() => {
    if (groupBy === 'status') {
      const byPreference = (a: Session, b: Session) => (q ? (sessionSearchScores.get(b.id) || 0) - (sessionSearchScores.get(a.id) || 0) : 0)
        || Number(!!b.pinned) - Number(!!a.pinned) || compareSidebarSessions(a, b, sessionSort);
      const running = activeFiltered.filter((s) => runningIds.includes(s.id)).sort(byPreference);
      const failed = activeFiltered.filter((s) => !runningIds.includes(s.id) && isSidebarSessionFailed(s)).sort(byPreference);
      const rest = activeFiltered.filter((s) => !runningIds.includes(s.id) && !isSidebarSessionFailed(s)).sort(byPreference);
      return [
        { key: 'st-running', title: '실행 중', items: running },
        { key: 'st-failed', title: '실패', items: failed },
        { key: 'st-rest', title: '나머지', items: rest },
      ].filter((g) => g.items.length > 0);
    }
    const map = new Map<string, Session[]>();
    for (const s of activeFiltered) {
      const k = s.cwd || '';
      if (!map.has(k)) map.set(k, []);
      map.get(k)?.push(s);
    }
    // Registered project folders show up even before their first session.
    for (const p of props.projects) {
      if (p && !map.has(p)) map.set(p, []);
    }
    const entries = [...map.entries()];
    entries.sort((a, b) => Number(isProjectPinned(b[0])) - Number(isProjectPinned(a[0]))
      || Math.max(...b[1].map(lastTs)) - Math.max(...a[1].map(lastTs)));
    return entries.map(([cwd, items]) => {
      const sorted = [...items].sort((a, b) => {
        const pinnedOrder = Number(!!b.pinned) - Number(!!a.pinned);
        const ar = runningIds.includes(a.id) ? 1 : 0;
        const br = runningIds.includes(b.id) ? 1 : 0;
        return (q ? (sessionSearchScores.get(b.id) || 0) - (sessionSearchScores.get(a.id) || 0) : 0)
          || pinnedOrder || br - ar || compareSidebarSessions(a, b, sessionSort);
      });
      return { key: cwd || '(none)', title: cwd ? baseName(cwd) : '폴더 없음', sub: cwd || undefined, items: sorted };
    });
  }, [activeFiltered, groupBy, pinnedProjectKeys, runningIds, props.projects, sessionSort, q, sessionSearchScores]);

  const toggleGroup = (key: string) => setOpenGroupsByMode((previous) => ({
    ...previous,
    [groupBy]: toggleSidebarGroup(previous[groupBy], key),
  }));

  return (
    <aside
      className={selectionMode ? 'sidebar selecting-sessions' : 'sidebar'}
      style={props.width ? { width: props.width } : undefined}
      aria-keyshortcuts={selectionMode ? 'Control+A Meta+A Escape' : undefined}
      onKeyDown={(event) => {
        if (!selectionMode) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          setSelectedSessionIds((previous) => selectVisibleSidebarSessions(previous, visibleSessionIds, true));
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setSelectedSessionIds([]);
          setSelectionMode(false);
        }
      }}
    >
      <div className="brand">
        <span className="brand-mark guitar" aria-hidden>
          <GuitarIcon size={24} />
        </span>
        <span className="brand-name">Musician</span>
        <button type="button" className="icon-btn brand-collapse" onClick={props.onCollapse} title="사이드바 숨기기 (Ctrl+B)" aria-label="사이드바 숨기기">
          <SidebarIcon size={16} />
        </button>
      </div>

      <div className="side-actions">
        <button className="side-action" onClick={props.onOpenFiles} title="파일 탐색기 열기 (Ctrl+Shift+E)">
          <ExplorerIcon size={15} /> 파일 탐색기
        </button>
        <button className="side-action" onClick={props.onNew} title="새 스레드 (Ctrl+N)" aria-keyshortcuts="Control+N Meta+N">
          <PencilIcon size={15} /> 새 스레드
        </button>
        <div className="side-search-wrap" ref={sessionSearchShellRef} onKeyDown={(event) => {
          if (event.key === 'Escape' && queryHelpOpen) {
            event.preventDefault();
            setQueryHelpOpen(false);
            sessionSearchRef.current?.focus();
          }
        }}>
          <div className="side-search">
            <SearchIcon size={14} />
            <input
            ref={sessionSearchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && queryHelpOpen) {
                e.preventDefault();
                setQueryHelpOpen(false);
              } else if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
              } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hasQuery) {
                const buttons = Array.from(document.querySelectorAll<HTMLElement>(sessionTitleSelector));
                const nextIndex = adjacentSessionIndex(e.key === 'ArrowDown' ? -1 : buttons.length, buttons.length, e.key);
                if (nextIndex !== null) {
                  e.preventDefault();
                  buttons[nextIndex]?.focus();
                }
              } else if (e.key === 'Enter' && hasQuery) {
                const firstMatch = [...activeFiltered].sort((a, b) =>
                  sessionSearchRank(a, q) - sessionSearchRank(b, q) || lastTs(b) - lastTs(a),
                )[0] || archivedItems[0];
                if (firstMatch) {
                  e.preventDefault();
                  props.onSelect(firstMatch.id);
                }
              }
            }}
            placeholder="세션 검색 · in:경로 · is:실패 · has:초안"
            title="검색 조건: in:경로, is:실행중/실패/고정/보관, has:초안/대기열. 조건과 일반 검색어를 함께 쓸 수 있어요."
            aria-label="세션 검색. in:경로, is:실패/고정/실행중/보관, has:초안/대기열 조건을 사용할 수 있습니다. 아래/위 화살표로 결과 이동, Enter로 열기, Esc로 검색어 지우기"
            />
            {query && <button type="button" className="icon-btn side-search-clear" onClick={() => setQuery('')} aria-label="검색 지우기" title="검색 지우기 (Esc)"><XIcon size={13} /></button>}
          </div>
          <button type="button" className={queryHelpOpen ? 'icon-btn session-search-help-toggle active' : 'icon-btn session-search-help-toggle'} aria-label="세션 검색 조건 도움말" aria-expanded={queryHelpOpen} aria-haspopup="dialog" aria-controls="session-search-help" title="고급 검색 조건 도움말" onClick={() => setQueryHelpOpen((open) => !open)}>
            <SlidersIcon size={14} />
          </button>
          {queryHelpOpen && <div className="session-search-help" id="session-search-help" role="dialog" aria-label="세션 검색 조건 도움말">
            <div className="session-search-help-title">검색 조건</div>
            <p><code>in:</code> 뒤에 프로젝트 경로를 입력하세요. 공백이 있으면 따옴표로 묶고, 다른 조건과 함께 조합할 수 있어요.</p>
            <div className="session-search-help-group"><span>프로젝트</span><button type="button" title="프로젝트 경로 조건 시작" onClick={() => addSearchToken('in:')}><code>in:</code><span>경로 조건 시작</span></button></div>
            <div className="session-search-help-group"><span>상태</span>{[['is:running', '실행 중'], ['is:failed', '실패'], ['is:pinned', '고정'], ['is:archived', '보관']].map(([token, label]) => <button type="button" key={token} title={`${token} 조건 추가`} onClick={() => addSearchToken(token)}><code>{token}</code><span>{label}</span></button>)}</div>
            <div className="session-search-help-group"><span>포함 조건</span>{[['has:draft', '초안'], ['has:queued', '대기열']].map(([token, label]) => <button type="button" key={token} title={`${token} 조건 추가`} onClick={() => addSearchToken(token)}><code>{token}</code><span>{label}</span></button>)}</div>
          </div>}
        </div>
      </div>

      <div className="session-filters" role="group" aria-label="세션 빠른 필터">
        {([
          ['all', '전체'],
          ['pinned', '고정'],
          ['running', '실행 중'],
          ['failed', '실패'],
          ['draft', '초안 있음'],
          ['queued', '대기열'],
        ] as const).map(([filter, label]) => (
          <button
            key={filter}
            type="button"
            className={sessionFilter === filter ? 'session-filter active' : 'session-filter'}
            aria-pressed={sessionFilter === filter}
            aria-label={`${label} 세션 ${sessionFilterCounts[filter]}개`}
            title={`${label} 세션 ${sessionFilterCounts[filter]}개`}
            onClick={() => setSessionFilter(filter)}
          >
            {label}<span>{sessionFilterCounts[filter]}</span>
          </button>
        ))}
      </div>
      <div className="session-selection-bar">
        <button
          type="button"
          className={selectionMode ? 'session-selection-toggle active' : 'session-selection-toggle'}
          aria-pressed={selectionMode}
          onClick={() => {
            setSelectionMode((enabled) => !enabled);
            setSelectedSessionIds([]);
            selectionAnchorRef.current = null;
          }}
        >
          {selectionMode ? '선택 취소' : '여러 개 선택'}
        </button>
        {selectionMode && (
          <>
            <span className="session-selection-count" aria-live="polite">{selectedVisibleIds.length}개 선택</span>
            <button
              type="button"
              className="session-selection-action"
              disabled={selectedVisibleIds.length === 0}
              title="선택한 대화를 하나의 Markdown 파일로 내보내기"
              onClick={async () => {
                if (await props.onExportMany(selectedVisibleIds)) setSelectedSessionIds([]);
              }}
            >
              <ExportIcon size={12} /> 내보내기
            </button>
            <button
              type="button"
              className="session-selection-action"
              disabled={visibleSessionIds.length === 0}
              title="표시된 세션 선택 (Ctrl+A)"
              onClick={() => setSelectedSessionIds((previous) => selectVisibleSidebarSessions(previous, visibleSessionIds, !allVisibleSelected))}
            >
              {allVisibleSelected ? '선택 해제' : '표시 항목 선택'}
            </button>
            <button
              type="button"
              className="session-selection-action"
              disabled={selectedVisibleIds.length === 0}
              onClick={() => {
                props.onTogglePinnedMany(selectedVisibleIds);
                setSelectedSessionIds([]);
              }}
            >
              {selectedAllPinned ? '고정 해제' : '고정'}
            </button>
            <button
              type="button"
              className="session-selection-action"
              disabled={selectedVisibleIds.length === 0 || (!selectedAllArchived && selectedContainsRunning)}
              title={!selectedAllArchived && selectedContainsRunning ? '실행 중인 세션은 보관할 수 없습니다.' : selectedAllArchived ? '선택한 세션 보관 해제' : '선택한 세션 보관'}
              onClick={() => {
                props.onToggleArchivedMany(selectedVisibleIds);
                setSelectedSessionIds([]);
              }}
            >
              {selectedAllArchived ? '보관 해제' : '보관'}
            </button>
            <button
              type="button"
              className="session-selection-action danger"
              disabled={selectedVisibleIds.length === 0 || selectedContainsRunning}
              title={selectedContainsRunning ? '실행 중인 세션은 삭제할 수 없습니다.' : '선택한 세션 영구 삭제'}
              onClick={async () => {
                if (await props.onDeleteMany(selectedVisibleIds)) {
                  setSelectedSessionIds([]);
                  setSelectionMode(false);
                }
              }}
            >
              삭제
            </button>
          </>
        )}
      </div>

      <div className="side-section split">
        <span>{groupBy === 'project' ? '프로젝트' : '상태별 세션'}</span>
        <div className="side-section-actions">
          <select
            className="sidebar-sort"
            aria-label="세션 정렬"
            title="세션 정렬"
            value={sessionSort}
            onChange={(event) => setSessionSort(event.target.value as 'recent' | 'oldest' | 'name')}
          >
            <option value="recent">최근 활동</option>
            <option value="oldest">오래된 순</option>
            <option value="name">이름순</option>
          </select>
          {groupBy === 'project' && (
            <button type="button" className="icon-btn" title="프로젝트 폴더 추가" aria-label="프로젝트 폴더 추가" onClick={props.onAddProject}>
              <PlusIcon size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="side-groups">
        {groups.length === 0 && (
          <div className="empty-note">{sessionFilter !== 'all' && matchingActiveSessions.length > 0
            ? '조건에 맞는 세션이 없습니다. 전체 필터를 선택해 보세요.'
            : hasQuery ? (archivedItems.length ? '검색 결과는 보관함에 있습니다.' : '검색 결과가 없습니다.') : (archivedItems.length ? '활성 스레드가 없습니다. 보관함에서 복원할 수 있어요.' : '아직 스레드가 없습니다.')}</div>
        )}
        {groups.map((g) => {
          const open = hasQuery || openGroups[g.key] !== false;
          const isActiveProject = groupBy === 'project' && !!g.sub && g.sub === props.activeFolder;
          return (
            <div key={g.key} className="thread-group">
              <div
                className={isActiveProject ? 'group-head active' : 'group-head'}
                title={g.sub || g.title}
              >
                <button type="button" className="group-toggle" onClick={() => toggleGroup(g.key)} aria-expanded={open}>
                  {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
                  <span className="group-title">{g.title}</span>
                  <span className="group-count">{g.items.length}</span>
                </button>
                {groupBy === 'project' && (
                  <span className="group-actions">
                  {g.sub && (
                    <button
                        className="icon-btn"
                        title="이 폴더를 작업 폴더로"
                        aria-label={`${g.title} 폴더를 작업 폴더로 열기`}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onSelectProject(g.sub || '');
                        }}
                      >
                      <FolderIcon size={13} />
                    </button>
                  )}
                    {g.sub && (
                      <button
                        type="button"
                        className={isProjectPinned(g.sub) ? 'icon-btn project-pin on' : 'icon-btn project-pin'}
                        title={isProjectPinned(g.sub) ? '프로젝트 고정 해제' : '프로젝트 고정'}
                        aria-label={isProjectPinned(g.sub) ? `${g.title} 프로젝트 고정 해제` : `${g.title} 프로젝트 고정`}
                        aria-pressed={isProjectPinned(g.sub)}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onToggleProjectPinned(g.sub || '');
                        }}
                      >
                        <StarIcon size={13} filled={isProjectPinned(g.sub)} />
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title={g.sub ? `${g.title}에 새 세션` : '새 세션'}
                      aria-label={g.sub ? `${g.title}에서 새 세션` : '새 세션'}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onNewSessionInFolder(g.sub || '');
                      }}
                    >
                      <PlusIcon size={13} />
                    </button>
                    {g.sub && props.projects.some((p) => normalizePathForComparison(p) === normalizePathForComparison(g.sub || '')) && (
                      <button
                        className="icon-btn danger"
                        title="프로젝트 목록에서 제거"
                        aria-label={`${g.title} 프로젝트 목록에서 제거`}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onRemoveProject(g.sub || '');
                        }}
                      >
                        <XIcon size={13} />
                      </button>
                    )}
                  </span>
                )}
              </div>
              {open && groupBy === 'project' && g.items.length === 0 && (
                <div className="empty-note">
                  {archivedItems.some((s) => (s.cwd || '(none)') === g.key)
                    ? '세션이 보관함에 있습니다.'
                    : '아직 세션이 없습니다. + 버튼으로 추가하세요.'}
                </div>
              )}
              {open &&
                g.items.map((s) => {
                  const running = runningIds.includes(s.id);
                  const failed = !running && isSidebarSessionFailed(s);
                                  const match = q && !s.title.toLowerCase().includes(q)
                                    ? [...s.messages].reverse().find((m) => m.text.toLowerCase().includes(q))?.text || ''
                                    : '';
                                  const matchIndex = match.toLowerCase().indexOf(q);
                                  const matchPreviewStart = match ? Math.max(0, matchIndex - 24) : 0;
                                  const matchPreview = match
                                    ? match.slice(matchPreviewStart, matchIndex + q.length + 45).replace(/\s+/g, ' ')
                                    : q && (s.cwd || '').toLowerCase().includes(q) ? `프로젝트 · ${s.cwd}` : '';
                                  const previewMatchStart = matchIndex - matchPreviewStart;
                  const lastUserText = [...s.messages].reverse().find((message) => message.role === 'user')?.text.replace(/\s+/g, ' ').trim() || '';
                  const sessionPreview = matchPreview || lastUserText;
                  return (
                    <div
                      key={s.id}
                      data-session-id={s.id}
                      onClick={(event) => selectionMode
                        ? selectSession(s.id, event.shiftKey)
                        : props.onSelect(s.id)}
                      className={`thread-row${s.id === activeId ? ' active' : ''}${selectedVisibleIds.includes(s.id) ? ' selected' : ''}`}
                      title={sessionPreview ? `${s.title}\n${sessionPreview}` : s.title}
                    >
                      {selectionMode && (
                        <input
                          className="session-select-checkbox"
                          type="checkbox"
                          checked={selectedVisibleIds.includes(s.id)}
                          aria-label={`${s.title} 선택`}
                          onClick={(event) => { event.stopPropagation(); selectSession(s.id, event.shiftKey); }}
                          onChange={() => {}}
                        />
                      )}
                      <span className={running ? 't-dot running' : failed ? 't-dot failed' : 't-dot'} />
                      {editingId === s.id ? (
                        <input
                          className="thread-rename"
                          autoFocus
                          value={editTitle}
                          maxLength={80}
                          aria-label="스레드 이름"
                          onChange={(e) => setEditTitle(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') finishRename();
                            if (e.key === 'Escape') { cancelRenameRef.current = true; setEditingId(null); }
                          }}
                          onBlur={finishRename}
                        />
                      ) : (
                        <span className="thread-label">
                          <button
                            type="button"
                            className="thread-title"
                            aria-current={s.id === activeId ? 'page' : undefined}
                            onDoubleClick={(e) => { e.stopPropagation(); startRename(s); }}
                            aria-keyshortcuts="ArrowUp ArrowDown Home End F2"
                            onKeyDown={(e) => handleSessionTitleKeyDown(e, s)}
          >{q ? highlightSidebarText(s.title, q) : s.title}</button>
                          {sessionPreview && <span className={matchPreview ? 'thread-match search-match' : 'thread-match'}>{matchPreview && previewMatchStart >= 0
                            ? <>{matchPreview.slice(0, previewMatchStart)}<mark className="thread-search-highlight">{matchPreview.slice(previewMatchStart, previewMatchStart + q.length)}</mark>{matchPreview.slice(previewMatchStart + q.length)}</>
                            : sessionPreview}</span>}
                        </span>
                      )}
                      {groupBy === 'status' && s.cwd && (
                        <span className="thread-project-path" title={s.cwd} aria-label={`작업 폴더 ${s.cwd}`}>
                          <FolderIcon size={11} />
                          <span>{compactProjectPath(s.cwd)}</span>
                        </span>
                      )}
                      {s.engine === 'msp' && <span className="tag tag-msp">MSP</span>}
                      {draftSessionIdSet.has(s.id) && <span className="thread-draft-indicator" title="이 대화에 전송하지 않은 초안이 저장되어 있습니다." aria-label="저장된 초안 있음">초안</span>}
                      {!!props.queuedSessionCounts[s.id] && <span className="thread-queue-indicator" title="이 세션에 실행 대기 중인 요청이 있습니다." aria-label={`대기 중인 요청 ${props.queuedSessionCounts[s.id]}개`}>대기 {props.queuedSessionCounts[s.id]}</span>}
                      <span className="thread-meta">
                        {running ? <span className="st-word running">실행 중</span> : failed ? <span className="st-word failed">실패</span> : timeAgo(lastTs(s), clockNow)}
                      </span>
                      <button
                        className="icon-btn thread-archive-toggle"
                        title="보관함으로 이동"
                        aria-label={`${s.title} 보관`}
                        disabled={running}
                        onClick={(e) => { e.stopPropagation(); props.onToggleArchived(s.id); }}
                      >
                        <ArchiveIcon size={13} />
                      </button>
                      <button
                        className={s.pinned ? 'icon-btn thread-pin on' : 'icon-btn thread-pin'}
                        title={s.pinned ? '고정 해제' : '스레드 고정'}
                        aria-label={s.pinned ? `${s.title} 고정 해제` : `${s.title} 고정`}
                        aria-pressed={!!s.pinned}
                        onClick={(e) => { e.stopPropagation(); props.onTogglePinned(s.id); }}
                      >
                        <StarIcon size={13} filled={!!s.pinned} />
                      </button>
                      <button
                        className="icon-btn thread-rename-btn"
                        title="이름 변경 (F2)"
                        aria-label={`${s.title} 이름 변경`}
                        onClick={(e) => { e.stopPropagation(); startRename(s); }}
                      >
                        <PencilIcon size={13} />
                      </button>
                      <button
                        className="icon-btn danger thread-del"
                        title={running ? '작업이 끝난 뒤 삭제할 수 있습니다' : '삭제'}
                        aria-label={`${s.title} 삭제`}
                        disabled={running}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onDelete(s.id);
                        }}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  );
                })}
            </div>
          );
        })}
      {archivedItems.length > 0 && (
        <>
          <div className="side-section archive-section">
            <button className="archive-section-toggle" onClick={() => setArchiveOpen((open) => !open)} aria-expanded={hasQuery || archiveOpen}>
              {hasQuery || archiveOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
              <ArchiveIcon size={14} />
              <span>보관함</span>
              <span className="group-count">{archivedItems.length}</span>
            </button>
          </div>
          {(hasQuery || archiveOpen) && (
            <div className="archive-list">
              {archivedItems.map((s) => (
                <div
                  key={s.id}
                  data-session-id={s.id}
                  className={`thread-row archived-thread${s.id === activeId ? ' active' : ''}${selectedVisibleIds.includes(s.id) ? ' selected' : ''}`}
                  title={`${s.title} · 보관됨`}
                  onClick={(event) => selectionMode
                    ? selectSession(s.id, event.shiftKey)
                    : props.onSelect(s.id)}
                >
                  {selectionMode && visibleSessionIds.includes(s.id) && (
                    <input
                      className="session-select-checkbox"
                      type="checkbox"
                      checked={selectedVisibleIds.includes(s.id)}
                      aria-label={`${s.title} 선택`}
                      onClick={(event) => { event.stopPropagation(); selectSession(s.id, event.shiftKey); }}
                      onChange={() => {}}
                    />
                  )}
                  <span className="t-dot" />
                  <button type="button" className="thread-title" aria-current={s.id === activeId ? 'page' : undefined} aria-keyshortcuts="ArrowUp ArrowDown Home End" onKeyDown={(e) => handleSessionTitleKeyDown(e, null)}>{s.title}</button>
                  {draftSessionIdSet.has(s.id) && <span className="thread-draft-indicator" title="이 대화에 전송하지 않은 초안이 저장되어 있습니다." aria-label="저장된 초안 있음">초안</span>}
                  {!!props.queuedSessionCounts[s.id] && <span className="thread-queue-indicator" title="이 세션에 실행 대기 중인 요청이 있습니다." aria-label={`대기 중인 요청 ${props.queuedSessionCounts[s.id]}개`}>대기 {props.queuedSessionCounts[s.id]}</span>}
                  {s.pinned && <StarIcon size={12} filled />}
                  <button
                    className="icon-btn thread-unarchive"
                    title="보관 해제"
                    aria-label={`${s.title} 보관 해제`}
                    onClick={(e) => { e.stopPropagation(); props.onToggleArchived(s.id); }}
                  >
                    <UnarchiveIcon size={13} />
                  </button>
                  <button
                    className="icon-btn danger thread-del"
                    title="삭제"
                    aria-label={`${s.title} 삭제`}
                    onClick={(e) => { e.stopPropagation(); props.onDelete(s.id); }}
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      </div>

      {props.hostSessions.length > 0 && (
        <>
          <div className="side-section">CLI 세션</div>
          <div className="host-search">
            <SearchIcon size={13} />
            <input
              value={hostQuery}
              onChange={(e) => setHostQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && hostQuery) {
                  e.preventDefault();
                  setHostQuery('');
                }
              }}
              placeholder="이름 · 날짜 검색 (예: 10-03)"
              aria-label="CLI 세션 검색. 이름과 날짜로 검색합니다."
            />
            {hostQuery && <button type="button" className="icon-btn host-search-clear" onClick={() => setHostQuery('')} aria-label="CLI 세션 검색 지우기" title="검색 지우기 (Esc)"><XIcon size={12} /></button>}
          </div>
          <div className="side-groups host-groups">
            {visibleHostSessions.length === 0 && (
              <div className="empty-note">검색과 일치하는 CLI 세션이 없습니다.</div>
            )}
            {visibleHostSessions.map((h) => (
              <div key={h.sessionId} className="thread-row host" title={h.workspaceRoot || h.sessionId}>
                <span className="t-dot msp" />
                <span className="thread-title">{h.title || h.name || h.sessionId.slice(0, 8)}</span>
                <span className="thread-meta" title={h.updatedAt ? `마지막 활동: ${new Date(h.updatedAt).toLocaleString()}` : undefined}>
                  {h.turnCount}턴{h.updatedAt && Number.isFinite(Date.parse(h.updatedAt)) ? ` · ${timeAgo(Date.parse(h.updatedAt), clockNow)}` : ''}{h.modelId ? ` · ${h.modelId}` : ''}
                </span>
                <button
                  className="resume-btn"
                  disabled={!!props.resumingId}
                  title={props.resumingId && props.resumingId !== h.sessionId ? '다른 CLI 세션을 연결하는 중입니다.' : undefined}
                  onClick={() => props.onResume(h.sessionId)}
                >
                  {props.resumingId === h.sessionId ? '연결…' : '이어하기'}
                </button>
                <button
                  className="icon-btn danger thread-del"
                  title="CLI 세션 목록에서 삭제"
                  aria-label={`${h.title || h.name || h.sessionId.slice(0, 8)} 삭제`}
                  disabled={!!props.resumingId}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onDeleteHostSession(h.sessionId);
                  }}
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="side-statusbar">
        <button className="mini-profile" onClick={() => setProfileOpen(true)} title={`프로필 · ${profileSub}`}>
          <span className="avatar" aria-hidden>
            <GuitarIcon size={17} />
            <span className={cliDot} />
          </span>
          <span className="mini-meta">
            <span className="mini-name">Musician</span>
            <span className="mini-sub">{profileSub}</span>
          </span>
        </button>
      </div>
      {profileOpen && (
        <div className="profile-backdrop" onClick={() => setProfileOpen(false)}>
          <section
            ref={profileDialogRef}
            className="profile-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-dialog-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                const controls = Array.from(profileDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') || [])
                  .filter((element) => element.offsetParent !== null);
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (!first || !last) {
                  event.preventDefault();
                  profileDialogRef.current?.focus();
                } else if (event.shiftKey && (document.activeElement === first || !profileDialogRef.current?.contains(document.activeElement))) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !profileDialogRef.current?.contains(document.activeElement))) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="profile-head">
              <span className="avatar" aria-hidden>
                <GuitarIcon size={17} />
                <span className={cliDot} />
              </span>
              <span className="mini-meta">
                <span id="profile-dialog-title" className="mini-name">Musician</span>
                <span className="mini-sub">{profileSub}</span>
              </span>
              <button type="button" className="icon-btn" onClick={() => setProfileOpen(false)} title="닫기" aria-label="프로필 닫기">
                <XIcon size={15} />
              </button>
            </div>
            <div className="profile-list">
              <button
                className="profile-row"
                onClick={() => {
                  setProfileOpen(false);
                  props.onOpenCodex();
                }}
              >
                <ChatIcon size={16} />
                <span>코덱스 연동하기</span>
                <ChevronRightIcon size={14} />
              </button>
              <button
                className="profile-row"
                onClick={() => {
                  setProfileOpen(false);
                  props.onOpenSettings();
                }}
              >
                <SlidersIcon size={16} />
                <span>설정</span>
                <ChevronRightIcon size={14} />
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
