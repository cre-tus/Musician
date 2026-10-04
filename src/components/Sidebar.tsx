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
import { formatStr } from '../lib/i18n.mjs';
import { useLang, useStrings } from '../lib/lang';
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
  const lang = useLang();
  const strings = useStrings();
  const sb = strings.sidebar;
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
      ? sb.cliReady
      : cliStatus === 'missing'
        ? sb.cliMissing
        : cliStatus === 'checking'
          ? sb.cliChecking
          : cliStatus === 'error'
            ? sb.cliError
            : sb.cliUnknown;
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
      ? `${cliText} · ${sb.mspConnecting}`
      : mspState === 'error'
        ? `${cliText} · ${sb.mspFailed}`
        : mspState === 'ok'
          ? `${cliText} · ${sb.mspConnected}`
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
        { key: 'st-running', title: sb.statusRunning, items: running },
        { key: 'st-failed', title: sb.statusFailed, items: failed },
        { key: 'st-rest', title: sb.statusRest, items: rest },
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
      return { key: cwd || '(none)', title: cwd ? baseName(cwd) : sb.noFolder, sub: cwd || undefined, items: sorted };
    });
  }, [activeFiltered, groupBy, pinnedProjectKeys, runningIds, props.projects, sb, sessionSort, q, sessionSearchScores]);

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
        <button type="button" className="icon-btn brand-collapse" onClick={props.onCollapse} title={sb.hideSidebarTitle} aria-label={sb.hideSidebar}>
          <SidebarIcon size={16} />
        </button>
      </div>

      <div className="side-actions">
        <button className="side-action" onClick={props.onOpenFiles} title={sb.openExplorerTitle}>
          <ExplorerIcon size={15} /> {sb.explorer}
        </button>
        <button className="side-action" onClick={props.onNew} title={sb.newThreadTitle} aria-keyshortcuts="Control+N Meta+N">
          <PencilIcon size={15} /> {strings.common.newThread}
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
            placeholder={sb.searchPlaceholder}
            title={sb.searchTitle}
            aria-label={sb.searchLabel}
            />
            {query && <button type="button" className="icon-btn side-search-clear" onClick={() => setQuery('')} aria-label={sb.searchClear} title={sb.searchClearTitle}><XIcon size={13} /></button>}
          </div>
          <button type="button" className={queryHelpOpen ? 'icon-btn session-search-help-toggle active' : 'icon-btn session-search-help-toggle'} aria-label={sb.searchHelp} aria-expanded={queryHelpOpen} aria-haspopup="dialog" aria-controls="session-search-help" title={sb.searchHelpTitle} onClick={() => setQueryHelpOpen((open) => !open)}>
            <SlidersIcon size={14} />
          </button>
          {queryHelpOpen && <div className="session-search-help" id="session-search-help" role="dialog" aria-label={sb.searchHelp}>
            <div className="session-search-help-title">{sb.searchHelpHeading}</div>
            <p><code>in:</code> {sb.searchHelpInDesc}</p>
            <div className="session-search-help-group"><span>{sb.searchHelpGroupProject}</span><button type="button" title={sb.searchHelpStartInTitle} onClick={() => addSearchToken('in:')}><code>in:</code><span>{sb.searchHelpStartIn}</span></button></div>
            <div className="session-search-help-group"><span>{sb.searchHelpGroupStatus}</span>{[['is:running', sb.statusRunning], ['is:failed', sb.statusFailed], ['is:pinned', sb.pinBtn], ['is:archived', sb.archiveBtn]].map(([token, label]) => <button type="button" key={token} title={formatStr(sb.searchHelpAddToken, { token })} onClick={() => addSearchToken(token)}><code>{token}</code><span>{label}</span></button>)}</div>
            <div className="session-search-help-group"><span>{sb.searchHelpGroupInclude}</span>{[['has:draft', sb.draftTag], ['has:queued', sb.filterQueued]].map(([token, label]) => <button type="button" key={token} title={formatStr(sb.searchHelpAddToken, { token })} onClick={() => addSearchToken(token)}><code>{token}</code><span>{label}</span></button>)}</div>
          </div>}
        </div>
      </div>

      <div className="session-filters" role="group" aria-label={sb.filterGroup}>
        {([
          ['all', sb.filterAll],
          ['pinned', sb.filterPinned],
          ['running', sb.filterRunning],
          ['failed', sb.filterFailed],
          ['draft', sb.filterDraft],
          ['queued', sb.filterQueued],
        ] as Array<readonly [typeof sessionFilter, string]>).map(([filter, label]) => (
          <button
            key={filter}
            type="button"
            className={sessionFilter === filter ? 'session-filter active' : 'session-filter'}
            aria-pressed={sessionFilter === filter}
            aria-label={formatStr(sb.filterCount, { label, count: sessionFilterCounts[filter] })}
            title={formatStr(sb.filterCount, { label, count: sessionFilterCounts[filter] })}
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
          {selectionMode ? sb.selectionCancel : sb.selectionMulti}
        </button>
        {selectionMode && (
          <>
            <span className="session-selection-count" aria-live="polite">{formatStr(sb.selectionCount, { count: selectedVisibleIds.length })}</span>
            <button
              type="button"
              className="session-selection-action"
              disabled={selectedVisibleIds.length === 0}
              title={sb.exportTitle}
              onClick={async () => {
                if (await props.onExportMany(selectedVisibleIds)) setSelectedSessionIds([]);
              }}
            >
              <ExportIcon size={12} /> {sb.exportBtn}
            </button>
            <button
              type="button"
              className="session-selection-action"
              disabled={visibleSessionIds.length === 0}
              title={sb.selectVisibleTitle}
              onClick={() => setSelectedSessionIds((previous) => selectVisibleSidebarSessions(previous, visibleSessionIds, !allVisibleSelected))}
            >
              {allVisibleSelected ? sb.deselectAll : sb.selectVisible}
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
              {selectedAllPinned ? sb.unpinBtn : sb.pinBtn}
            </button>
            <button
              type="button"
              className="session-selection-action"
              disabled={selectedVisibleIds.length === 0 || (!selectedAllArchived && selectedContainsRunning)}
              title={!selectedAllArchived && selectedContainsRunning ? sb.archiveRunningTitle : selectedAllArchived ? sb.unarchiveTitle : sb.archiveTitle}
              onClick={() => {
                props.onToggleArchivedMany(selectedVisibleIds);
                setSelectedSessionIds([]);
              }}
            >
              {selectedAllArchived ? sb.unarchiveBtn : sb.archiveBtn}
            </button>
            <button
              type="button"
              className="session-selection-action danger"
              disabled={selectedVisibleIds.length === 0 || selectedContainsRunning}
              title={selectedContainsRunning ? sb.deleteRunningTitle : sb.deleteSelectedTitle}
              onClick={async () => {
                if (await props.onDeleteMany(selectedVisibleIds)) {
                  setSelectedSessionIds([]);
                  setSelectionMode(false);
                }
              }}
            >
              {strings.common.delete}
            </button>
          </>
        )}
      </div>

      <div className="side-section split">
        <span>{groupBy === 'project' ? sb.sectionProject : sb.sectionStatus}</span>
        <div className="side-section-actions">
          <select
            className="sidebar-sort"
            aria-label={sb.sortLabel}
            title={sb.sortLabel}
            value={sessionSort}
            onChange={(event) => setSessionSort(event.target.value as 'recent' | 'oldest' | 'name')}
          >
            <option value="recent">{sb.sortRecent}</option>
            <option value="oldest">{sb.sortOldest}</option>
            <option value="name">{sb.sortName}</option>
          </select>
          {groupBy === 'project' && (
            <button type="button" className="icon-btn" title={sb.addProject} aria-label={sb.addProject} onClick={props.onAddProject}>
              <PlusIcon size={13} />
            </button>
          )}
        </div>
      </div>
      <div className="side-groups">
        {groups.length === 0 && (
          <div className="empty-note">{sessionFilter !== 'all' && matchingActiveSessions.length > 0
            ? sb.emptyNoMatchFilter
            : hasQuery ? (archivedItems.length ? sb.emptySearchInArchive : sb.emptyNoSearchResult) : (archivedItems.length ? sb.emptyNoActive : sb.emptyNoThreads)}</div>
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
                        title={sb.workFolderTitle}
                        aria-label={formatStr(sb.workFolderLabel, { title: g.title })}
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
                        title={isProjectPinned(g.sub) ? sb.projectUnpinTitle : sb.projectPinTitle}
                        aria-label={isProjectPinned(g.sub) ? formatStr(sb.projectUnpinLabel, { title: g.title }) : formatStr(sb.projectPinLabel, { title: g.title })}
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
                      title={g.sub ? formatStr(sb.newSessionIn, { title: g.title }) : sb.newSessionPlain}
                      aria-label={g.sub ? formatStr(sb.newSessionInLabel, { title: g.title }) : sb.newSessionPlain}
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
                        title={sb.removeProjectTitle}
                        aria-label={formatStr(sb.removeProjectLabel, { title: g.title })}
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
                    ? sb.emptyArchivedNote
                    : sb.emptyGroupNote}
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
                                    : q && (s.cwd || '').toLowerCase().includes(q) ? formatStr(sb.cwdPreview, { cwd: s.cwd }) : '';
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
                          aria-label={formatStr(sb.selectSession, { title: s.title })}
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
                          aria-label={sb.renameLabel}
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
                        <span className="thread-project-path" title={s.cwd} aria-label={formatStr(sb.workFolderRowLabel, { cwd: s.cwd })}>
                          <FolderIcon size={11} />
                          <span>{compactProjectPath(s.cwd)}</span>
                        </span>
                      )}
                      {s.engine === 'msp' && <span className="tag tag-msp">MSP</span>}
                      {draftSessionIdSet.has(s.id) && <span className="thread-draft-indicator" title={sb.draftTitle} aria-label={sb.draftLabel}>{sb.draftTag}</span>}
                      {!!props.queuedSessionCounts[s.id] && <span className="thread-queue-indicator" title={sb.queueTitle} aria-label={formatStr(sb.queueLabel, { count: props.queuedSessionCounts[s.id] })}>{formatStr(sb.queueTag, { count: props.queuedSessionCounts[s.id] })}</span>}
                      <span className="thread-meta">
                        {running ? <span className="st-word running">{sb.statusRunning}</span> : failed ? <span className="st-word failed">{sb.statusFailed}</span> : timeAgo(lastTs(s), clockNow, lang)}
                      </span>
                      <button
                        className="icon-btn thread-archive-toggle"
                        title={sb.moveToArchiveTitle}
                        aria-label={formatStr(sb.archiveRowLabel, { title: s.title })}
                        disabled={running}
                        onClick={(e) => { e.stopPropagation(); props.onToggleArchived(s.id); }}
                      >
                        <ArchiveIcon size={13} />
                      </button>
                      <button
                        className={s.pinned ? 'icon-btn thread-pin on' : 'icon-btn thread-pin'}
                        title={s.pinned ? sb.threadUnpinTitle : sb.threadPinTitle}
                        aria-label={s.pinned ? formatStr(sb.threadUnpinLabel, { title: s.title }) : formatStr(sb.threadPinLabel, { title: s.title })}
                        aria-pressed={!!s.pinned}
                        onClick={(e) => { e.stopPropagation(); props.onTogglePinned(s.id); }}
                      >
                        <StarIcon size={13} filled={!!s.pinned} />
                      </button>
                      <button
                        className="icon-btn thread-rename-btn"
                        title={sb.renameTitle}
                        aria-label={formatStr(sb.renameRowLabel, { title: s.title })}
                        onClick={(e) => { e.stopPropagation(); startRename(s); }}
                      >
                        <PencilIcon size={13} />
                      </button>
                      <button
                        className="icon-btn danger thread-del"
                        title={running ? sb.deleteAfterRunTitle : strings.common.delete}
                        aria-label={formatStr(sb.deleteRowLabel, { title: s.title })}
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
              <span>{sb.archiveSection}</span>
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
                  title={formatStr(sb.archivedRowTitle, { title: s.title })}
                  onClick={(event) => selectionMode
                    ? selectSession(s.id, event.shiftKey)
                    : props.onSelect(s.id)}
                >
                  {selectionMode && visibleSessionIds.includes(s.id) && (
                    <input
                      className="session-select-checkbox"
                      type="checkbox"
                      checked={selectedVisibleIds.includes(s.id)}
                      aria-label={formatStr(sb.selectSession, { title: s.title })}
                      onClick={(event) => { event.stopPropagation(); selectSession(s.id, event.shiftKey); }}
                      onChange={() => {}}
                    />
                  )}
                  <span className="t-dot" />
                  <button type="button" className="thread-title" aria-current={s.id === activeId ? 'page' : undefined} aria-keyshortcuts="ArrowUp ArrowDown Home End" onKeyDown={(e) => handleSessionTitleKeyDown(e, null)}>{s.title}</button>
                  {draftSessionIdSet.has(s.id) && <span className="thread-draft-indicator" title={sb.draftTitle} aria-label={sb.draftLabel}>{sb.draftTag}</span>}
                  {!!props.queuedSessionCounts[s.id] && <span className="thread-queue-indicator" title={sb.queueTitle} aria-label={formatStr(sb.queueLabel, { count: props.queuedSessionCounts[s.id] })}>{formatStr(sb.queueTag, { count: props.queuedSessionCounts[s.id] })}</span>}
                  {s.pinned && <StarIcon size={12} filled />}
                  <button
                    className="icon-btn thread-unarchive"
                    title={sb.unarchiveRowTitle}
                    aria-label={formatStr(sb.unarchiveRowLabel, { title: s.title })}
                    onClick={(e) => { e.stopPropagation(); props.onToggleArchived(s.id); }}
                  >
                    <UnarchiveIcon size={13} />
                  </button>
                  <button
                    className="icon-btn danger thread-del"
                    title={strings.common.delete}
                    aria-label={formatStr(sb.deleteRowLabel, { title: s.title })}
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
          <div className="side-section">{sb.cliSection}</div>
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
              placeholder={sb.cliSearchPlaceholder}
              aria-label={sb.cliSearchLabel}
            />
            {hostQuery && <button type="button" className="icon-btn host-search-clear" onClick={() => setHostQuery('')} aria-label={sb.cliSearchClear} title={sb.searchClearTitle}><XIcon size={12} /></button>}
          </div>
          <div className="side-groups host-groups">
            {visibleHostSessions.length === 0 && (
              <div className="empty-note">{sb.cliEmpty}</div>
            )}
            {visibleHostSessions.map((h) => (
              <div key={h.sessionId} className="thread-row host" title={h.workspaceRoot || h.sessionId}>
                <span className="t-dot msp" />
                <span className="thread-title">{h.title || h.name || h.sessionId.slice(0, 8)}</span>
                <span className="thread-meta" title={h.updatedAt ? formatStr(sb.lastActivityTitle, { date: new Date(h.updatedAt).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR') }) : undefined}>
                  {formatStr(sb.turns, { count: h.turnCount })}{h.updatedAt && Number.isFinite(Date.parse(h.updatedAt)) ? ` · ${timeAgo(Date.parse(h.updatedAt), clockNow, lang)}` : ''}{h.modelId ? ` · ${h.modelId}` : ''}
                </span>
                <button
                  className="resume-btn"
                  disabled={!!props.resumingId}
                  title={props.resumingId && props.resumingId !== h.sessionId ? sb.resumeBusyTitle : undefined}
                  onClick={() => props.onResume(h.sessionId)}
                >
                  {props.resumingId === h.sessionId ? sb.resuming : sb.resume}
                </button>
                <button
                  className="icon-btn danger thread-del"
                  title={sb.removeCliTitle}
                  aria-label={formatStr(sb.removeCliLabel, { name: h.title || h.name || h.sessionId.slice(0, 8) })}
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
        <button className="mini-profile" onClick={() => setProfileOpen(true)} title={formatStr(sb.profileTitle, { sub: profileSub })}>
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
              <button type="button" className="icon-btn" onClick={() => setProfileOpen(false)} title={strings.common.close} aria-label={sb.profileClose}>
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
                <span>{sb.connectCodex}</span>
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
                <span>{sb.settingsRow}</span>
                <ChevronRightIcon size={14} />
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  );
}
