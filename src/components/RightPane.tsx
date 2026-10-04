import React, { Suspense, useEffect, useRef, useState } from 'react';
import type { BrowserShortcut, EditorApi, GitStatusKind, PaneTab, PaneTabKind } from '../types';
import type { BrowserBookmark } from '../lib/browser-bookmarks.mjs';
import { api, hasBridge } from '../lib/mudex';
import { parseEditorPosition } from '../lib/editor-position.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { pathsEqual } from '../lib/path-utils.mjs';
import { unpinnedPaneTabIds } from '../lib/pane-tab-management.mjs';
import BrowserTab from './BrowserTab';
import FilesTab from './FilesTab';
import { ChatIcon, FileIcon, FileTypeIcon, FolderIcon, GlobeIcon, PinIcon, PlusIcon, SaveIcon, TerminalIcon, WrapLinesIcon, XIcon } from './icons';

const FileEditor = React.lazy(() => import('./FileEditor'));
const TerminalTab = React.lazy(() => import('./TerminalTab'));

interface Props {
  tabs: PaneTab[];
  activeId: string;
  monacoTheme: string;
  dark: boolean;
  folder: string;
  treeVersion: number;
  onRefreshTree: () => void;
  changedFiles: string[];
  changedKinds: Record<string, GitStatusKind>;
  changedStaged: Record<string, boolean>;
  recentFiles: string[];
  home: string;
  agentEnabled: boolean;
  paneActive: boolean;
  editorApiRef: { current: EditorApi | null };
  goToLineRequest: number;
  onRequestGoToLine: () => void;
  wordWrap: boolean;
  editorFontSize: number;
  onSelectTab: (id: string) => void;
  onBackToChat: () => void;
  onReorderTabs: (fromId: string, toId: string) => void;
  onToggleTabPinned: (tabId: string) => void;
  onSwitchTab: (mode: 'recent-next' | 'recent-previous' | 'ordered-left' | 'ordered-right') => void;
  onCloseTab: (id: string) => void;
  onCloseTabs: (ids: string[]) => void;
  onNewTab: (kind: PaneTabKind) => void;
  onPickFileTab: () => void;
  onFileChange: (id: string, content: string) => void;
  onFileSave: (id: string) => void;
  onOpenFileExternal: (path: string) => void;
  onSaveAllFiles: () => void;
  savingAllFiles: boolean;
  onToggleWordWrap: () => void;
  onChangeEditorFontSize: (delta: -1 | 1) => void;
  onReloadFile: (id: string) => void;
  onFileToggleDiff: (id: string) => void;
  onSearchSelection: () => void;
  onCursorLocationChange: (path: string, line: number, column: number) => void;
  canNavigateEditorBack: boolean;
  canNavigateEditorForward: boolean;
  onNavigateEditorBack: () => void;
  onNavigateEditorForward: () => void;
  editorNavigationEntries: Array<{ path: string; line: number; column: number }>;
  editorNavigationIndex: number;
  editorNavigationBookmarks: Array<{ path: string; line: number; column: number }>;
  onNavigateEditorToLocation: (location: { path: string; line: number; column: number }) => void;
  onToggleEditorLocationBookmark: (location: { path: string; line: number; column: number }) => void;
  onOpenFile: (filePath: string, pinned?: boolean) => void;
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
  onRenameEntry: (entryPath: string, newName: string) => Promise<boolean>;
  onDeleteEntry: (entryPath: string, isDir: boolean) => Promise<boolean>;
  onBrowserTitle: (id: string, title: string) => void;
  onBrowserUrl: (id: string, url: string) => void;
  onBrowserAppShortcut: (shortcut: BrowserShortcut) => void;
  parkBrowser: boolean;
  bookmarks: BrowserBookmark[];
  onToggleBookmark: (tabId: string, url: string) => void;
  onTermShell: (id: string, shell: 'powershell' | 'cmd') => void;
  onNotice: (msg: string) => void;
}

function TabIcon({ tab }: { tab: PaneTab }) {
  const { kind } = tab;
  if (kind === 'browser') return <GlobeIcon size={13} />;
  if (kind === 'files') return <FolderIcon size={13} />;
  if (kind === 'terminal') return <TerminalIcon size={13} />;
  return <FileTypeIcon size={14} name={tab.file?.path || tab.title} />;
}

// Browser-like right panel: a tab strip with [+] plus one content view
// per tab. All tabs stay mounted (terminals keep running, editors keep
// state); only the selected one is shown.
export default function RightPane(props: Props) {
  const { tabs, activeId } = props;
  const selectedFileTab = tabs.find((tab) => tab.id === activeId && tab.kind === 'file' && tab.file);
  const dirtyFileCount = tabs.filter((tab) => tab.kind === 'file' && tab.file?.dirty && !tab.file.readOnly).length;
  const fileNameCounts = new Map<string, number>();
  tabs.forEach((tab) => {
    if (tab.kind !== 'file' || !tab.file) return;
    const key = tab.file.name.toLowerCase();
    fileNameCounts.set(key, (fileNameCounts.get(key) || 0) + 1);
  });
  const openFilePaths = tabs.filter((tab) => tab.kind === 'file' && tab.file).map((tab) => tab.file!.path);
  const openFileSignature = openFilePaths.join('\0');
  const [lastActiveFilePath, setLastActiveFilePath] = useState(selectedFileTab?.file?.path || '');
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineValue, setGoToLineValue] = useState('');
  const goToLineInputRef = useRef<HTMLInputElement | null>(null);
  const tabContextMenuRef = useRef<HTMLDivElement | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabNodesRef = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (selectedFileTab?.file) {
      setLastActiveFilePath(selectedFileTab.file.path);
      return;
    }
    setLastActiveFilePath((current) => openFilePaths.includes(current) ? current : (openFilePaths[openFilePaths.length - 1] || ''));
  }, [selectedFileTab?.id, selectedFileTab?.file?.path, openFileSignature]);

  useEffect(() => {
    if (tabContextMenu) tabContextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [tabContextMenu]);

  useEffect(() => {
    if (!props.goToLineRequest) return;
    if (!selectedFileTab?.file) {
      props.onNotice('먼저 코드 파일 탭을 선택해줘.');
      return;
    }
    setGoToLineValue('');
    setGoToLineOpen(true);
  }, [props.goToLineRequest]);

  useEffect(() => {
    if (goToLineOpen) goToLineInputRef.current?.focus();
  }, [goToLineOpen]);

  const submitGoToLine = (event: React.FormEvent) => {
    event.preventDefault();
    const position = parseEditorPosition(goToLineValue);
    if (!position) {
      props.onNotice('줄 번호 또는 줄:열 형식으로 입력해줘. 예: 42 또는 42:8');
      return;
    }
    const editorApi = props.editorApiRef.current;
    const moved = !!editorApi && !!selectedFileTab?.file?.path && pathsEqual(editorApi.filePath, selectedFileTab.file.path)
      && editorApi.revealLine(position.line, position.column);
    if (!moved) props.onNotice('줄 위치로 이동하지 못했어. 파일이 아직 열리는 중인지 확인해줘.');
    setGoToLineOpen(false);
  };

  useEffect(() => {
    tabStripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  const newTab = (kind: PaneTabKind) => {
    setMenuOpen(false);
    props.onNewTab(kind);
  };

  const closeFromMenu = (ids: string[]) => {
    setTabContextMenu(null);
    props.onCloseTabs(ids);
  };

  const closeTabContextMenu = () => {
    const tabId = tabContextMenu?.tabId;
    setTabContextMenu(null);
    if (tabId) scheduleAfterPaint(() => tabNodesRef.current.get(tabId)?.focus({ preventScroll: true }));
  };

  const copyTabPath = async (tab: PaneTab) => {
    closeTabContextMenu();
    if (tab.kind !== 'file' || !tab.file) return;
    try {
      await navigator.clipboard.writeText(tab.file.path);
      props.onNotice('파일 경로를 복사했어.');
    } catch {
      props.onNotice('파일 경로를 복사하지 못했어.');
    }
  };

  const revealTabFile = async (tab: PaneTab) => {
    closeTabContextMenu();
    if (tab.kind !== 'file' || !tab.file) return;
    if (!hasBridge()) {
      props.onNotice('파일 위치 열기는 데스크톱 앱에서 사용할 수 있어.');
      return;
    }
    try {
      const result = await api().revealEntry(props.folder, tab.file.path);
      props.onNotice(result.ok ? '파일 위치를 파일 탐색기에서 열었어.' : (result.error || '파일 위치를 열지 못했어.'));
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const openTabContextMenu = (tabId: string, x: number, y: number) => {
    props.onSelectTab(tabId);
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const target = tabs[index];
    const hasSavedFiles = tabs.some((tab) => tab.kind === 'file' && tab.file && (!tab.file.dirty || tab.file.readOnly));
    const itemCount = 1 + Number(tabs.length > 1) + Number(index < tabs.length - 1) + Number(tabs.length > 1)
      + Number(hasSavedFiles) + (target?.kind === 'file' && target.file ? 2 : 0);
    const menuHeight = itemCount * 36 + 10;
    setTabContextMenu({
      tabId,
      x: Math.max(8, Math.min(x, window.innerWidth - 220)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight)),
    });
  };

  return (
    <div className="right-pane" style={{ flex: '1 1 0', minWidth: 0 }}>
      <div className="strip">
        {goToLineOpen && <form className="go-to-line-popover" onSubmit={submitGoToLine}>
          <label htmlFor="go-to-line-input">줄로 이동</label>
          <input
            ref={goToLineInputRef}
            id="go-to-line-input"
            aria-label="줄 번호"
            inputMode="numeric"
            pattern="[0-9]+(:[0-9]+)?"
            placeholder="줄 또는 줄:열 (예: 42:8)"
            value={goToLineValue}
            onChange={(event) => setGoToLineValue(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setGoToLineOpen(false); }}
          />
          <span>Enter 이동 · Esc 닫기</span>
          <button type="button" className="icon-btn" aria-label="줄 이동 닫기" onClick={() => setGoToLineOpen(false)}><XIcon size={12} /></button>
        </form>}
        <button className="icon-btn strip-chat-return" type="button" onClick={props.onBackToChat} title="채팅으로 돌아가기" aria-label="채팅으로 돌아가기">
          <ChatIcon size={14} />
        </button>
        <div ref={tabStripRef} className="strip-tabs" role="tablist" aria-label="오른쪽 패널 탭">
          {tabs.map((t, tabIndex) => {
            const dirty = t.kind === 'file' && t.file && t.file.dirty && !t.file.readOnly;
            const duplicateFileName = t.kind === 'file' && t.file && (fileNameCounts.get(t.file.name.toLowerCase()) || 0) > 1;
            const parentFolder = duplicateFileName && t.file
              ? t.file.path.replace(/[\\/]+$/, '').split(/[\\/]/).slice(-2, -1)[0]
              : '';
            return (
              <div
                key={t.id}
                role="presentation"
                className={`${t.id === activeId ? 'ptab-shell active' : 'ptab-shell'}${t.pinned ? ' pinned' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', t.id);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  props.onReorderTabs(e.dataTransfer.getData('text/plain'), t.id);
                }}
              >
                <div
                  ref={(node) => {
                    if (node) tabNodesRef.current.set(t.id, node);
                    else tabNodesRef.current.delete(t.id);
                  }}
                  role="tab"
                  id={`pane-tab-${t.id}`}
                  aria-controls={`pane-panel-${t.id}`}
                  aria-selected={t.id === activeId}
                  aria-posinset={tabIndex + 1}
                  aria-setsize={tabs.length}
                  aria-haspopup="menu"
                  aria-expanded={tabContextMenu?.tabId === t.id}
                  aria-label={`${t.title}${parentFolder ? `, ${parentFolder} 폴더` : ''}${dirty ? ', 저장하지 않은 변경' : ''}${t.file?.diskState === 'changed' ? ', 디스크에서 변경됨' : t.file?.diskState === 'missing' ? ', 디스크에서 삭제됨' : t.file?.diskState === 'unavailable' ? ', 파일을 불러올 수 없음' : ''}`}
                  tabIndex={t.id === activeId ? 0 : -1}
                  className={`${t.id === activeId ? 'ptab active' : 'ptab'}${t.pinned ? ' pinned' : ''}`}
                  title={`${t.kind === 'file' && t.file ? t.file.path : t.title}${dirty ? ' · 저장되지 않은 변경' : ''}${t.file?.diskState === 'changed' ? ' · 디스크에서 변경됨' : t.file?.diskState === 'missing' ? ' · 디스크에서 삭제됨' : t.file?.diskState === 'unavailable' ? ' · 파일을 불러올 수 없음' : ''}`}
                  onClick={(e) => { e.currentTarget.focus(); props.onSelectTab(t.id); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openTabContextMenu(t.id, e.clientX, e.clientY);
                  }}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    props.onCloseTab(t.id);
                  }}
                  onKeyDown={(e) => {
                  const moveTo = (nextIndex: number) => {
                    e.preventDefault();
                    const rows = Array.from(e.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLElement>('[role="tab"]') || []);
                    rows[nextIndex]?.focus();
                    props.onSelectTab(tabs[nextIndex].id);
                  };
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    props.onSelectTab(t.id);
                  } else if (e.key === 'ArrowRight' && tabs.length > 1 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    moveTo((tabIndex + 1) % tabs.length);
                  } else if (e.key === 'ArrowLeft' && tabs.length > 1 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    moveTo((tabIndex - 1 + tabs.length) % tabs.length);
                  } else if (e.key === 'Home' && tabs.length) {
                    moveTo(0);
                  } else if (e.key === 'End' && tabs.length) {
                    moveTo(tabs.length - 1);
                  } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    openTabContextMenu(t.id, rect.left, rect.bottom + 4);
                  }
                  }}
                >
                  <TabIcon tab={t} />
                  <span className="ptab-title">
                    {t.pinned && <PinIcon size={11} />}{dirty && <span className="dirty-dot" />}{t.file?.diskState && <span className={`disk-state-dot ${t.file.diskState}`} />}{t.title}
                    {parentFolder && <span className="ptab-path" aria-hidden="true">{parentFolder}</span>}
                  </span>
                </div>
                <button
                  className="icon-btn ptab-x"
                  title="탭 닫기 (Ctrl+W)"
                  aria-label={`${t.title} 탭 닫기`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCloseTab(t.id);
                  }}
                >
                  <XIcon size={12} />
                </button>
              </div>
            );
          })}
        </div>
        {dirtyFileCount > 0 && <button className="icon-btn" type="button" disabled={props.savingAllFiles} aria-busy={props.savingAllFiles} title={props.savingAllFiles ? '변경 파일을 저장하는 중…' : `변경된 파일 ${dirtyFileCount}개 모두 저장 (Ctrl+Shift+S)`} aria-label={props.savingAllFiles ? '변경 파일 저장 중' : `변경된 파일 ${dirtyFileCount}개 모두 저장`} onClick={props.onSaveAllFiles}>
          <SaveIcon size={14} />
        </button>}
        {selectedFileTab?.file && !selectedFileTab.file.preview && <button className={props.wordWrap ? 'icon-btn on' : 'icon-btn'} type="button" title={`줄바꿈 ${props.wordWrap ? '끄기' : '켜기'} (Alt+Z)`} aria-label={`줄바꿈 ${props.wordWrap ? '끄기' : '켜기'}`} aria-pressed={props.wordWrap} onClick={props.onToggleWordWrap}>
          <WrapLinesIcon size={14} />
        </button>}
        {selectedFileTab?.file && !selectedFileTab.file.preview && <div className="editor-font-controls" aria-label="편집기 글자 크기">
          <button type="button" className="icon-btn" title="글자 작게 (Ctrl+-)" aria-label="편집기 글자 작게" disabled={props.editorFontSize <= 10} onClick={() => props.onChangeEditorFontSize(-1)}>A−</button>
          <span aria-live="polite">{props.editorFontSize}px</span>
          <button type="button" className="icon-btn" title="글자 크게 (Ctrl+=)" aria-label="편집기 글자 크게" disabled={props.editorFontSize >= 24} onClick={() => props.onChangeEditorFontSize(1)}>A+</button>
        </div>}
        <button
          type="button"
          className="icon-btn strip-add"
          title="새 탭"
          aria-label="새 탭"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="pane-new-tab-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <PlusIcon size={14} />
        </button>
        {menuOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="strip-menu" id="pane-new-tab-menu" role="menu" aria-label="새 탭 종류">
              <button role="menuitem" onClick={() => newTab('browser')}>
                <GlobeIcon size={14} /> 새 브라우저 탭
              </button>
              <button role="menuitem" onClick={() => newTab('terminal')}>
                <TerminalIcon size={14} /> 새 터미널
              </button>
              <button role="menuitem" onClick={() => newTab('files')}>
                <FolderIcon size={14} /> 파일 탐색기
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onPickFileTab();
                }}
              >
                <FileIcon size={14} /> 파일 열기…
              </button>
            </div>
          </>
        )}
        {tabContextMenu && (() => {
          const contextTab = tabs.find((tab) => tab.id === tabContextMenu.tabId);
          const contextIndex = tabs.findIndex((tab) => tab.id === tabContextMenu.tabId);
          const savedFileTabIds = tabs
            .filter((tab) => tab.kind === 'file' && tab.file && (!tab.file.dirty || tab.file.readOnly))
            .map((tab) => tab.id);
          const unpinnedTabIds = unpinnedPaneTabIds(tabs);
          if (!contextTab) return null;
          return (
            <>
              <div className="menu-backdrop pane-tab-context-backdrop" onClick={closeTabContextMenu} />
              <div
                ref={tabContextMenuRef}
                className="strip-menu pane-tab-context-menu"
                role="menu"
                aria-label={`${contextTab.title} 탭 메뉴`}
                style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeTabContextMenu();
                  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
                    const current = items.indexOf(document.activeElement as HTMLButtonElement);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                    items[next]?.focus();
                  }
                }}
              >
                <button role="menuitem" onClick={() => closeFromMenu([contextTab.id])}>탭 닫기</button>
                {contextTab.kind === 'file' && <button role="menuitem" onClick={() => { closeTabContextMenu(); props.onToggleTabPinned(contextTab.id); }}>{contextTab.pinned ? '탭 고정 해제' : '탭 고정'}</button>}
                {tabs.length > 1 && <button role="menuitem" onClick={() => closeFromMenu(tabs.filter((tab) => tab.id !== contextTab.id).map((tab) => tab.id))}>다른 탭 닫기</button>}
                {contextIndex < tabs.length - 1 && <button role="menuitem" onClick={() => closeFromMenu(tabs.slice(contextIndex + 1).map((tab) => tab.id))}>오른쪽 탭 닫기</button>}
                {tabs.length > 1 && <button role="menuitem" onClick={() => closeFromMenu(tabs.map((tab) => tab.id))}>모든 탭 닫기</button>}
                {savedFileTabIds.length > 0 && <button role="menuitem" onClick={() => closeFromMenu(savedFileTabIds)}>저장된 파일 탭 닫기 ({savedFileTabIds.length})</button>}
                {unpinnedTabIds.length > 0 && <button role="menuitem" onClick={() => closeFromMenu(unpinnedTabIds)}>고정하지 않은 탭 닫기 ({unpinnedTabIds.length})</button>}
                {contextTab.kind === 'file' && contextTab.file && <>
                  <button role="menuitem" onClick={() => void revealTabFile(contextTab)}>파일 위치 열기</button>
                  <button role="menuitem" onClick={() => void copyTabPath(contextTab)}>파일 경로 복사</button>
                </>}
              </div>
            </>
          );
        })()}
      </div>
      <div className="strip-body">
        {tabs.length === 0 && (
          <div className="strip-empty">
            탭이 없습니다. <button className="link-btn" onClick={() => setMenuOpen(true)}>+ 새 탭</button>으로 여세요.
          </div>
        )}
        {tabs.map((t) => {
          const selected = t.id === activeId;
          return (
            <div
              key={t.id}
              id={`pane-panel-${t.id}`}
              role="tabpanel"
              aria-labelledby={`pane-tab-${t.id}`}
              aria-hidden={!selected}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'pane-page' : 'pane-page hidden'}
            >
              {t.kind === 'file' && t.file && (
                <Suspense fallback={<div className="editor-loading" role="status">코드 편집기를 불러오는 중…</div>}>
                  <FileEditor
                    file={t.file}
                    workspaceRoot={props.folder}
                    wordWrap={props.wordWrap}
                    fontSize={props.editorFontSize}
                    onRequestGoToLine={props.onRequestGoToLine}
                    onCopyPath={() => { void copyTabPath(t); }}
                    monacoTheme={props.monacoTheme}
                    active={selected && props.paneActive}
                    onChange={(c) => props.onFileChange(t.id, c)}
                    onSave={() => props.onFileSave(t.id)}
                    onReload={() => props.onReloadFile(t.id)}
                    onOpenExternal={() => props.onOpenFileExternal(t.file!.path)}
                    onToggleDiff={() => props.onFileToggleDiff(t.id)}
                    onSearchSelection={props.onSearchSelection}
                    onCursorLocationChange={props.onCursorLocationChange}
                    canNavigateBack={props.canNavigateEditorBack}
                    canNavigateForward={props.canNavigateEditorForward}
                    onNavigateBack={props.onNavigateEditorBack}
                    onNavigateForward={props.onNavigateEditorForward}
                    navigationEntries={props.editorNavigationEntries}
                    navigationIndex={props.editorNavigationIndex}
                    navigationBookmarks={props.editorNavigationBookmarks}
                    onNavigateToLocation={props.onNavigateEditorToLocation}
                    onToggleNavigationBookmark={props.onToggleEditorLocationBookmark}
                    apiRef={props.editorApiRef}
                  />
                </Suspense>
              )}
              {t.kind === 'browser' && (
                <BrowserTab
                  tabId={t.id}
                  home={props.home}
                  initialUrl={t.url}
                  agentEnabled={props.agentEnabled}
                  active={selected && props.paneActive}
                  obscured={menuOpen || tabContextMenu != null || goToLineOpen || props.parkBrowser}
                  onTitle={props.onBrowserTitle}
                  onUrl={props.onBrowserUrl}
                  onClose={() => props.onCloseTab(t.id)}
                  onCloseAll={() => props.onCloseTabs(tabs.map((tab) => tab.id))}
                  onSwitchTab={props.onSwitchTab}
                  onMoveTab={(direction) => {
                    const index = tabs.findIndex((tab) => tab.id === t.id);
                    const target = tabs[index + direction];
                    if (target) props.onReorderTabs(t.id, target.id);
                  }}
                  onAppShortcut={props.onBrowserAppShortcut}
                  onNotice={props.onNotice}
                  bookmarks={props.bookmarks}
                  onToggleBookmark={props.onToggleBookmark}
                />
              )}
              {t.kind === 'files' && (
                <FilesTab
                  active={selected && props.paneActive}
                  folder={props.folder}
                  treeVersion={props.treeVersion}
                  onRefreshTree={props.onRefreshTree}
                  changedFiles={props.changedFiles}
                  changedKinds={props.changedKinds}
                  changedStaged={props.changedStaged}
                  recentFiles={props.recentFiles}
                  activeFilePath={lastActiveFilePath}
                  openFiles={tabs.filter((tab) => tab.kind === 'file' && tab.file).map((tab) => ({
                    path: tab.file!.path,
                    name: tab.file!.name,
                    dirty: tab.file!.dirty,
                  }))}
                  onOpenFile={props.onOpenFile}
                  onCloseFile={(filePath) => {
                    const fileTab = tabs.find((tab) => tab.kind === 'file' && tab.file && pathsEqual(tab.file.path, filePath));
                    if (fileTab) props.onCloseTab(fileTab.id);
                  }}
                  onCloseFiles={(filePaths) => {
                    props.onCloseTabs(tabs
                      .filter((tab) => tab.kind === 'file' && tab.file && !tab.file.dirty && filePaths.some((filePath) => pathsEqual(tab.file!.path, filePath)))
                      .map((tab) => tab.id));
                  }}
                  onOpenFileAtLine={props.onOpenFileAtLine}
                  fileSearchMode={props.fileSearchMode}
                  fileSearchFocusRequest={props.fileSearchFocusRequest}
                  fileSearchQuery={props.fileSearchQuery}
                  onSearchModeChange={props.onSearchModeChange}
                  onOpenChanged={props.onOpenChanged}
                  onRefreshChanged={props.onRefreshChanged}
                  onCommitFiles={props.onCommitFiles}
                  onPickFolder={props.onPickFolder}
                  onOpenTerminalAt={props.onOpenTerminalAt}
                  onNotice={props.onNotice}
                  onRenameEntry={props.onRenameEntry}
                  onDeleteEntry={props.onDeleteEntry}
                />
              )}
              {t.kind === 'terminal' && (
                <Suspense fallback={<div className="editor-loading" role="status">터미널을 불러오는 중…</div>}>
                  <TerminalTab
                    tabId={t.id}
                    shell={t.shell || 'powershell'}
                    cwd={t.cwd || props.folder}
                    dark={props.dark}
                    active={selected}
                    onShellChange={(s) => props.onTermShell(t.id, s)}
                    onNotice={props.onNotice}
                  />
                </Suspense>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
