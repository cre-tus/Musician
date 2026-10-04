import React, { useEffect, useRef, useState } from 'react';
import FileTree from './FileTree';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, CollapseIcon, CopyIcon, ExplorerIcon, FileTypeIcon, FolderIcon, NewFileIcon, NewFolderIcon, PlusIcon, RefreshIcon, SearchIcon, StarIcon, XIcon } from './icons';
import { api, hasBridge } from '../lib/mudex';
import { normalizePinnedFilePath, pinnedFileParentDirectories, pinnedFileStorageKey, readPinnedFilePaths, reconcilePinnedFilePaths, removePinnedFilePaths, renamePinnedFilePaths } from '../lib/pinned-file-paths.mjs';
import { normalizeCommitMessage, parseUpstreamCounts } from '../lib/git-status.mjs';
import { readExplorerSectionState, toggleExplorerSection, writeExplorerSectionState } from '../lib/explorer-section-state.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import type { ExplorerSection } from '../lib/explorer-section-state.mjs';
import { findTextMatchRanges } from '../lib/text-match-ranges.mjs';
import { formatStr } from '../lib/i18n.mjs';
import { useStrings } from '../lib/lang';
import { readFileSearchPreferences, writeFileSearchPreferences } from '../lib/file-search-preferences.mjs';
import type { FileSearchPreferences } from '../lib/file-search-preferences.mjs';
import { readFileSearchHistory, recordFileSearchQuery, writeFileSearchHistory } from '../lib/file-search-history.mjs';
import type { FileSearchHistoryEntry } from '../lib/file-search-history.mjs';
import type { FileEntry, GitStatusKind } from '../types';

interface EntryDialogState {
  mode: 'create-file' | 'create-folder' | 'rename' | 'delete';
  path: string;
  name: string;
  currentName?: string;
  isDir?: boolean;
}

interface SearchResult {
  path: string;
  relativePath: string;
  lineNumber?: number;
  lineText?: string;
}

interface OpenFile {
  path: string;
  name: string;
  dirty: boolean;
}

interface Props {
  active: boolean;
  folder: string;
  treeVersion: number;
  onRefreshTree: () => void;
  changedFiles: string[];
  changedKinds: Record<string, GitStatusKind>;
  changedStaged: Record<string, boolean>;
  openFiles: OpenFile[];
  recentFiles: string[];
  activeFilePath: string;
  onOpenFile: (filePath: string, pinned?: boolean) => void;
  onCloseFile: (filePath: string) => void;
  onCloseFiles: (filePaths: string[]) => void;
  onOpenFileAtLine: (filePath: string, line: number, pinned?: boolean) => void;
  fileSearchMode: 'name' | 'content';
  fileSearchFocusRequest: number;
  fileSearchQuery: string;
  onSearchModeChange: (mode: 'name' | 'content') => void;
  onOpenChanged: (file: string) => void;
  onRefreshChanged: () => void;
  onCommitFiles: (message: string) => Promise<boolean>;
  onPickFolder: () => void;
  onOpenTerminalAt: (dirPath: string) => void;
  onNotice: (message: string, kind?: string) => void;
  onRenameEntry: (entryPath: string, newName: string) => Promise<boolean>;
  onDeleteEntry: (entryPath: string, isDir: boolean) => Promise<boolean>;
}

const normalizePinnedPath = normalizePinnedFilePath;
// Files tab: folder picker + changed files + file tree.
export default function FilesTab(props: Props) {
  const { folder, treeVersion, changedFiles, changedKinds, changedStaged, openFiles, recentFiles, activeFilePath, onOpenFile, onOpenFileAtLine, onOpenChanged, onRefreshChanged, onPickFolder } = props;
  const strings = useStrings();
  const ft = strings.files;
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState('');
  const [commitSelection, setCommitSelection] = useState<Record<string, boolean>>({});
  const stagedCount = changedFiles.filter((f) => changedStaged[f.replace(/\\/g, '/').toLowerCase()]).length;
  const [gitBranch, setGitBranch] = useState<{ branch: string; ahead: number; behind: number; remote: string } | null>(null);
  const [gitSyncBusy, setGitSyncBusy] = useState<'pull' | 'push' | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneTarget, setCloneTarget] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState('');
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchList, setBranchList] = useState<string[] | null>(null);
  const [branchCurrent, setBranchCurrent] = useState('');
  const [branchBusy, setBranchBusy] = useState<string | null>(null);
  const [branchCreateBusy, setBranchCreateBusy] = useState(false);
  const [branchError, setBranchError] = useState('');
  const [newBranchName, setNewBranchName] = useState('');

  const absForChanged = (file: string) => `${folder}${folder.endsWith('\\') || folder.endsWith('/') ? '' : '\\'}${file.replace(/\//g, '\\')}`;

  const openCommit = () => {
    // Default the checklist to the staged set when one exists; otherwise everything.
    const staged = changedFiles.filter((f) => changedStaged[f.replace(/\\/g, '/').toLowerCase()]);
    const initial = staged.length > 0 ? staged : changedFiles;
    setCommitSelection(Object.fromEntries(initial.map((f) => [f, true])));
    setCommitError('');
    setCommitOpen(true);
  };

  const toggleStaged = async (file: string, staged: boolean) => {
    if (!folder || !hasBridge()) return;
    try {
      const result = await api().gitStage(folder, [absForChanged(file)], staged);
      if (!result.ok) props.onNotice(result.error === 'OUTSIDE_WORKSPACE' ? ft.stageOutside : result.error === 'GIT_NOT_FOUND' ? ft.gitNotFound : result.error || ft.stageFailed, 'git');
      onRefreshChanged();
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error), 'git');
    }
  };

  const submitCommit = async () => {
    const checked = normalizeCommitMessage(commitMessage);
    if (!checked.ok) {
      setCommitError(checked.error === 'MESSAGE_TOO_LONG' ? ft.commitTooLong : ft.commitNeedMsg);
      return;
    }
    const selected = changedFiles.filter((f) => commitSelection[f]);
    if (selected.length === 0) {
      setCommitError(ft.commitNoneSelected);
      return;
    }
    setCommitBusy(true);
    setCommitError('');
    try {
      // Stage exactly the checked set, then commit through the app handler.
      const toAdd = selected.filter((f) => !changedStaged[f.replace(/\\/g, '/').toLowerCase()]).map(absForChanged);
      const selectedSet = new Set(selected);
      const toRemove = changedFiles.filter((f) => !selectedSet.has(f) && changedStaged[f.replace(/\\/g, '/').toLowerCase()]).map(absForChanged);
      if (toAdd.length > 0) {
        const added = await api().gitStage(folder, toAdd, false);
        if (!added.ok) {
          setCommitError(added.error === 'GIT_NOT_FOUND' ? ft.gitNotFound : added.error || ft.commitStageFailed);
          onRefreshChanged();
          return;
        }
      }
      if (toRemove.length > 0) {
        const removed = await api().gitStage(folder, toRemove, true);
        if (!removed.ok) {
          setCommitError(removed.error === 'GIT_NOT_FOUND' ? ft.gitNotFound : removed.error || ft.commitStageFailed);
          onRefreshChanged();
          return;
        }
      }
      const done = await props.onCommitFiles(checked.message!);
      if (done) {
        setCommitOpen(false);
        setCommitMessage('');
        setCommitSelection({});
      } else {
        setCommitError(ft.commitFailed);
      }
    } finally {
      setCommitBusy(false);
    }
  };

  const refreshGitBranch = async () => {
    if (!folder || !hasBridge()) { setGitBranch(null); return; }
    try {
      const r = await api().gitBranch(folder);
      if (!r.ok || !r.branch) { setGitBranch(null); return; }
      const { ahead, behind } = parseUpstreamCounts(r.counts || '');
      setGitBranch({ branch: r.branch, ahead, behind, remote: r.remote || '' });
    } catch {
      setGitBranch(null);
    }
  };
  useEffect(() => { void refreshGitBranch(); }, [folder]);

  const doGitSync = async (op: 'pull' | 'push') => {
    if (!folder || !hasBridge() || gitSyncBusy) return;
    const label = op === 'pull' ? ft.syncPull : ft.syncPush;
    setGitSyncBusy(op);
    try {
      const r = op === 'pull' ? await api().gitPull(folder) : await api().gitPush(folder);
      if (!r.ok) {
        props.onNotice(r.error === 'GIT_NOT_FOUND' ? ft.gitNotFound : r.error === 'TIMEOUT' ? formatStr(ft.syncTimeout, { label }) : (r.error || formatStr(ft.syncFailed, { label: label.toLowerCase() })), 'git');
      } else {
        props.onNotice(op === 'pull' ? ft.pulledOk : ft.pushedOk, 'git');
        onRefreshChanged();
      }
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error), 'git');
    } finally {
      setGitSyncBusy(null);
      void refreshGitBranch();
    }
  };

  const openBranchDialog = async () => {
    if (!folder || !hasBridge()) return;
    setBranchError('');
    setBranchList(null);
    setBranchOpen(true);
    try {
      const r = await api().gitBranches(folder);
      if (!r.ok || !r.branches) {
        setBranchError(r.error === 'GIT_NOT_FOUND' ? ft.gitNotFound : r.error || ft.branchLoadFailed);
        return;
      }
      const current = r.current || '';
      const rest = r.branches.filter((b) => b !== current);
      setBranchCurrent(current);
      setBranchList(current ? [current, ...rest] : rest);
      if (current && (!gitBranch || gitBranch.branch !== current)) void refreshGitBranch();
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
    }
  };

  const switchBranch = async (name: string) => {
    if (!folder || !hasBridge() || branchBusy || branchCreateBusy) return;
    setBranchBusy(name);
    setBranchError('');
    try {
      const r = await api().gitCheckout(folder, name);
      if (!r.ok) {
        setBranchError(r.error === 'DIRTY_TREE' ? ft.branchDirty : r.error === 'GIT_NOT_FOUND' ? ft.gitNotFound : r.error || ft.branchFailed);
        return;
      }
      props.onNotice(formatStr(ft.branchSwitched, { branch: r.branch || name }), 'git');
      setBranchOpen(false);
      void refreshGitBranch();
      onRefreshChanged();
      props.onRefreshTree();
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchBusy(null);
    }
  };

  const createBranch = async () => {
    const name = newBranchName.trim();
    if (!folder || !hasBridge() || !name || branchBusy || branchCreateBusy) return;
    setBranchCreateBusy(true);
    setBranchError('');
    try {
      const r = await api().gitCreateBranch(folder, name);
      if (!r.ok) {
        setBranchError(r.error === 'BRANCH_EXISTS' ? ft.branchExists : r.error === 'BAD_BRANCH' ? ft.branchBadName : r.error === 'GIT_NOT_FOUND' ? ft.gitNotFound : r.error || ft.branchFailed);
        return;
      }
      props.onNotice(formatStr(ft.branchCreated, { branch: r.branch || name }), 'git');
      setNewBranchName('');
      setBranchOpen(false);
      void refreshGitBranch();
      onRefreshChanged();
      props.onRefreshTree();
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchCreateBusy(false);
    }
  };

  const submitClone = async () => {
    const url = cloneUrl.trim();
    const target = cloneTarget.trim();
    if (!url || !target) {
      setCloneError(ft.cloneNeedBoth);
      return;
    }
    setCloneBusy(true);
    setCloneError('');
    try {
      const r = await api().gitClone(url, target);
      if (!r.ok) {
        setCloneError(r.error === 'TARGET_EXISTS' ? ft.cloneTargetExists : r.error === 'NOT_A_DIRECTORY' ? ft.cloneNoParent : r.error === 'GIT_NOT_FOUND' ? ft.gitNotFound : r.error === 'TIMEOUT' ? ft.cloneTimeout : (r.error || ft.cloneFailed));
        return;
      }
      setCloneOpen(false);
      setCloneUrl('');
      setCloneTarget('');
      props.onNotice(formatStr(ft.clonedOk, { path: r.path || target }), 'git');
    } catch (error) {
      setCloneError(error instanceof Error ? error.message : String(error));
    } finally {
      setCloneBusy(false);
    }
  };
  const [collapseVersion, setCollapseVersion] = useState(0);
  const [fileQuery, setFileQuery] = useState('');
  const [searchPreferencesState, setSearchPreferencesState] = useState(() => ({ folder, value: readFileSearchPreferences(folder) }));
  const searchPreferences = searchPreferencesState.folder === folder ? searchPreferencesState.value : readFileSearchPreferences(folder);
  const updateSearchPreferences = (patch: Partial<FileSearchPreferences>) => {
    const current = searchPreferencesState.folder === folder ? searchPreferencesState.value : readFileSearchPreferences(folder);
    setSearchPreferencesState({ folder, value: { ...current, ...patch } });
  };
  const { fileSearchMode: searchMode, fileSearchFocusRequest } = props;
  const [searchHistoryState, setSearchHistoryState] = useState(() => ({ folder, entries: readFileSearchHistory(folder) }));
  const searchHistory = searchHistoryState.folder === folder ? searchHistoryState.entries : readFileSearchHistory(folder);
  const [searchHistoryOpen, setSearchHistoryOpen] = useState(false);
  const [pinnedState, setPinnedState] = useState(() => ({ folder, paths: readPinnedFilePaths(folder) }));
  const pinnedFiles = pinnedState.folder === folder ? pinnedState.paths : readPinnedFilePaths(folder);
  const pinnedFilePaths = pinnedFiles.map(normalizePinnedPath);
  const pinnedFilesSignature = pinnedFiles.join('\0');
  const pinnedParentDirectories = pinnedFileParentDirectories(pinnedFiles, folder);
  const togglePinnedFile = (filePath: string) => {
    const current = pinnedState.folder === folder ? pinnedState.paths : readPinnedFilePaths(folder);
    const normalized = normalizePinnedPath(filePath);
    const isPinned = current.some((path) => normalizePinnedPath(path) === normalized);
    const next = isPinned
      ? current.filter((path) => normalizePinnedPath(path) !== normalized)
      : [filePath, ...current].slice(0, 100);
    try { localStorage.setItem(pinnedFileStorageKey(folder), JSON.stringify(next)); } catch { /* preferences are optional */ }
    setPinnedState({ folder, paths: next });
    props.onNotice(isPinned ? ft.unpinned : ft.pinned);
  };
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchResultsRef = useRef<HTMLDivElement | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [selectedSearchResult, setSelectedSearchResult] = useState(0);
  const [sectionState, setSectionState] = useState(() => ({ folder, value: readExplorerSectionState(folder) }));
  const sections = sectionState.folder === folder ? sectionState.value : readExplorerSectionState(folder);
  const toggleSection = (section: ExplorerSection) => {
    const current = sectionState.folder === folder ? sectionState.value : readExplorerSectionState(folder);
    const next = toggleExplorerSection(current, section);
    writeExplorerSectionState(folder, next);
    setSectionState({ folder, value: next });
  };
  const [entryDialog, setEntryDialog] = useState<EntryDialogState | null>(null);
  const [entryDialogError, setEntryDialogError] = useState('');
  const [entryDialogBusy, setEntryDialogBusy] = useState(false);
  const entryNameRef = useRef<HTMLInputElement | null>(null);
  const entryDialogRef = useRef<HTMLElement | null>(null);
  const filesTabRef = useRef<HTMLDivElement | null>(null);
  const pendingEntryFocusPathRef = useRef<string | null>(null);
  const entryFocusTimerRef = useRef<number | null>(null);
  const recentInFolder = recentFiles.filter((path) => {
    const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const candidate = normalize(path);
    const root = normalize(folder);
    return candidate.startsWith(`${root}/`) && !openFiles.some((file) => normalize(file.path) === candidate);
  }).slice(0, 5);
  const visibleFileNameCounts = new Map<string, number>();
  [...openFiles, ...recentInFolder.map((path) => ({ path, name: path.split(/[\\/]/).pop() || path }))].forEach((file) => {
    const key = file.name.toLocaleLowerCase();
    visibleFileNameCounts.set(key, (visibleFileNameCounts.get(key) || 0) + 1);
  });
  const relativeDirectory = (filePath: string) => {
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedRoot = folder.replace(/\\/g, '/').replace(/\/+$/, '');
    const relativePath = normalizePinnedPath(filePath).startsWith(`${normalizePinnedPath(folder)}/`)
      ? normalizedFile.slice(normalizedRoot.length + 1)
      : normalizedFile;
    return relativePath.split('/').slice(0, -1).join('/') || '.';
  };
  const openFilesSignature = openFiles.map((file) => file.path).join('\0');

  useEffect(() => {
    if (searchPreferencesState.folder === folder) return;
    setSearchPreferencesState({ folder, value: readFileSearchPreferences(folder) });
  }, [folder, searchPreferencesState.folder]);

  useEffect(() => {
    if (searchPreferencesState.folder === folder) writeFileSearchPreferences(folder, searchPreferencesState.value);
  }, [folder, searchPreferencesState]);

  useEffect(() => {
    if (searchHistoryState.folder === folder) return;
    setSearchHistoryState({ folder, entries: readFileSearchHistory(folder) });
    setSearchHistoryOpen(false);
  }, [folder, searchHistoryState.folder]);

  useEffect(() => {
    if (sectionState.folder === folder) return;
    setSectionState({ folder, value: readExplorerSectionState(folder) });
  }, [folder, sectionState.folder]);

  useEffect(() => {
    if (!folder || pinnedFiles.length === 0 || !hasBridge()) return;
    let cancelled = false;
    void reconcilePinnedFilePaths(pinnedFiles, folder, (directory) => api().listDir(directory)).then((nextPinned) => {
      if (cancelled || nextPinned.length === pinnedFiles.length) return;
      try { localStorage.setItem(pinnedFileStorageKey(folder), JSON.stringify(nextPinned)); } catch { /* preferences are optional */ }
      setPinnedState({ folder, paths: nextPinned });
    });
    return () => { cancelled = true; };
  }, [folder, pinnedFilesSignature, treeVersion]);

  useEffect(() => {
    if (!folder || pinnedParentDirectories.length === 0 || !hasBridge()) return;
    let disposed = false;
    const registered: string[] = [];
    for (const directory of pinnedParentDirectories) {
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
  }, [folder, pinnedFilesSignature]);

  useEffect(() => {
    if (!props.active || !sections.open || !activeFilePath) return;
    filesTabRef.current
      ?.querySelector<HTMLElement>('.open-files-section [aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeFilePath, sections.open, openFilesSignature, props.active]);

  useEffect(() => {
    const query = fileQuery.trim();
    let cancelled = false;
    if (!query || !folder) {
      setSearchResults([]);
      setSearching(false);
      setSearchError('');
      setSearchTruncated(false);
      return;
    }
    setSearchResults([]);
    setSelectedSearchResult(0);
    setSearchTruncated(false);
    setSearching(true);
    setSearchError('');
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (searchMode === 'content') {
            const result = await api().searchInFiles(folder, query, { caseSensitive: searchPreferences.caseSensitive, wholeWord: searchPreferences.wholeWord, include: searchPreferences.include, exclude: searchPreferences.exclude, scope: 'files-tab' });
            if (cancelled || result.error === 'CANCELLED') return;
            setSearchResults(result.ok ? result.matches || [] : []);
            setSearchTruncated(!!result.truncated);
            setSearchError(result.ok ? '' : result.error || ft.contentSearchFailed);
          } else {
            const result = await api().searchFiles(folder, query, { include: searchPreferences.include, exclude: searchPreferences.exclude, scope: 'files-tab' });
            if (cancelled || result.error === 'CANCELLED') return;
            setSearchResults(result.ok ? result.files || [] : []);
            setSearchTruncated(!!result.truncated);
            setSearchError(result.ok ? '' : result.error || ft.fileSearchFailed);
          }
        } catch (error) {
          if (cancelled) return;
          setSearchError(error instanceof Error ? error.message : String(error));
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileQuery, folder, searchMode, searchPreferences]);

  useEffect(() => {
    if (fileSearchFocusRequest <= 0) return;
    setFileQuery(props.fileSearchQuery);
    scheduleAfterPaint(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [fileSearchFocusRequest, props.fileSearchQuery]);

  useEffect(() => {
    searchResultsRef.current?.querySelector<HTMLElement>(`#explorer-search-result-${selectedSearchResult}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [searchResults, selectedSearchResult]);

  const focusTreePath = (filePath: string) => {
    const normalizedTarget = normalizePinnedPath(filePath);
    const isRootTarget = normalizedTarget === normalizePinnedPath(folder);
    const row = Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((element) => {
      if (element.offsetParent === null) return false;
      if (isRootTarget) return element.getAttribute('aria-level') === '1';
      return normalizePinnedPath(element.dataset.filePath || '') === normalizedTarget;
    });
    if (!row) return false;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
    return true;
  };

  const closeEntryDialog = (returnPath: string | null | undefined = entryDialog?.path) => {
    setEntryDialog(null);
    pendingEntryFocusPathRef.current = returnPath || null;
    if (!returnPath) return;
    if (entryFocusTimerRef.current !== null) window.clearTimeout(entryFocusTimerRef.current);
    let attempts = 0;
    const focusWhenReady = () => {
      if (pendingEntryFocusPathRef.current !== returnPath) return;
      if (focusTreePath(returnPath) || attempts >= 20) {
        pendingEntryFocusPathRef.current = null;
        entryFocusTimerRef.current = null;
        return;
      }
      attempts++;
      entryFocusTimerRef.current = window.setTimeout(focusWhenReady, 50);
    };
    scheduleAfterPaint(focusWhenReady);
  };

  const openEntryDialog = (state: EntryDialogState) => {
    if (entryFocusTimerRef.current !== null) window.clearTimeout(entryFocusTimerRef.current);
    entryFocusTimerRef.current = null;
    pendingEntryFocusPathRef.current = null;
    setEntryDialog(state);
    setEntryDialogError('');
    scheduleAfterPaint(() => {
      if (state.mode === 'delete') entryDialogRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      else {
        entryNameRef.current?.focus();
        entryNameRef.current?.select();
      }
    });
  };

  const createEntry = async (dirPath: string, kind: 'file' | 'folder') => {
    if (!dirPath) return;
    openEntryDialog({ mode: kind === 'file' ? 'create-file' : 'create-folder', path: dirPath, name: kind === 'file' ? 'untitled.txt' : 'new-folder' });
  };

  const submitEntryDialog = async () => {
    if (!entryDialog || entryDialogBusy) return;
    const name = entryDialog.name.trim();
    if (!name) {
      setEntryDialogError(ft.entryNeedName);
      entryNameRef.current?.focus();
      return;
    }
    if (entryDialog.mode === 'rename' && name === entryDialog.currentName) {
      closeEntryDialog();
      return;
    }
    setEntryDialogBusy(true);
    setEntryDialogError('');
    try {
      if (entryDialog.mode === 'rename') {
        const renamed = await props.onRenameEntry(entryDialog.path, name);
        if (!renamed) {
          setEntryDialogError(ft.renameFailed);
          return;
        }
        const oldPath = entryDialog.path;
        const separatorIndex = Math.max(oldPath.lastIndexOf('/'), oldPath.lastIndexOf('\\'));
        const newPath = `${oldPath.slice(0, separatorIndex + 1)}${name}`;
        const nextPinned = renamePinnedFilePaths(pinnedFiles, oldPath, newPath, !!entryDialog.isDir);
        if (nextPinned.some((path, index) => path !== pinnedFiles[index])) {
          try { localStorage.setItem(pinnedFileStorageKey(folder), JSON.stringify(nextPinned)); } catch { /* preferences are optional */ }
          setPinnedState({ folder, paths: nextPinned });
        }
        props.onRefreshTree();
        onRefreshChanged();
        closeEntryDialog(newPath);
        return;
      }
      if (entryDialog.mode === 'delete') {
        const deleted = await props.onDeleteEntry(entryDialog.path, !!entryDialog.isDir);
        if (!deleted) {
          setEntryDialogError(ft.trashFailed);
          return;
        }
        const nextPinned = removePinnedFilePaths(pinnedFiles, entryDialog.path, !!entryDialog.isDir);
        if (nextPinned.length !== pinnedFiles.length) {
          try { localStorage.setItem(pinnedFileStorageKey(folder), JSON.stringify(nextPinned)); } catch { /* preferences are optional */ }
          setPinnedState({ folder, paths: nextPinned });
        }
        props.onRefreshTree();
        onRefreshChanged();
        const separatorIndex = Math.max(entryDialog.path.lastIndexOf('/'), entryDialog.path.lastIndexOf('\\'));
        closeEntryDialog(separatorIndex > 0 ? entryDialog.path.slice(0, separatorIndex) : null);
        return;
      }
      const kind = entryDialog.mode === 'create-file' ? 'file' : 'folder';
      const result = await api().createEntry(entryDialog.path, name, kind);
      if (!result.ok || !result.path) {
        const message = result.error === 'ALREADY_EXISTS'
          ? ft.alreadyExists
          : result.error === 'BAD_NAME'
            ? ft.badName
            : result.error || ft.createFailed;
        setEntryDialogError(message);
        return;
      }
      props.onRefreshTree();
      onRefreshChanged();
      closeEntryDialog(kind === 'file' ? null : entryDialog.path);
      if (kind === 'file') onOpenFile(result.path);
    } catch (error) {
      setEntryDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setEntryDialogBusy(false);
    }
  };

  const requestRenameEntry = (entry: FileEntry) => {
    openEntryDialog({ mode: 'rename', path: entry.path, name: entry.name, currentName: entry.name, isDir: entry.isDir });
  };

  const requestDeleteEntry = (entry: FileEntry) => {
    openEntryDialog({ mode: 'delete', path: entry.path, name: entry.name, isDir: entry.isDir });
  };

  const deleteEntry = async (entryPath: string, isDir: boolean) => {
    const deleted = await props.onDeleteEntry(entryPath, isDir);
    if (deleted) {
      props.onRefreshTree();
      onRefreshChanged();
    }
    return deleted;
  };

  const openSearchResult = (result: SearchResult, pinned = false) => {
    const current = searchHistoryState.folder === folder ? searchHistoryState.entries : readFileSearchHistory(folder);
    const next = recordFileSearchQuery(current, fileQuery, searchMode);
    writeFileSearchHistory(folder, next);
    setSearchHistoryState({ folder, entries: next });
    if (result.lineNumber) onOpenFileAtLine(result.path, result.lineNumber, pinned);
    else onOpenFile(result.path, pinned);
  };

  const copySearchResultLocation = async (result: SearchResult) => {
    const location = `${result.relativePath}${result.lineNumber ? `:${result.lineNumber}` : ''}`;
    try {
      await navigator.clipboard.writeText(location);
      props.onNotice(formatStr(ft.copiedLocation, { location }));
    } catch {
      props.onNotice(ft.copyLocationFailed);
    }
  };

  const restoreSearchQuery = (entry: FileSearchHistoryEntry) => {
    props.onSearchModeChange(entry.mode);
    setFileQuery(entry.query);
    setSearchHistoryOpen(false);
    scheduleAfterPaint(() => searchInputRef.current?.focus());
  };

  const renderSearchSnippet = (line: string) => {
    const ranges = findTextMatchRanges(line, fileQuery.trim(), searchPreferences.caseSensitive, searchPreferences.wholeWord);
    if (!ranges.length) return line;
    const parts: React.ReactNode[] = [];
    let offset = 0;
    ranges.forEach(({ start, end }, index) => {
      if (start > offset) parts.push(<React.Fragment key={`text-${index}`}>{line.slice(offset, start)}</React.Fragment>);
      parts.push(<mark className="explorer-search-match" key={`match-${index}`}>{line.slice(start, end)}</mark>);
      offset = end;
    });
    if (offset < line.length) parts.push(<React.Fragment key="text-end">{line.slice(offset)}</React.Fragment>);
    return parts;
  };

  return (
    <div ref={filesTabRef} className="files-tab">
      <div className="files-head">
        <div className="files-title">
          <ExplorerIcon size={16} /> <span>{ft.title}</span>
          <span className="files-title-tools">
            <button className="icon-btn" type="button" title={ft.newFile} aria-label={ft.newFile} onClick={() => void createEntry(folder, 'file')} disabled={!folder}><NewFileIcon size={14} /></button>
            <button className="icon-btn" type="button" title={ft.newFolder} aria-label={ft.newFolder} onClick={() => void createEntry(folder, 'folder')} disabled={!folder}><NewFolderIcon size={14} /></button>
            <button className="icon-btn" type="button" title={ft.refreshTree} aria-label={ft.refreshTree} onClick={props.onRefreshTree}><RefreshIcon size={14} /></button>
            <button className="icon-btn" type="button" title={ft.collapseAll} aria-label={ft.collapseAll} onClick={() => setCollapseVersion((v) => v + 1)}><CollapseIcon size={14} /></button>
          </span>
        </div>
      <button className="btn btn-block" onClick={onPickFolder} title={folder || ft.openFolderTitle}>
        <FolderIcon size={14} /> <span>{folder || ft.openFolder}</span>
      </button>
      {folder && (
        <>
          {pinnedFiles.length > 0 && (
            <div className="changed-section pinned-files-section">
              <button className="explorer-section-toggle changed-head" type="button" aria-expanded={sections.pinned} onClick={() => toggleSection('pinned')}>
                {sections.pinned ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                <StarIcon size={12} filled />
                <span>{ft.favorites} <span className="section-count">{pinnedFiles.length}</span></span>
              </button>
              {sections.pinned && <div className="favorite-list">
                {pinnedFiles.map((path) => {
                  const name = path.split(/[\\/]/).pop() || path;
                  const rootPrefix = folder.replace(/\\/g, '/').replace(/\/$/, '');
                  const relativePath = path.replace(/\\/g, '/').slice(rootPrefix.length + 1);
                  return (
                    <div key={path} className="favorite-row">
                      <button className="favorite-open" type="button" title={path} onClick={() => onOpenFile(path)}>
                        <FileTypeIcon size={15} name={name} />
                        <span className="favorite-file-label"><span className="favorite-file-name">{name}</span><span className="favorite-file-path">{relativePath}</span></span>
                      </button>
                      <button className="icon-btn favorite-remove" type="button" title={ft.unfavorite} aria-label={formatStr(ft.unfavoriteLabel, { name })} onClick={() => togglePinnedFile(path)}><StarIcon size={13} filled /></button>
                    </div>
                  );
                })}
              </div>}
            </div>
          )}
          {openFiles.length > 0 && (
            <div className="changed-section open-files-section">
              <div className="changed-head">
                <button className="explorer-section-toggle" type="button" aria-expanded={sections.open} onClick={() => toggleSection('open')}>
                  {sections.open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                  <span>{ft.openFiles} <span className="section-count">{openFiles.length}</span></span>
                </button>
                {openFiles.some((file) => !file.dirty) && <button
                  type="button"
                  className="icon-btn open-files-cleanup"
                  title={formatStr(ft.closeSavedTitle, { count: openFiles.filter((file) => !file.dirty).length })}
                  aria-label={formatStr(ft.closeSavedLabel, { count: openFiles.filter((file) => !file.dirty).length })}
                  onClick={() => props.onCloseFiles(openFiles.filter((file) => !file.dirty).map((file) => file.path))}
                ><XIcon size={13} /></button>}
              </div>
              {sections.open && <div className="changed-list">
                {openFiles.map((file) => {
                  const duplicateName = visibleFileNameCounts.get(file.name.toLocaleLowerCase())! > 1;
                  const isActive = normalizePinnedPath(file.path) === normalizePinnedPath(activeFilePath);
                  return (
                    <div key={file.path} className="open-file-row">
                      <button
                        type="button"
                        className={`changed-item${isActive ? ' active-file' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                        title={`${file.path}${file.dirty ? ft.unsavedSuffix : ''}`}
                        onClick={() => onOpenFile(file.path)}
                      >
                        <FileTypeIcon size={15} name={file.name} />
                        <span className={duplicateName ? 'changed-file-label' : 'changed-name'}>
                          <span className="changed-name">{file.name}</span>
                          {duplicateName && <span className="favorite-file-path">{relativeDirectory(file.path)}</span>}
                        </span>
                        {file.dirty && <span className="open-file-dirty" title={ft.unsavedTitle} aria-label={ft.unsavedTitle} />}
                      </button>
                      <button
                        type="button"
                        className="icon-btn open-file-close"
                        title={formatStr(ft.closeFileTitle, { name: file.name, dirty: file.dirty ? ft.closeFileDirty : '' })}
                        aria-label={formatStr(ft.closeFileLabel, { name: file.name, dirty: file.dirty ? ft.closeFileDirtyLabel : '' })}
                        onClick={() => props.onCloseFile(file.path)}
                      ><XIcon size={12} /></button>
                    </div>
                  );
                })}
              </div>}
            </div>
          )}
          {recentInFolder.length > 0 && (
            <div className="changed-section recent-files-section">
              <button className="explorer-section-toggle changed-head" type="button" aria-expanded={sections.recent} onClick={() => toggleSection('recent')}>
                {sections.recent ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                <span>{ft.recentFiles} <span className="section-count">{recentInFolder.length}</span></span>
              </button>
              {sections.recent && <div className="changed-list">
                {recentInFolder.map((path) => {
                  const name = path.split(/[\\/]/).pop() || path;
                  const opened = openFiles.find((file) => normalizePinnedPath(file.path) === normalizePinnedPath(path));
                  const isActive = normalizePinnedPath(path) === normalizePinnedPath(activeFilePath);
                  return (
                    <button key={path} className={`changed-item${isActive ? ' active-file' : ''}`} aria-current={isActive ? 'page' : undefined} title={`${path}${opened?.dirty ? ft.unsavedSuffix : ''}`} onClick={() => onOpenFile(path)}>
                      <FileTypeIcon size={15} name={name} />
                      <span className={visibleFileNameCounts.get(name.toLocaleLowerCase())! > 1 ? 'changed-file-label' : 'changed-name'}>
                        <span className="changed-name">{name}</span>
                        {visibleFileNameCounts.get(name.toLocaleLowerCase())! > 1 && <span className="favorite-file-path">{relativeDirectory(path)}</span>}
                      </span>
                      {opened && <span className={`quick-open-state${opened.dirty ? ' dirty' : isActive ? ' current' : ''}`}>{opened.dirty ? ft.stateModified : isActive ? ft.stateCurrent : ft.stateOpen}</span>}
                    </button>
                  );
                })}
              </div>}
            </div>
          )}
          <div className="explorer-search-row">
            <div className="explorer-search">
              <SearchIcon size={14} />
              <input
                ref={searchInputRef}
                value={fileQuery}
                onChange={(event) => setFileQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && searchHistoryOpen) {
                    event.preventDefault();
                    setSearchHistoryOpen(false);
                  } else if (event.key === 'ArrowDown' && searchResults.length) {
                    event.preventDefault();
                    setSelectedSearchResult((index) => (index + 1) % searchResults.length);
                  } else if (event.key === 'ArrowUp' && searchResults.length) {
                    event.preventDefault();
                    setSelectedSearchResult((index) => (index - 1 + searchResults.length) % searchResults.length);
                  } else if (event.key === 'Home' && searchResults.length) {
                    event.preventDefault();
                    setSelectedSearchResult(0);
                  } else if (event.key === 'End' && searchResults.length) {
                    event.preventDefault();
                    setSelectedSearchResult(searchResults.length - 1);
                  } else if (event.key === 'PageDown' && searchResults.length) {
                    event.preventDefault();
                    setSelectedSearchResult((index) => Math.min(searchResults.length - 1, index + 8));
                  } else if (event.key === 'PageUp' && searchResults.length) {
                    event.preventDefault();
                    setSelectedSearchResult((index) => Math.max(0, index - 8));
                  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && searchResults[selectedSearchResult]) {
                    event.preventDefault();
                    openSearchResult(searchResults[selectedSearchResult], true);
                  } else if (event.key === 'Enter' && searchResults[selectedSearchResult]) {
                    event.preventDefault();
                    openSearchResult(searchResults[selectedSearchResult]);
                  } else if (event.key === 'Escape' && fileQuery) {
                    event.preventDefault();
                    setFileQuery('');
                  }
                }}
                placeholder={searchMode === 'content' ? ft.searchContentPh : ft.searchNamePh}
                aria-label={searchMode === 'content' ? ft.searchContentLabel : ft.searchNameLabel}
                aria-controls="explorer-search-results"
                aria-activedescendant={searchResults.length ? `explorer-search-result-${selectedSearchResult}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              {fileQuery && <button className="icon-btn" type="button" onClick={() => setFileQuery('')} title={ft.searchClear} aria-label={ft.searchClear}><XIcon size={13} /></button>}
              <button type="button" className="icon-btn explorer-search-history-toggle" aria-label={ft.historyLabel} title={ft.historyTitle} aria-expanded={searchHistoryOpen} aria-controls="explorer-search-history" disabled={!searchHistory.length} onClick={() => setSearchHistoryOpen((open) => !open)}><ClockIcon size={13} /></button>
            </div>
            {searchHistoryOpen && <div className="explorer-search-history" id="explorer-search-history" role="listbox" aria-label={ft.historyListLabel}>
              {searchHistory.map((entry, index) => <button key={`${entry.mode}:${entry.query}:${index}`} type="button" role="option" aria-selected="false" onClick={() => restoreSearchQuery(entry)} title={entry.query}>
                <span>{entry.query}</span><small>{entry.mode === 'content' ? ft.historyContent : ft.historyName}</small>
              </button>)}
            </div>}
          </div>
          <div className="explorer-search-mode" role="group" aria-label={ft.searchScope}>
            <button type="button" className={searchMode === 'name' ? 'active' : ''} aria-pressed={searchMode === 'name'} onClick={() => props.onSearchModeChange('name')}>{ft.modeName}</button>
            <button type="button" className={searchMode === 'content' ? 'active' : ''} aria-pressed={searchMode === 'content'} onClick={() => props.onSearchModeChange('content')}>{ft.modeContent}</button>
          </div>
          {searchMode === 'content' && <div className="explorer-search-options" role="group" aria-label={ft.contentOpts}>
            <button type="button" className={searchPreferences.caseSensitive ? 'active' : ''} aria-pressed={searchPreferences.caseSensitive} title={ft.caseOpt} onClick={() => updateSearchPreferences({ caseSensitive: !searchPreferences.caseSensitive })}>Aa</button>
            <button type="button" className={searchPreferences.wholeWord ? 'active' : ''} aria-pressed={searchPreferences.wholeWord} title={ft.wordOpt} onClick={() => updateSearchPreferences({ wholeWord: !searchPreferences.wholeWord })}>{ft.wordBtn}</button>
          </div>}
          <button type="button" className={searchPreferences.filtersOpen ? 'explorer-filter-toggle active' : 'explorer-filter-toggle'} aria-expanded={searchPreferences.filtersOpen} aria-controls="explorer-path-filters" onClick={() => updateSearchPreferences({ filtersOpen: !searchPreferences.filtersOpen })}>
            {ft.pathFilter}{searchPreferences.include.trim() || searchPreferences.exclude.trim() ? ft.pathFilterOn : ''}
          </button>
          {searchPreferences.filtersOpen && <div className="explorer-path-filters" id="explorer-path-filters">
            <label>
              <span>{ft.includeLabel}</span>
              <input value={searchPreferences.include} onChange={(event) => updateSearchPreferences({ include: event.target.value })} placeholder={ft.includePh} aria-label={ft.includeAria} spellCheck={false} />
            </label>
            <label>
              <span>{ft.excludeLabel}</span>
              <input value={searchPreferences.exclude} onChange={(event) => updateSearchPreferences({ exclude: event.target.value })} placeholder={ft.excludePh} aria-label={ft.excludeAria} spellCheck={false} />
            </label>
            <p>{ft.globHelp}</p>
          </div>}
        </>
      )}
      </div>
      {folder && (
        <div className="changed-section">
          <div className="changed-head">
            <button className="explorer-section-toggle" type="button" aria-expanded={sections.changed} onClick={() => toggleSection('changed')}>
              {sections.changed ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
              <span>{ft.changedTitle} <span className="section-count">{changedFiles.length}</span></span>
            </button>
            <button className="icon-btn" type="button" title={ft.refreshChanged} aria-label={ft.refreshChanged} onClick={() => { void refreshGitBranch(); onRefreshChanged(); }}>
              <RefreshIcon size={13} />
            </button>
            {changedFiles.length > 0 && (
              <button className="btn git-commit-open" type="button" title={stagedCount > 0 ? formatStr(ft.commitStagedTitle, { count: stagedCount }) : ft.commitNoneTitle} onClick={() => openCommit()}>
                {ft.commitBtn}{stagedCount > 0 ? ` ${stagedCount}` : ''}
              </button>
            )}
          </div>
          <div className="git-remote-row">
            {gitBranch && (
              <button className="git-branch" type="button" title={ft.branchBadgeTitle} aria-label={formatStr(ft.branchLabel, { branch: gitBranch.branch })} onClick={() => void openBranchDialog()}>
                {gitBranch.branch}{gitBranch.ahead > 0 ? ` ↑${gitBranch.ahead}` : ''}{gitBranch.behind > 0 ? ` ↓${gitBranch.behind}` : ''}
              </button>
            )}
            {gitBranch && (
              <button className="mini-btn" type="button" title={ft.pullTitle} aria-label={ft.syncPull} disabled={!!gitSyncBusy} onClick={() => void doGitSync('pull')}>
                {gitSyncBusy === 'pull' ? ft.pulling : ft.syncPull}
              </button>
            )}
            {gitBranch && (
              <button className="mini-btn" type="button" title={ft.pushTitle} aria-label={ft.syncPush} disabled={!!gitSyncBusy} onClick={() => { void refreshGitBranch(); setPushOpen(true); }}>
                {gitSyncBusy === 'push' ? ft.pushing : ft.syncPush}
              </button>
            )}
            <button className="mini-btn" type="button" title={ft.cloneTitle} aria-label={ft.cloneBtn} onClick={() => { setCloneError(''); setCloneOpen(true); }}>
              {ft.cloneBtn}
            </button>
          </div>
          {sections.changed && changedFiles.length === 0 ? (
            <div className="empty-note">{ft.noChanges}</div>
          ) : sections.changed ? (
            <div className="changed-list">
              {changedFiles.map((f) => {
                const kindKey = f.replace(/\\/g, '/').toLowerCase();
                const kind = changedKinds[kindKey] || 'M';
                const staged = changedStaged[kindKey] === true;
                return (
                  <div key={f} className={`changed-row kind-${kind.toLowerCase()}${staged ? ' is-staged' : ''}`}>
                    {kind !== 'C' && (
                      <button
                        type="button"
                        className={staged ? 'icon-btn stage-toggle on' : 'icon-btn stage-toggle'}
                        aria-pressed={staged}
                        title={staged ? ft.unstage : ft.stage}
                        aria-label={formatStr(ft.stageLabel, { file: f, action: staged ? ft.unstage : ft.stage })}
                        onClick={() => void toggleStaged(f, staged)}
                      >
                        {staged ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
                      </button>
                    )}
                    <button
                      className="changed-item"
                      title={formatStr(ft.diffTitle, { file: f })}
                      onClick={() => onOpenChanged(f)}
                    >
                      <FileTypeIcon size={15} name={f} />
                      <span className="changed-name">{f}</span>
                      <span className={`git-status-badge status-${kind.toLowerCase()}${staged ? ' is-staged' : ''}`} title={formatStr(staged ? ft.gitStaged : ft.gitState, { label: strings.gitKind[kind.toLowerCase()] || kind, kind })}>{kind}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
      {commitOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !commitBusy) setCommitOpen(false); }}>
        <section className="modal git-commit-dialog" role="dialog" aria-modal="true" aria-labelledby="git-commit-title" tabIndex={-1} onKeyDown={(event) => {
          if (event.key === 'Escape' && !commitBusy) { event.preventDefault(); setCommitOpen(false); }
        }}>
          <div className="modal-header"><h3 id="git-commit-title">{ft.commitDlgTitle}</h3></div>
          <div className="modal-body">
            <p className="modal-note">{formatStr(ft.commitSelectedNote, { count: changedFiles.filter((f) => commitSelection[f]).length })}</p>
            <div className="commit-file-head">
              <span>{ft.commitFilesTitle}</span>
              <span className="commit-file-actions">
                <button type="button" className="mini-btn" disabled={commitBusy} onClick={() => setCommitSelection(Object.fromEntries(changedFiles.map((f) => [f, true])))}>{ft.commitSelectAll}</button>
                <button type="button" className="mini-btn" disabled={commitBusy} onClick={() => setCommitSelection({})}>{ft.commitDeselectAll}</button>
              </span>
            </div>
            <div className="commit-file-list" role="group" aria-label={ft.commitFilesTitle}>
              {changedFiles.filter((f) => (changedKinds[f.replace(/\\/g, '/').toLowerCase()] || 'M') !== 'C').map((f) => {
                const kindKey = f.replace(/\\/g, '/').toLowerCase();
                const kind = changedKinds[kindKey] || 'M';
                return (
                  <label key={f} className={`commit-file-row kind-${kind.toLowerCase()}${commitSelection[f] ? ' is-checked' : ' is-unchecked'}`}>
                    <input type="checkbox" checked={!!commitSelection[f]} disabled={commitBusy} onChange={() => setCommitSelection((prev) => ({ ...prev, [f]: !prev[f] }))} />
                    <FileTypeIcon size={14} name={f} />
                    <span className="changed-name">{f}</span>
                    <span className={`git-status-badge status-${kind.toLowerCase()}`} title={formatStr(ft.gitState, { label: strings.gitKind[kind.toLowerCase()] || kind, kind })}>{kind}</span>
                  </label>
                );
              })}
            </div>
            <label className="field">{ft.msgLabel}
              <textarea value={commitMessage} disabled={commitBusy} onChange={(event) => { setCommitMessage(event.target.value); setCommitError(''); }} placeholder={ft.msgPh} aria-label={ft.msgPh} rows={3} aria-invalid={!!commitError} />
            </label>
            {commitError && <div className="tree-error explorer-entry-error" role="alert">{commitError}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn" type="button" disabled={commitBusy} onClick={() => setCommitOpen(false)}>{strings.common.cancel}</button>
            <button className="btn-primary" type="button" disabled={commitBusy || !normalizeCommitMessage(commitMessage).ok} onClick={() => void submitCommit()}>{commitBusy ? ft.committing : ft.commitBtn}</button>
          </div>
        </section>
      </div>}
      {cloneOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !cloneBusy) setCloneOpen(false); }}>
        <section className="modal git-clone-dialog" role="dialog" aria-modal="true" aria-labelledby="git-clone-title" tabIndex={-1} onKeyDown={(event) => {
          if (event.key === 'Escape' && !cloneBusy) { event.preventDefault(); setCloneOpen(false); }
        }}>
          <div className="modal-header"><h3 id="git-clone-title">{ft.cloneDlgTitle}</h3></div>
          <div className="modal-body">
            <label className="field">{ft.cloneUrlLabel}
              <input value={cloneUrl} disabled={cloneBusy} onChange={(event) => { setCloneUrl(event.target.value); setCloneError(''); }} placeholder={ft.cloneUrlPh} aria-label={ft.cloneUrlLabel} spellCheck={false} />
            </label>
            <label className="field">{ft.cloneDirLabel}
              <input value={cloneTarget} disabled={cloneBusy} onChange={(event) => { setCloneTarget(event.target.value); setCloneError(''); }} placeholder={ft.cloneDirPh} aria-label={ft.cloneDirLabel} spellCheck={false} />
            </label>
            {cloneError && <div className="tree-error explorer-entry-error" role="alert">{cloneError}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn" type="button" disabled={cloneBusy} onClick={() => setCloneOpen(false)}>{strings.common.cancel}</button>
            <button className="btn-primary" type="button" disabled={cloneBusy || !cloneUrl.trim() || !cloneTarget.trim()} onClick={() => void submitClone()}>{cloneBusy ? ft.cloning : ft.cloneBtn}</button>
          </div>
        </section>
      </div>}
      {pushOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !gitSyncBusy) setPushOpen(false); }}>
        <section className="modal modal-sm git-push-dialog" role="dialog" aria-modal="true" aria-labelledby="git-push-title" tabIndex={-1} onKeyDown={(event) => {
          if (event.key === 'Escape' && !gitSyncBusy) { event.preventDefault(); setPushOpen(false); }
        }}>
          <div className="modal-header"><h3 id="git-push-title">{ft.pushDlgTitle}</h3></div>
          <div className="modal-body">
            {gitBranch && <p className="modal-note">{gitBranch.ahead > 0 ? formatStr(ft.pushDetail, { branch: gitBranch.branch, remote: gitBranch.remote || ft.noRemote, ahead: gitBranch.ahead }) : ft.pushUpToDate}</p>}
            {gitBranch && gitBranch.behind > 0 && <div className="tree-error explorer-entry-error" role="alert">{formatStr(ft.pushBehindWarn, { behind: gitBranch.behind })}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn" type="button" disabled={!!gitSyncBusy} onClick={() => setPushOpen(false)}>{strings.common.cancel}</button>
            <button className="btn-primary" type="button" disabled={!!gitSyncBusy} onClick={() => { setPushOpen(false); void doGitSync('push'); }}>{gitSyncBusy === 'push' ? ft.pushing : ft.syncPush}</button>
          </div>
        </section>
      </div>}
      {branchOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !branchBusy && !branchCreateBusy) setBranchOpen(false); }}>
        <section className="modal git-branch-dialog" role="dialog" aria-modal="true" aria-labelledby="git-branch-title" tabIndex={-1} onKeyDown={(event) => {
          if (event.key === 'Escape' && !branchBusy && !branchCreateBusy) { event.preventDefault(); setBranchOpen(false); }
        }}>
          <div className="modal-header"><h3 id="git-branch-title">{ft.branchDlgTitle}</h3></div>
          <div className="modal-body">
            {branchList === null && !branchError && <div className="tree-loading">{strings.common.loading}</div>}
            {branchList !== null && (
              <div className="branch-list" role="listbox" aria-label={ft.branchListLabel}>
                {branchList.map((b) => {
                  const isCurrent = b === branchCurrent;
                  return (
                    <div key={b} className={isCurrent ? 'branch-row current' : 'branch-row'} role="option" aria-selected={isCurrent}>
                      <span className="branch-name">{b}</span>
                      {isCurrent
                        ? <span className="branch-current-tag">{ft.branchCurrent}</span>
                        : <button type="button" className="mini-btn" disabled={!!branchBusy || branchCreateBusy} onClick={() => void switchBranch(b)}>{branchBusy === b ? ft.branchSwitching : ft.branchSwitch}</button>}
                    </div>
                  );
                })}
              </div>
            )}
            <label className="field">{ft.branchNewLabel}
              <span className="branch-create-row">
                <input value={newBranchName} disabled={!!branchBusy || branchCreateBusy} onChange={(event) => { setNewBranchName(event.target.value); setBranchError(''); }} onKeyDown={(event) => { if (event.key === 'Enter' && newBranchName.trim()) void createBranch(); }} placeholder={ft.branchNewPh} aria-label={ft.branchNewPh} spellCheck={false} />
                <button type="button" className="btn-primary" disabled={!!branchBusy || branchCreateBusy || !newBranchName.trim()} onClick={() => void createBranch()}>{branchCreateBusy ? ft.branchCreating : ft.createBtn}</button>
              </span>
            </label>
            {branchError && <div className="tree-error explorer-entry-error" role="alert">{branchError}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn" type="button" disabled={!!branchBusy || branchCreateBusy} onClick={() => setBranchOpen(false)}>{strings.common.close}</button>
          </div>
        </section>
      </div>}
      <div className="tree-wrap">
        {folder ? (
          fileQuery.trim() ? (
            <div className="explorer-search-pane">
              {!searching && !searchError && searchResults.length > 0 && (() => {
                const result = searchResults[selectedSearchResult] || searchResults[0];
                const isPinned = pinnedFilePaths.includes(normalizePinnedPath(result.path));
                return (
                  <div className="explorer-search-summary">
                    <span className="explorer-search-count" role="status" aria-live="polite">
                      {searchResults.length}{searchMode === 'content' ? ft.summaryMatches : ft.summaryFiles}{searchTruncated ? ft.summaryMore : ''}
                      {` · ${selectedSearchResult + 1}/${searchResults.length}`}
                      {searchMode === 'content' && result.lineNumber ? ` · ${result.relativePath}:${result.lineNumber}` : ''}
                      {ft.summaryHints}
                    </span>
                    <button
                      type="button"
                      className="icon-btn explorer-search-copy"
                      aria-label={formatStr(ft.copyResultLabel, { loc: `${result.relativePath}${result.lineNumber ? formatStr(ft.resultLine, { line: result.lineNumber }) : ''}` })}
                      title={ft.copyResultTitle}
                      onClick={() => void copySearchResultLocation(result)}
                    >
                      <CopyIcon size={13} />
                    </button>
                    <button
                      type="button"
                      className={isPinned ? 'icon-btn explorer-search-pin active' : 'icon-btn explorer-search-pin'}
                      aria-label={isPinned ? formatStr(ft.unpinResultLabel, { rel: result.relativePath }) : formatStr(ft.pinResultLabel, { rel: result.relativePath })}
                      aria-pressed={isPinned}
                      title={isPinned ? ft.unpinResultTitle : ft.pinResultTitle}
                      onClick={() => togglePinnedFile(result.path)}
                    >
                      <StarIcon size={13} filled={isPinned} />
                    </button>
                  </div>
                );
              })()}
            <div ref={searchResultsRef} id="explorer-search-results" className="explorer-search-results" role="listbox" aria-label={ft.resultsLabel}>
              {searching && searchResults.length === 0 ? <div className="tree-loading">{searchMode === 'content' ? ft.searchingContent : ft.searchingName}</div>
                : searchError ? <div className="tree-error">{searchError}</div>
                  : searchResults.length === 0 ? <div className="tree-loading">{searchMode === 'content' ? ft.noMatchContent : ft.noMatchName}</div>
                    : <>
                      {searchResults.map((result, index) => {
                        const name = result.relativePath.split(/[\\/]/).pop() || result.relativePath;
                        const isPinned = pinnedFilePaths.includes(normalizePinnedPath(result.path));
                        return (
                        <button
                          key={result.path}
                          id={`explorer-search-result-${index}`}
                          role="option"
                          aria-selected={index === selectedSearchResult}
                          aria-posinset={index + 1}
                          aria-setsize={searchResults.length}
                          className={`explorer-search-result${index === selectedSearchResult ? ' active' : ''}`}
                          title={result.relativePath}
                          onMouseEnter={() => setSelectedSearchResult(index)}
                          onClick={() => openSearchResult(result)}
                        >
                          <FileTypeIcon name={name} size={15} />
                          <span className="explorer-search-result-content">
                            <span className="explorer-search-result-heading">
                              <span className="explorer-search-result-name">{name}</span>
                              <span className="explorer-search-result-path">{result.relativePath}{result.lineNumber ? `:${result.lineNumber}` : ''}</span>
                              {isPinned && <span className="explorer-search-result-star"><StarIcon size={11} filled /></span>}
                            </span>
                            {result.lineText && <code className="explorer-search-result-snippet">{renderSearchSnippet(result.lineText)}</code>}
                          </span>
                        </button>
                      );
                      })}
                    </>}
            </div>
              {searchTruncated && <div className="explorer-search-note">{ft.truncatedNote}</div>}
            </div>
          ) : (
            <FileTree root={folder} version={treeVersion} collapseVersion={collapseVersion} changedFiles={changedFiles} changedKinds={changedKinds} activeFilePath={activeFilePath} activeView={props.active} pinnedFilePaths={pinnedFilePaths} onTogglePinned={togglePinnedFile} onCreateEntry={createEntry} onRequestRename={requestRenameEntry} onRequestDelete={requestDeleteEntry} onNotice={props.onNotice} onOpenFile={onOpenFile} onOpenTerminalAt={props.onOpenTerminalAt} />
          )
        ) : (
          <div className="empty-note">{ft.noFolderNote}</div>
        )}
      </div>
      {entryDialog && <div className="modal-backdrop explorer-entry-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !entryDialogBusy) closeEntryDialog(); }}>
        <section ref={entryDialogRef} className="modal explorer-entry-dialog" role="dialog" aria-modal="true" aria-labelledby="explorer-entry-title" tabIndex={-1} onKeyDown={(event) => {
          if (event.key === 'Escape' && !entryDialogBusy) { event.preventDefault(); closeEntryDialog(); }
          else if (event.key === 'Enter' && (event.target as HTMLElement).tagName !== 'BUTTON') { event.preventDefault(); void submitEntryDialog(); }
          else if (event.key === 'Tab') {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
          <div className="modal-header"><h3 id="explorer-entry-title">{entryDialog.mode === 'rename' ? ft.dlgRename : entryDialog.mode === 'delete' ? ft.dlgTrash : entryDialog.mode === 'create-file' ? ft.newFile : ft.newFolder}</h3></div>
          <div className="modal-body">
            {entryDialog.mode === 'delete' ? <p className="modal-note">{entryDialog.isDir ? ft.trashDir : ft.trashFile} <code>{entryDialog.name}</code>{ft.trashNote}</p> : <label className="field">{ft.nameLabel}
              <input ref={entryNameRef} value={entryDialog.name} disabled={entryDialogBusy} onChange={(event) => { setEntryDialog({ ...entryDialog, name: event.target.value }); setEntryDialogError(''); }} autoComplete="off" spellCheck={false} aria-invalid={!!entryDialogError} />
            </label>}
            {entryDialogError && <div className="tree-error explorer-entry-error" role="alert">{entryDialogError}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn" type="button" disabled={entryDialogBusy} onClick={() => closeEntryDialog()}>{strings.common.cancel}</button>
            <button className={entryDialog.mode === 'delete' ? 'btn-danger' : 'btn-primary'} type="button" disabled={entryDialogBusy || (entryDialog.mode !== 'delete' && !entryDialog.name.trim())} onClick={() => void submitEntryDialog()}>{entryDialogBusy ? ft.processing : entryDialog.mode === 'delete' ? ft.dlgTrash : entryDialog.mode === 'rename' ? ft.dlgRename : ft.createBtn}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}
