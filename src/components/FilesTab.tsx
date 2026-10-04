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
  onNotice: (message: string) => void;
  onRenameEntry: (entryPath: string, newName: string) => Promise<boolean>;
  onDeleteEntry: (entryPath: string, isDir: boolean) => Promise<boolean>;
}

const normalizePinnedPath = normalizePinnedFilePath;
// Files tab: folder picker + changed files + file tree.
export default function FilesTab(props: Props) {
  const { folder, treeVersion, changedFiles, changedKinds, changedStaged, openFiles, recentFiles, activeFilePath, onOpenFile, onOpenFileAtLine, onOpenChanged, onRefreshChanged, onPickFolder } = props;
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState('');
  const stagedCount = changedFiles.filter((f) => changedStaged[f.replace(/\\/g, '/').toLowerCase()]).length;
  const [gitBranch, setGitBranch] = useState<{ branch: string; ahead: number; behind: number; remote: string } | null>(null);
  const [gitSyncBusy, setGitSyncBusy] = useState<'pull' | 'push' | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneTarget, setCloneTarget] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState('');

  const toggleStaged = async (file: string, staged: boolean) => {
    if (!folder || !hasBridge()) return;
    const abs = `${folder}${folder.endsWith('\\') || folder.endsWith('/') ? '' : '\\'}${file.replace(/\//g, '\\')}`;
    try {
      const result = await api().gitStage(folder, [abs], staged);
      if (!result.ok) props.onNotice(result.error === 'OUTSIDE_WORKSPACE' ? '프로젝트 폴더 밖의 파일은 스테이징할 수 없어.' : result.error === 'GIT_NOT_FOUND' ? 'git 실행 파일을 찾지 못했어.' : result.error || '스테이징하지 못했어.');
      onRefreshChanged();
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const submitCommit = async () => {
    const checked = normalizeCommitMessage(commitMessage);
    if (!checked.ok) {
      setCommitError(checked.error === 'MESSAGE_TOO_LONG' ? '커밋 메시지가 너무 길어.' : '커밋 메시지를 입력해줘.');
      return;
    }
    setCommitBusy(true);
    setCommitError('');
    try {
      const done = await props.onCommitFiles(checked.message!);
      if (done) {
        setCommitOpen(false);
        setCommitMessage('');
      } else {
        setCommitError('커밋하지 못했어. 알림을 확인해줘.');
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
    const label = op === 'pull' ? '풀' : '푸시';
    setGitSyncBusy(op);
    try {
      const r = op === 'pull' ? await api().gitPull(folder) : await api().gitPush(folder);
      if (!r.ok) {
        props.onNotice(r.error === 'GIT_NOT_FOUND' ? 'git 실행 파일을 찾지 못했어.' : r.error === 'TIMEOUT' ? `${label} 시간이 초과됐어.` : (r.error || `${label}하지 못했어.`));
      } else {
        props.onNotice(op === 'pull' ? '가져왔어.' : '올렸어.');
        onRefreshChanged();
      }
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setGitSyncBusy(null);
      void refreshGitBranch();
    }
  };

  const submitClone = async () => {
    const url = cloneUrl.trim();
    const target = cloneTarget.trim();
    if (!url || !target) {
      setCloneError('저장소 URL과 클론 폴더를 입력해줘.');
      return;
    }
    setCloneBusy(true);
    setCloneError('');
    try {
      const r = await api().gitClone(url, target);
      if (!r.ok) {
        setCloneError(r.error === 'TARGET_EXISTS' ? '이미 있는 폴더야. 다른 폴더를 지정해줘.' : r.error === 'NOT_A_DIRECTORY' ? '부모 폴더를 찾지 못했어.' : r.error === 'GIT_NOT_FOUND' ? 'git 실행 파일을 찾지 못했어.' : r.error === 'TIMEOUT' ? '클론 시간이 초과됐어.' : (r.error || '클론하지 못했어.'));
        return;
      }
      setCloneOpen(false);
      setCloneUrl('');
      setCloneTarget('');
      props.onNotice(`클론했어. (${r.path || target})`);
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
    props.onNotice(isPinned ? '즐겨찾기에서 뺐어.' : '파일을 즐겨찾기에 고정했어.');
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
            setSearchError(result.ok ? '' : result.error || '내용 검색 실패');
          } else {
            const result = await api().searchFiles(folder, query, { include: searchPreferences.include, exclude: searchPreferences.exclude, scope: 'files-tab' });
            if (cancelled || result.error === 'CANCELLED') return;
            setSearchResults(result.ok ? result.files || [] : []);
            setSearchTruncated(!!result.truncated);
            setSearchError(result.ok ? '' : result.error || '파일 검색 실패');
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
      setEntryDialogError('이름을 입력해줘.');
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
          setEntryDialogError('이름을 변경하지 못했어. 열린 파일이 수정 중인지 확인해줘.');
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
          setEntryDialogError('항목을 휴지통으로 옮기지 못했어. 실행 중인 작업이나 수정 중인 파일이 있는지 확인해줘.');
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
          ? '같은 이름의 파일 또는 폴더가 이미 있어.'
          : result.error === 'BAD_NAME'
            ? '파일 이름에 경로나 사용할 수 없는 문자가 포함되어 있어.'
            : result.error || '만들지 못했어.';
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
      props.onNotice(`검색 결과 위치를 복사했어: ${location}`);
    } catch {
      props.onNotice('검색 결과 위치를 복사하지 못했어.');
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
          <ExplorerIcon size={16} /> <span>탐색기</span>
          <span className="files-title-tools">
            <button className="icon-btn" type="button" title="새 파일" aria-label="새 파일" onClick={() => void createEntry(folder, 'file')} disabled={!folder}><NewFileIcon size={14} /></button>
            <button className="icon-btn" type="button" title="새 폴더" aria-label="새 폴더" onClick={() => void createEntry(folder, 'folder')} disabled={!folder}><NewFolderIcon size={14} /></button>
            <button className="icon-btn" type="button" title="파일 목록 새로고침" aria-label="파일 목록 새로고침" onClick={props.onRefreshTree}><RefreshIcon size={14} /></button>
            <button className="icon-btn" type="button" title="폴더 모두 접기" aria-label="폴더 모두 접기" onClick={() => setCollapseVersion((v) => v + 1)}><CollapseIcon size={14} /></button>
          </span>
        </div>
      <button className="btn btn-block" onClick={onPickFolder} title={folder || '작업 폴더 열기'}>
        <FolderIcon size={14} /> <span>{folder || '폴더 열기'}</span>
      </button>
      {folder && (
        <>
          {pinnedFiles.length > 0 && (
            <div className="changed-section pinned-files-section">
              <button className="explorer-section-toggle changed-head" type="button" aria-expanded={sections.pinned} onClick={() => toggleSection('pinned')}>
                {sections.pinned ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                <StarIcon size={12} filled />
                <span>즐겨찾기 <span className="section-count">{pinnedFiles.length}</span></span>
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
                      <button className="icon-btn favorite-remove" type="button" title="즐겨찾기에서 제거" aria-label={`${name} 즐겨찾기에서 제거`} onClick={() => togglePinnedFile(path)}><StarIcon size={13} filled /></button>
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
                  <span>열린 파일 <span className="section-count">{openFiles.length}</span></span>
                </button>
                {openFiles.some((file) => !file.dirty) && <button
                  type="button"
                  className="icon-btn open-files-cleanup"
                  title={`저장된 파일 탭 닫기 (${openFiles.filter((file) => !file.dirty).length})`}
                  aria-label={`저장된 파일 탭 ${openFiles.filter((file) => !file.dirty).length}개 닫기`}
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
                        title={`${file.path}${file.dirty ? ' · 저장되지 않은 변경 사항' : ''}`}
                        onClick={() => onOpenFile(file.path)}
                      >
                        <FileTypeIcon size={15} name={file.name} />
                        <span className={duplicateName ? 'changed-file-label' : 'changed-name'}>
                          <span className="changed-name">{file.name}</span>
                          {duplicateName && <span className="favorite-file-path">{relativeDirectory(file.path)}</span>}
                        </span>
                        {file.dirty && <span className="open-file-dirty" title="저장되지 않은 변경 사항" aria-label="저장되지 않은 변경 사항" />}
                      </button>
                      <button
                        type="button"
                        className="icon-btn open-file-close"
                        title={`${file.name} 닫기${file.dirty ? ' · 변경 사항이 있어 확인을 요청할 수 있음' : ''}`}
                        aria-label={`${file.name} 파일 닫기${file.dirty ? ', 저장되지 않은 변경 사항 있음' : ''}`}
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
                <span>최근 파일 <span className="section-count">{recentInFolder.length}</span></span>
              </button>
              {sections.recent && <div className="changed-list">
                {recentInFolder.map((path) => {
                  const name = path.split(/[\\/]/).pop() || path;
                  const opened = openFiles.find((file) => normalizePinnedPath(file.path) === normalizePinnedPath(path));
                  const isActive = normalizePinnedPath(path) === normalizePinnedPath(activeFilePath);
                  return (
                    <button key={path} className={`changed-item${isActive ? ' active-file' : ''}`} aria-current={isActive ? 'page' : undefined} title={`${path}${opened?.dirty ? ' · 저장되지 않은 변경 사항' : ''}`} onClick={() => onOpenFile(path)}>
                      <FileTypeIcon size={15} name={name} />
                      <span className={visibleFileNameCounts.get(name.toLocaleLowerCase())! > 1 ? 'changed-file-label' : 'changed-name'}>
                        <span className="changed-name">{name}</span>
                        {visibleFileNameCounts.get(name.toLocaleLowerCase())! > 1 && <span className="favorite-file-path">{relativeDirectory(path)}</span>}
                      </span>
                      {opened && <span className={`quick-open-state${opened.dirty ? ' dirty' : isActive ? ' current' : ''}`}>{opened.dirty ? '수정됨' : isActive ? '현재' : '열림'}</span>}
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
                placeholder={searchMode === 'content' ? '프로젝트 파일 내용 검색…' : '프로젝트 파일 이름 검색…'}
                aria-label={searchMode === 'content' ? '프로젝트 파일 내용 검색' : '프로젝트 파일 이름 검색'}
                aria-controls="explorer-search-results"
                aria-activedescendant={searchResults.length ? `explorer-search-result-${selectedSearchResult}` : undefined}
                autoComplete="off"
                spellCheck={false}
              />
              {fileQuery && <button className="icon-btn" type="button" onClick={() => setFileQuery('')} title="검색 지우기" aria-label="검색 지우기"><XIcon size={13} /></button>}
              <button type="button" className="icon-btn explorer-search-history-toggle" aria-label="최근 검색어" title="이 프로젝트의 최근 검색어" aria-expanded={searchHistoryOpen} aria-controls="explorer-search-history" disabled={!searchHistory.length} onClick={() => setSearchHistoryOpen((open) => !open)}><ClockIcon size={13} /></button>
            </div>
            {searchHistoryOpen && <div className="explorer-search-history" id="explorer-search-history" role="listbox" aria-label="최근 파일 검색">
              {searchHistory.map((entry, index) => <button key={`${entry.mode}:${entry.query}:${index}`} type="button" role="option" aria-selected="false" onClick={() => restoreSearchQuery(entry)} title={entry.query}>
                <span>{entry.query}</span><small>{entry.mode === 'content' ? '내용' : '이름'}</small>
              </button>)}
            </div>}
          </div>
          <div className="explorer-search-mode" role="group" aria-label="검색 범위">
            <button type="button" className={searchMode === 'name' ? 'active' : ''} aria-pressed={searchMode === 'name'} onClick={() => props.onSearchModeChange('name')}>파일 이름</button>
            <button type="button" className={searchMode === 'content' ? 'active' : ''} aria-pressed={searchMode === 'content'} onClick={() => props.onSearchModeChange('content')}>파일 내용</button>
          </div>
          {searchMode === 'content' && <div className="explorer-search-options" role="group" aria-label="내용 검색 옵션">
            <button type="button" className={searchPreferences.caseSensitive ? 'active' : ''} aria-pressed={searchPreferences.caseSensitive} title="대소문자 구분" onClick={() => updateSearchPreferences({ caseSensitive: !searchPreferences.caseSensitive })}>Aa</button>
            <button type="button" className={searchPreferences.wholeWord ? 'active' : ''} aria-pressed={searchPreferences.wholeWord} title="단어 단위로 일치" onClick={() => updateSearchPreferences({ wholeWord: !searchPreferences.wholeWord })}>단어</button>
          </div>}
          <button type="button" className={searchPreferences.filtersOpen ? 'explorer-filter-toggle active' : 'explorer-filter-toggle'} aria-expanded={searchPreferences.filtersOpen} aria-controls="explorer-path-filters" onClick={() => updateSearchPreferences({ filtersOpen: !searchPreferences.filtersOpen })}>
            경로 필터{searchPreferences.include.trim() || searchPreferences.exclude.trim() ? ' · 적용 중' : ''}
          </button>
          {searchPreferences.filtersOpen && <div className="explorer-path-filters" id="explorer-path-filters">
            <label>
              <span>포함</span>
              <input value={searchPreferences.include} onChange={(event) => updateSearchPreferences({ include: event.target.value })} placeholder="예: src/**/*.ts, *.md" aria-label="포함할 파일 경로 패턴" spellCheck={false} />
            </label>
            <label>
              <span>제외</span>
              <input value={searchPreferences.exclude} onChange={(event) => updateSearchPreferences({ exclude: event.target.value })} placeholder="예: **/*.test.ts, **/generated/**" aria-label="제외할 파일 경로 패턴" spellCheck={false} />
            </label>
            <p>* 한 경로 조각 · ** 여러 폴더 · 쉼표로 여러 패턴</p>
          </div>}
        </>
      )}
      </div>
      {folder && (
        <div className="changed-section">
          <div className="changed-head">
            <button className="explorer-section-toggle" type="button" aria-expanded={sections.changed} onClick={() => toggleSection('changed')}>
              {sections.changed ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
              <span>변경 사항 <span className="section-count">{changedFiles.length}</span></span>
            </button>
            <button className="icon-btn" type="button" title="변경 목록 새로고침" aria-label="변경 목록 새로고침" onClick={() => { void refreshGitBranch(); onRefreshChanged(); }}>
              <RefreshIcon size={13} />
            </button>
            {changedFiles.length > 0 && (
              <button className="btn git-commit-open" type="button" title={stagedCount > 0 ? `스테이징된 ${stagedCount}개 파일 커밋` : '커밋하기 (스테이징된 변경 없음)'} onClick={() => { setCommitError(''); setCommitOpen(true); }}>
                커밋{stagedCount > 0 ? ` ${stagedCount}` : ''}
              </button>
            )}
          </div>
          <div className="git-remote-row">
            {gitBranch && (
              <span className="git-branch" title={gitBranch.remote || '원격 없음'} aria-label={`현재 브랜치 ${gitBranch.branch}`}>
                {gitBranch.branch}{gitBranch.ahead > 0 ? ` ↑${gitBranch.ahead}` : ''}{gitBranch.behind > 0 ? ` ↓${gitBranch.behind}` : ''}
              </span>
            )}
            {gitBranch && (
              <button className="mini-btn" type="button" title="풀 (가져오기)" aria-label="풀" disabled={!!gitSyncBusy} onClick={() => void doGitSync('pull')}>
                {gitSyncBusy === 'pull' ? '가져오는 중…' : '풀'}
              </button>
            )}
            {gitBranch && (
              <button className="mini-btn" type="button" title="푸시 (올리기)" aria-label="푸시" disabled={!!gitSyncBusy} onClick={() => void doGitSync('push')}>
                {gitSyncBusy === 'push' ? '올리는 중…' : '푸시'}
              </button>
            )}
            <button className="mini-btn" type="button" title="저장소 클론" aria-label="클론" onClick={() => { setCloneError(''); setCloneOpen(true); }}>
              클론
            </button>
          </div>
          {sections.changed && changedFiles.length === 0 ? (
            <div className="empty-note">변경된 파일 없음</div>
          ) : sections.changed ? (
            <div className="changed-list">
              {changedFiles.map((f) => {
                const kindKey = f.replace(/\\/g, '/').toLowerCase();
                const kind = changedKinds[kindKey] || 'M';
                const staged = changedStaged[kindKey] === true;
                return (
                  <div key={f} className="changed-row">
                    {kind !== 'C' && (
                      <button
                        type="button"
                        className={staged ? 'icon-btn stage-toggle on' : 'icon-btn stage-toggle'}
                        aria-pressed={staged}
                        title={staged ? '스테이징 해제' : '스테이징'}
                        aria-label={`${f} ${staged ? '스테이징 해제' : '스테이징'}`}
                        onClick={() => void toggleStaged(f, staged)}
                      >
                        {staged ? <CheckIcon size={13} /> : <PlusIcon size={13} />}
                      </button>
                    )}
                    <button
                      className="changed-item"
                      title={`${f} diff 보기`}
                      onClick={() => onOpenChanged(f)}
                    >
                      <FileTypeIcon size={15} name={f} />
                      <span className="changed-name">{f}</span>
                      <span className={`git-status-badge status-${kind.toLowerCase()}${staged ? ' is-staged' : ''}`} title={staged ? 'Git 상태 (스테이징됨)' : 'Git 상태'}>{kind}</span>
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
          <div className="modal-header"><h3 id="git-commit-title">커밋</h3></div>
          <div className="modal-body">
            <p className="modal-note">스테이징된 파일 {stagedCount}개가 커밋됩니다.</p>
            <label className="field">메시지
              <textarea value={commitMessage} disabled={commitBusy} onChange={(event) => { setCommitMessage(event.target.value); setCommitError(''); }} placeholder="커밋 메시지" aria-label="커밋 메시지" rows={3} aria-invalid={!!commitError} />
            </label>
            {commitError && <div className="tree-error explorer-entry-error" role="alert">{commitError}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn" type="button" disabled={commitBusy} onClick={() => setCommitOpen(false)}>취소</button>
            <button className="btn-primary" type="button" disabled={commitBusy || !normalizeCommitMessage(commitMessage).ok} onClick={() => void submitCommit()}>{commitBusy ? '커밋 중…' : '커밋'}</button>
          </div>
        </section>
      </div>}
      {cloneOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !cloneBusy) setCloneOpen(false); }}>
        <section className="modal git-clone-dialog" role="dialog" aria-modal="true" aria-labelledby="git-clone-title" tabIndex={-1} onKeyDown={(event) => {
          if (event.key === 'Escape' && !cloneBusy) { event.preventDefault(); setCloneOpen(false); }
        }}>
          <div className="modal-header"><h3 id="git-clone-title">저장소 클론</h3></div>
          <div className="modal-body">
            <label className="field">저장소 URL
              <input value={cloneUrl} disabled={cloneBusy} onChange={(event) => { setCloneUrl(event.target.value); setCloneError(''); }} placeholder="https:// 또는 로컬 경로" aria-label="저장소 URL" spellCheck={false} />
            </label>
            <label className="field">클론 폴더
              <input value={cloneTarget} disabled={cloneBusy} onChange={(event) => { setCloneTarget(event.target.value); setCloneError(''); }} placeholder="새 폴더 경로 (없어야 함)" aria-label="클론 폴더" spellCheck={false} />
            </label>
            {cloneError && <div className="tree-error explorer-entry-error" role="alert">{cloneError}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn" type="button" disabled={cloneBusy} onClick={() => setCloneOpen(false)}>취소</button>
            <button className="btn-primary" type="button" disabled={cloneBusy || !cloneUrl.trim() || !cloneTarget.trim()} onClick={() => void submitClone()}>{cloneBusy ? '클론 중…' : '클론'}</button>
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
                      {searchResults.length}{searchMode === 'content' ? '개 일치 항목' : '개 파일'}{searchTruncated ? ' 이상' : ''}
                      {` · ${selectedSearchResult + 1}/${searchResults.length}`}
                      {searchMode === 'content' && result.lineNumber ? ` · ${result.relativePath}:${result.lineNumber}` : ''}
                      . ↑↓ 이동 · Enter 열기 · Ctrl+Enter 고정 탭
                    </span>
                    <button
                      type="button"
                      className="icon-btn explorer-search-copy"
                      aria-label={`${result.relativePath}${result.lineNumber ? ` ${result.lineNumber}줄` : ''} 검색 결과 위치 복사`}
                      title="선택한 검색 결과 위치 복사"
                      onClick={() => void copySearchResultLocation(result)}
                    >
                      <CopyIcon size={13} />
                    </button>
                    <button
                      type="button"
                      className={isPinned ? 'icon-btn explorer-search-pin active' : 'icon-btn explorer-search-pin'}
                      aria-label={isPinned ? `${result.relativePath} 즐겨찾기 해제` : `${result.relativePath} 즐겨찾기 추가`}
                      aria-pressed={isPinned}
                      title={isPinned ? '선택한 검색 결과 즐겨찾기 해제' : '선택한 검색 결과 즐겨찾기에 추가'}
                      onClick={() => togglePinnedFile(result.path)}
                    >
                      <StarIcon size={13} filled={isPinned} />
                    </button>
                  </div>
                );
              })()}
            <div ref={searchResultsRef} id="explorer-search-results" className="explorer-search-results" role="listbox" aria-label="파일 검색 결과">
              {searching && searchResults.length === 0 ? <div className="tree-loading">{searchMode === 'content' ? '파일 내용을 찾는 중…' : '파일을 찾는 중…'}</div>
                : searchError ? <div className="tree-error">{searchError}</div>
                  : searchResults.length === 0 ? <div className="tree-loading">{searchMode === 'content' ? '일치하는 내용이 없어.' : '일치하는 파일이 없어.'}</div>
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
              {searchTruncated && <div className="explorer-search-note">검색 범위가 커서 일부 파일이나 결과가 생략됐어. 검색어를 더 구체적으로 입력해줘.</div>}
            </div>
          ) : (
            <FileTree root={folder} version={treeVersion} collapseVersion={collapseVersion} changedFiles={changedFiles} changedKinds={changedKinds} activeFilePath={activeFilePath} activeView={props.active} pinnedFilePaths={pinnedFilePaths} onTogglePinned={togglePinnedFile} onCreateEntry={createEntry} onRequestRename={requestRenameEntry} onRequestDelete={requestDeleteEntry} onNotice={props.onNotice} onOpenFile={onOpenFile} onOpenTerminalAt={props.onOpenTerminalAt} />
          )
        ) : (
          <div className="empty-note">작업 폴더를 열면 파일 트리가 표시됩니다.</div>
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
          <div className="modal-header"><h3 id="explorer-entry-title">{entryDialog.mode === 'rename' ? '이름 변경' : entryDialog.mode === 'delete' ? '휴지통으로 이동' : entryDialog.mode === 'create-file' ? '새 파일' : '새 폴더'}</h3></div>
          <div className="modal-body">
            {entryDialog.mode === 'delete' ? <p className="modal-note">{entryDialog.isDir ? '폴더와 내부 항목' : '파일'} <code>{entryDialog.name}</code>을(를) 휴지통으로 옮길게. 필요하면 휴지통에서 복원할 수 있어.</p> : <label className="field">이름
              <input ref={entryNameRef} value={entryDialog.name} disabled={entryDialogBusy} onChange={(event) => { setEntryDialog({ ...entryDialog, name: event.target.value }); setEntryDialogError(''); }} autoComplete="off" spellCheck={false} aria-invalid={!!entryDialogError} />
            </label>}
            {entryDialogError && <div className="tree-error explorer-entry-error" role="alert">{entryDialogError}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn" type="button" disabled={entryDialogBusy} onClick={() => closeEntryDialog()}>취소</button>
            <button className={entryDialog.mode === 'delete' ? 'btn-danger' : 'btn-primary'} type="button" disabled={entryDialogBusy || (entryDialog.mode !== 'delete' && !entryDialog.name.trim())} onClick={() => void submitEntryDialog()}>{entryDialogBusy ? '처리 중…' : entryDialog.mode === 'delete' ? '휴지통으로 이동' : entryDialog.mode === 'rename' ? '이름 변경' : '만들기'}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}
