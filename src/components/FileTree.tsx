import React, { useEffect, useId, useRef, useState } from 'react';
import type { FileEntry, GitStatusKind } from '../types';
import { api, hasBridge } from '../lib/mudex';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, FileTypeIcon, FolderIcon, getFileTypeDescription, NewFileIcon, NewFolderIcon, PencilIcon, PlusIcon, StarIcon, TerminalIcon, TrashIcon } from './icons';

const sortEntries = (entries: FileEntry[]) => [...entries].sort((a, b) => {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
});

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const expandedFoldersKey = (root: string) => `mudex:explorer-expanded:v1:${normalizePath(root)}`;

function readExpandedFolders(root: string): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(expandedFoldersKey(root)) || '[]');
    return new Set(Array.isArray(stored) ? stored.filter((path): path is string => typeof path === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveFolderExpansion(root: string, path: string, expanded: boolean) {
  try {
    const folders = readExpandedFolders(root);
    const normalized = normalizePath(path);
    if (expanded) folders.add(normalized);
    else folders.delete(normalized);
    localStorage.setItem(expandedFoldersKey(root), JSON.stringify([...folders].slice(-500)));
  } catch {
    // Explorer state is a convenience; storage may be unavailable or full.
  }
}

function TreeNode({
  entry,
  depth,
  position,
  setSize,
  version,
  collapseVersion,
  focusedPath,
  setFocusedPath,
  root,
  changedFiles,
  changedKinds,
  activeFilePath,
  activeView,
  pinnedFilePaths,
  onTogglePinned,
  onCreateEntry,
  onRequestRename,
  onRequestDelete,
  onNotice,
  onOpenFile,
  onOpenTerminalAt,
}: {
  entry: FileEntry;
  depth: number;
  position: number;
  setSize: number;
  version: number;
  collapseVersion: number;
  focusedPath: string | null;
  setFocusedPath: (path: string) => void;
  root: string;
  changedFiles: string[];
  changedKinds: Record<string, GitStatusKind>;
  activeFilePath: string;
  activeView: boolean;
  pinnedFilePaths: string[];
  onTogglePinned: (filePath: string) => void;
  onCreateEntry: (dirPath: string, kind: 'file' | 'folder') => Promise<void>;
  onRequestRename: (entry: FileEntry) => void;
  onRequestDelete: (entry: FileEntry) => void;
  onNotice: (message: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenTerminalAt: (dirPath: string) => void;
}) {
  const [open, setOpen] = useState(() => entry.isDir && readExpandedFolders(root).has(normalizePath(entry.path)));
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const childGroupId = useId();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const focusFirstChildOnOpenRef = useRef(false);
  const initialCollapseVersion = useRef(collapseVersion);
  const setDirectoryOpen = (expanded: boolean) => {
    if (!expanded) focusFirstChildOnOpenRef.current = false;
    setOpen(expanded);
    if (entry.isDir) saveFolderExpansion(root, entry.path, expanded);
  };
  const relativePath = normalizePath(entry.path).slice(normalizePath(root).length).replace(/^\/+/, '');
  const rootPath = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const displayRelativePath = entry.path.replace(/\\/g, '/').slice(rootPath.length).replace(/^\/+/, '');
  const changedPath = changedFiles.find((file) => {
    const changedPath = normalizePath(file).replace(/^\/+/, '');
    return changedPath === relativePath || (entry.isDir && changedPath.startsWith(`${relativePath}/`));
  });
  const directKind = changedKinds[relativePath];
  const changeKind = directKind || (changedPath ? changedKinds[normalizePath(changedPath).replace(/^\/+/, '')] : undefined);
  const isActiveFile = !entry.isDir && !!activeFilePath && normalizePath(entry.path) === normalizePath(activeFilePath);
  const isPinned = !entry.isDir && pinnedFilePaths.includes(normalizePath(entry.path));
  const entryDirectory = (() => {
    if (entry.isDir) return entry.path;
    const separatorIndex = Math.max(entry.path.lastIndexOf('/'), entry.path.lastIndexOf('\\'));
    if (separatorIndex < 0) return root;
    if (separatorIndex === 2 && entry.path[1] === ':') return entry.path.slice(0, 3);
    return entry.path.slice(0, separatorIndex) || root;
  })();
  const openMenu = () => {
    setMenuOpen(true);
    scheduleAfterPaint(() => rowRef.current?.closest('.tree-node-wrap')?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  };

  useEffect(() => {
    if (initialCollapseVersion.current === collapseVersion) return;
    initialCollapseVersion.current = collapseVersion;
    setDirectoryOpen(false);
  }, [collapseVersion]);

  useEffect(() => {
    if (entry.isDir) setOpen(readExpandedFolders(root).has(normalizePath(entry.path)));
  }, [root, entry.path, entry.isDir]);

  useEffect(() => {
    if (isActiveFile && activeView) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isActiveFile, activeView]);

  useEffect(() => {
    if (!entry.isDir) return;
    setChildren(null);
    setError('');
  }, [version, entry.isDir, entry.path]);

  useEffect(() => {
    if (!entry.isDir || !open || !focusFirstChildOnOpenRef.current || children === null) return;
    if (error) {
      focusFirstChildOnOpenRef.current = false;
      return;
    }
    return scheduleAfterPaint(() => {
      if (!focusFirstChildOnOpenRef.current) return;
      focusFirstChildOnOpenRef.current = false;
      rowRef.current?.closest('.tree-node-wrap')?.querySelector<HTMLElement>(':scope > [role="group"] [role="treeitem"]')?.focus();
    });
  }, [children, entry.isDir, error, open]);

  useEffect(() => {
    if (!entry.isDir || !open) return;
    let cancelled = false;
    setError('');
    api().listDir(entry.path).then((res) => {
      if (cancelled) return;
      if (res.ok) setChildren(sortEntries(res.entries || []));
      else setError(res.error || '읽기 실패');
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => { cancelled = true; };
  }, [version, open, entry.isDir, entry.path]);

  useEffect(() => {
    if (!entry.isDir || !open || !hasBridge()) return;
    void api().watchDirectory(root, entry.path).catch(() => {});
    return () => { void api().unwatchDirectory(root, entry.path).catch(() => {}); };
  }, [root, entry.isDir, entry.path, open]);

  useEffect(() => {
    if (!entry.isDir || !activeFilePath) return;
    const dir = normalizePath(entry.path);
    const target = normalizePath(activeFilePath);
    if (target === dir || !target.startsWith(`${dir}/`)) return;
    setDirectoryOpen(true);
  }, [activeFilePath, entry.isDir, entry.path]);

  const toggle = () => {
    if (!entry.isDir) {
      onOpenFile(entry.path);
      return;
    }
    if (open) {
      setDirectoryOpen(false);
      return;
    }
    setDirectoryOpen(true);
  };

  const moveFocus = (direction: 1 | -1) => {
    const tree = document.activeElement?.closest('[role="tree"]');
    if (!tree) return;
    const rows = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const currentIndex = rows.indexOf(document.activeElement as HTMLElement);
    rows[currentIndex + direction]?.focus();
  };

  const focusParent = (row: HTMLElement) => {
    const parentGroup = row.parentElement?.parentElement?.closest('[role="group"]');
    parentGroup?.parentElement?.querySelector<HTMLElement>(':scope > .tree-row-wrap > [role="treeitem"]')?.focus();
  };

  return (
    <div className="tree-node-wrap" onMouseLeave={() => setMenuOpen(false)}>
      <div className="tree-row-wrap">
        <div
        ref={rowRef}
        role="treeitem"
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Enter F2 Delete"
        aria-expanded={entry.isDir ? open : undefined}
        aria-controls={entry.isDir && open ? childGroupId : undefined}
        aria-level={depth + 1}
        aria-posinset={position}
        aria-setsize={setSize}
        aria-current={isActiveFile ? 'page' : undefined}
        aria-label={entry.isDir ? `${entry.name}, 폴더` : `${entry.name}, ${getFileTypeDescription(entry.name)}`}
        data-file-path={entry.path}
        tabIndex={focusedPath === entry.path || (focusedPath === null && depth === 0) ? 0 : -1}
        className={isActiveFile ? 'tree-row active-file' : 'tree-row'}
        draggable={!entry.isDir}
        style={{ paddingLeft: 8 + depth * 14 }}
        onDragStart={(event) => {
          if (entry.isDir) return;
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('application/x-musician-file-path', displayRelativePath || entry.name);
        }}
        onClick={toggle}
        onContextMenu={(event) => {
          event.preventDefault();
          setFocusedPath(entry.path);
          openMenu();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void toggle();
          } else if (e.key === 'F2') {
            e.preventDefault();
            onRequestRename(entry);
          } else if (e.key === 'Delete') {
            e.preventDefault();
            onRequestDelete(entry);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            moveFocus(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveFocus(-1);
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            const tree = e.currentTarget.closest('[role="tree"]');
            const rows = tree?.querySelectorAll<HTMLElement>('[role="treeitem"]');
            (e.key === 'Home' ? rows?.[0] : rows?.[rows.length - 1])?.focus();
          } else if (e.key === 'ArrowRight' && entry.isDir) {
            e.preventDefault();
            if (!open || children === null) {
              focusFirstChildOnOpenRef.current = true;
              if (!open) setDirectoryOpen(true);
            } else {
              e.currentTarget.closest('.tree-node-wrap')?.querySelector<HTMLElement>(':scope > [role="group"] > .tree-node-wrap > .tree-row-wrap > [role="treeitem"]')?.focus();
            }
          } else if (e.key === 'ArrowLeft' && entry.isDir) {
            e.preventDefault();
            if (open) setDirectoryOpen(false);
            else focusParent(e.currentTarget);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            focusParent(e.currentTarget);
          } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault();
            openMenu();
          }
        }}
        onFocus={() => setFocusedPath(entry.path)}
        title={entry.isDir ? entry.path : `${entry.path} · ${getFileTypeDescription(entry.name)}`}
      >
        {entry.isDir ? (
          open ? (
            <ChevronDownIcon size={13} />
          ) : (
            <ChevronRightIcon size={13} />
          )
        ) : (
          <span className="tree-spacer" />
        )}
        {entry.isDir ? <FolderIcon size={15} open={open} className="tree-folder-icon" /> : <FileTypeIcon size={17} name={entry.name} />}
        <span className="tree-name">{entry.name}</span>
        {changeKind && <span className={`tree-change-indicator status-${changeKind.toLowerCase()}${entry.isDir && !directKind ? ' directory' : ''}`} title={`Git ${changeKind} 상태`} aria-label={`Git ${changeKind} 상태`}>{entry.isDir && !directKind ? '•' : changeKind}</span>}
      </div>
        <button
          type="button"
          className="icon-btn tree-node-menu-trigger"
          title={`${entry.name} 작업`}
          aria-label={`${entry.name} 작업`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => { if (menuOpen) setMenuOpen(false); else openMenu(); }}
        >
          <PlusIcon size={13} />
        </button>
      </div>
      {menuOpen && (
        <div className="tree-node-menu" role="menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
          e.stopPropagation();
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
          const activeIndex = items.indexOf(document.activeElement as HTMLElement);
          if (e.key === 'Escape') {
            e.preventDefault();
            setMenuOpen(false);
            e.currentTarget.closest('.tree-node-wrap')?.querySelector<HTMLElement>(':scope > .tree-row-wrap > [role="treeitem"]')?.focus();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const direction = e.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = activeIndex < 0
              ? (direction > 0 ? 0 : items.length - 1)
              : (activeIndex + direction + items.length) % items.length;
            items[nextIndex]?.focus();
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            (e.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
          }
        }}>
          {entry.isDir && <button role="menuitem" onClick={() => { setMenuOpen(false); void onCreateEntry(entry.path, 'file'); }}><NewFileIcon size={13} /> 새 파일</button>}
          {entry.isDir && <button role="menuitem" onClick={() => { setMenuOpen(false); void onCreateEntry(entry.path, 'folder'); }}><NewFolderIcon size={13} /> 새 폴더</button>}
          {!entry.isDir && <button role="menuitem" onClick={() => { setMenuOpen(false); onTogglePinned(entry.path); }}><StarIcon size={13} filled={isPinned} /> {isPinned ? '즐겨찾기에서 제거' : '즐겨찾기에 고정'}</button>}
          <button role="menuitem" onClick={() => {
            setMenuOpen(false);
            onRequestRename(entry);
          }}><PencilIcon size={13} /> 이름 변경</button>
          <button role="menuitem" onClick={() => {
            setMenuOpen(false);
            void navigator.clipboard.writeText(entry.path).then(() => onNotice('파일 경로를 복사했어.')).catch(() => onNotice('경로를 복사하지 못했어.'));
          }}><CopyIcon size={13} /> 전체 경로 복사</button>
          <button role="menuitem" onClick={() => {
            setMenuOpen(false);
            void navigator.clipboard.writeText(displayRelativePath || entry.name).then(() => onNotice('상대 경로를 복사했어.')).catch(() => onNotice('상대 경로를 복사하지 못했어.'));
          }}><CopyIcon size={13} /> 상대 경로 복사</button>
          <button role="menuitem" onClick={() => { setMenuOpen(false); onOpenTerminalAt(entryDirectory); }}><TerminalIcon size={13} /> {entry.isDir ? '여기서 터미널 열기' : '포함 폴더에서 터미널 열기'}</button>
          <button role="menuitem" onClick={() => {
            setMenuOpen(false);
            void api().revealEntry(root, entry.path).then((result) => {
              onNotice(result.ok ? '파일 위치를 열었어.' : `위치를 열지 못했어: ${result.error || '알 수 없는 오류'}`);
            }).catch((error: unknown) => onNotice(error instanceof Error ? error.message : String(error)));
          }}><FolderIcon size={13} className="tree-folder-icon" /> 위치 열기</button>
          <button className="tree-node-delete" role="menuitem" onClick={() => {
            setMenuOpen(false);
            onRequestDelete(entry);
          }}><TrashIcon size={13} /> 삭제</button>
        </div>
      )}
      {entry.isDir && open && (
        <div id={childGroupId} role="group" aria-label={`${entry.name} 폴더 항목`} aria-busy={children === null && !error}>
          {error && <div className="tree-error">{error}</div>}
          {children === null && !error && <div className="tree-loading">불러오는 중…</div>}
          {children !== null && children.length === 0 && <div className="tree-loading">비어 있음</div>}
          {(children || []).map((c, index) => (
            <TreeNode key={c.path} entry={c} depth={depth + 1} position={index + 1} setSize={children?.length || 0} version={version} collapseVersion={collapseVersion} focusedPath={focusedPath} setFocusedPath={setFocusedPath} root={root} changedFiles={changedFiles} changedKinds={changedKinds} activeFilePath={activeFilePath} activeView={activeView} pinnedFilePaths={pinnedFilePaths} onTogglePinned={onTogglePinned} onCreateEntry={onCreateEntry} onRequestRename={onRequestRename} onRequestDelete={onRequestDelete} onNotice={onNotice} onOpenFile={onOpenFile} onOpenTerminalAt={onOpenTerminalAt} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileTree({
  root,
  version,
  collapseVersion,
  onCreateEntry,
  onRequestRename,
  onRequestDelete,
  onNotice,
  onOpenFile,
  onOpenTerminalAt,
  changedFiles = [],
  changedKinds = {},
  activeFilePath = '',
  activeView = true,
  pinnedFilePaths = [],
  onTogglePinned = () => {},
}: {
  root: string;
  version: number;
  collapseVersion: number;
  onCreateEntry: (dirPath: string, kind: 'file' | 'folder') => Promise<void>;
  onRequestRename: (entry: FileEntry) => void;
  onRequestDelete: (entry: FileEntry) => void;
  onNotice: (message: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenTerminalAt: (dirPath: string) => void;
  changedFiles?: string[];
  changedKinds?: Record<string, GitStatusKind>;
  activeFilePath?: string;
  activeView?: boolean;
  pinnedFilePaths?: string[];
  onTogglePinned?: (filePath: string) => void;
}) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState('');
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const typeAheadRef = useRef({ query: '', at: 0 });

  useEffect(() => {
    if (!root || !hasBridge()) return;
    void api().watchDirectory(root, root).catch(() => {});
    return () => { void api().unwatchDirectory(root, root).catch(() => {}); };
  }, [root]);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError('');
    if (!hasBridge()) {
      setError('Electron 앱에서 실행해야 파일에 접근할 수 있습니다.');
      return;
    }
    api()
      .listDir(root)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setEntries(sortEntries(res.entries || []));
        else setError(res.error || '읽기 실패');
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [root, version]);

  useEffect(() => setFocusedPath(null), [root, version]);

  if (error) return <div className="tree-error">{error}</div>;
  if (entries === null) return <div className="tree-loading">불러오는 중…</div>;
  if (entries.length === 0) return <div className="tree-loading">비어 있음</div>;
  return (
    <div role="tree" onKeyDown={(event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1 || /\s/.test(event.key)) return;
      const current = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="treeitem"]') : null;
      if (!current) return;
      const now = Date.now();
      const previous = typeAheadRef.current;
      const key = event.key.toLocaleLowerCase();
      const query = now - previous.at > 700 || previous.query === key ? key : previous.query + key;
      typeAheadRef.current = { query, at: now };
      const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
      const start = rows.indexOf(current);
      for (let offset = 1; offset <= rows.length; offset += 1) {
        const row = rows[(start + offset) % rows.length];
        const label = row.querySelector<HTMLElement>('.tree-name')?.textContent?.trim().toLocaleLowerCase() || '';
        if (label.startsWith(query)) {
          event.preventDefault();
          row.focus();
          return;
        }
      }
    }}>
      {entries.map((e, index) => (
        <TreeNode key={e.path} entry={e} depth={0} position={index + 1} setSize={entries.length} version={version} collapseVersion={collapseVersion} focusedPath={focusedPath} setFocusedPath={setFocusedPath} root={root} changedFiles={changedFiles} changedKinds={changedKinds} activeFilePath={activeFilePath} activeView={activeView} pinnedFilePaths={pinnedFilePaths} onTogglePinned={onTogglePinned} onCreateEntry={onCreateEntry} onRequestRename={onRequestRename} onRequestDelete={onRequestDelete} onNotice={onNotice} onOpenFile={onOpenFile} onOpenTerminalAt={onOpenTerminalAt} />
      ))}
    </div>
  );
}
