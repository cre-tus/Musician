import React, { useEffect, useRef, useState } from 'react';
import type { EditorApi, OpenFile } from '../types';
import { api, hasBridge, languageFromPath } from '../lib/mudex';
import { relativePathFromRoot } from '../lib/path-utils.mjs';
import { formatEditorSelectionPrompt } from '../lib/editor-selection-prompt.mjs';
import { adjustImageZoom, imageZoomPercent } from '../lib/image-zoom.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { CheckIcon, ChevronRightIcon, ClockIcon, CopyIcon, DiffIcon, ExternalLinkIcon, RefreshIcon, SaveIcon, SearchIcon, SendIcon, StarIcon } from './icons';
import remarkGfm from 'remark-gfm';

const ReactMarkdown = React.lazy(() => import('react-markdown'));
const loadMonaco = () => import('../lib/monacoSetup').then(() => import('@monaco-editor/react'));
const MonacoEditor = React.lazy(() => loadMonaco().then(({ default: Editor }) => ({ default: Editor })));
const MonacoDiffEditor = React.lazy(() => loadMonaco().then(({ DiffEditor }) => ({ default: DiffEditor })));

function markdownNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(markdownNodeText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return markdownNodeText(node.props.children);
  return '';
}

interface Props {
  file: OpenFile;
  workspaceRoot: string;
  wordWrap: boolean;
  fontSize: number;
  onRequestGoToLine: () => void;
  onCopyPath: () => void;
  monacoTheme: string;
  active: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
  onReload: () => void;
  onOpenExternal: () => void;
  onToggleDiff: () => void;
  onSearchSelection: () => void;
  onCursorLocationChange: (path: string, line: number, column: number) => void;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  navigationEntries: Array<{ path: string; line: number; column: number }>;
  navigationIndex: number;
  navigationBookmarks: Array<{ path: string; line: number; column: number }>;
  onNavigateToLocation: (location: { path: string; line: number; column: number }) => void;
  onToggleNavigationBookmark: (location: { path: string; line: number; column: number }) => void;
  apiRef: { current: EditorApi | null };
}

// Single-file code tab content. Only the active tab registers the shared
// EditorApi (chat "insert at cursor" / line reveal target it).
export default function FileEditor(props: Props) {
  const { file, monacoTheme, active, onChange, onSave, onReload, onOpenExternal, onToggleDiff, onSearchSelection, apiRef } = props;
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(file.path);
  const locationKey = (location: { path: string; line: number; column: number }) => `${location.path.replace(/\\/g, '/').toLocaleLowerCase()}:${location.line}:${location.column}`;
  const navigationBookmarkKeys = new Set(props.navigationBookmarks.map(locationKey));
  const recentNavigationLocations = props.navigationEntries.map((location, index) => ({ location, index }))
    .slice(-15).reverse().filter(({ location }) => !navigationBookmarkKeys.has(locationKey(location)));
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [copiedMarkdownCode, setCopiedMarkdownCode] = useState<string | null>(null);
  const [markdownCopyError, setMarkdownCopyError] = useState(false);
  const markdownCopyTimerRef = useRef<number | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [navigationMenuOpen, setNavigationMenuOpen] = useState(false);
  const navigationMenuRef = useRef<HTMLDivElement | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState('');
  const [imageZoom, setImageZoom] = useState(1);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onCursorLocationChangeRef = useRef(props.onCursorLocationChange);
  onCursorLocationChangeRef.current = props.onCursorLocationChange;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => () => {
    if (markdownCopyTimerRef.current !== null) window.clearTimeout(markdownCopyTimerRef.current);
  }, []);

  // automaticLayout runs on ResizeObserver, which stays paused while the
  // window is occluded — an editor mounted hidden sticks at 5x5. Force an
  // explicit layout whenever this tab becomes active.
  useEffect(() => {
    if (!active) return;
    return scheduleAfterPaint(() => {
      try {
        editorRef.current?.layout?.();
      } catch {
        /* editor tearing down */
      }
    });
  }, [active]);

  const copyMarkdownCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedMarkdownCode(code);
      setMarkdownCopyError(false);
    } catch {
      setCopiedMarkdownCode(code);
      setMarkdownCopyError(true);
    }
    if (markdownCopyTimerRef.current !== null) window.clearTimeout(markdownCopyTimerRef.current);
    markdownCopyTimerRef.current = window.setTimeout(() => {
      setCopiedMarkdownCode(null);
      setMarkdownCopyError(false);
      markdownCopyTimerRef.current = null;
    }, 1800);
  };

  const trackCursor = (editor: any) => {
    const activeEditor = typeof editor.getModifiedEditor === 'function' ? editor.getModifiedEditor() : editor;
    const position = activeEditor.getPosition();
    if (position) {
      setCursorPosition({ line: position.lineNumber, column: position.column });
      if (activeRef.current) onCursorLocationChangeRef.current(file.path, position.lineNumber, position.column);
    }
    activeEditor.onDidChangeCursorPosition(({ position: nextPosition }: { position: { lineNumber: number; column: number } }) => {
      setCursorPosition({ line: nextPosition.lineNumber, column: nextPosition.column });
      if (activeRef.current) onCursorLocationChangeRef.current(file.path, nextPosition.lineNumber, nextPosition.column);
    });
    activeEditor.onDidChangeCursorSelection(({ selection }: { selection: { isEmpty: boolean } }) => setHasSelection(!selection.isEmpty));
  };

  const addSelectionToPrompt = () => {
    const selection = apiRef.current?.getSelection();
    if (!selection) return;
    const prompt = formatEditorSelectionPrompt({
      ...selection,
      relativePath: relativePathFromRoot(props.workspaceRoot, file.path),
      language: languageFromPath(file.path),
    });
    if (prompt) window.dispatchEvent(new CustomEvent('musician:composer-insert', { detail: { text: prompt } }));
  };

  useEffect(() => {
    if (!active || file.preview) return;
    apiRef.current = {
      filePath: file.path,
      insertAtCursor: (text: string) => {
        const inst = editorRef.current;
        if (!inst) return false;
        const ed = typeof inst.getModifiedEditor === 'function' ? inst.getModifiedEditor() : inst;
        try {
          const sel = ed.getSelection();
          if (!sel) return false;
          ed.executeEdits('mudex-insert', [{ range: sel, text, forceMoveMarkers: true }]);
          ed.focus();
          return true;
        } catch {
          return false;
        }
      },
      getSelection: () => {
        const inst = editorRef.current;
        if (!inst) return null;
        const ed = typeof inst.getModifiedEditor === 'function' ? inst.getModifiedEditor() : inst;
        try {
          const selection = ed.getSelection();
          const model = ed.getModel();
          if (!selection || selection.isEmpty || !model) return null;
          return {
            text: model.getValueInRange(selection),
            startLine: selection.startLineNumber,
            endLine: selection.endLineNumber,
          };
        } catch {
          return null;
        }
      },
      revealLine: (line: number, column = 1) => {
        const inst = editorRef.current;
        if (!inst || !(line > 0)) return false;
        const ed = typeof inst.getModifiedEditor === 'function' ? inst.getModifiedEditor() : inst;
        try {
          const max = ed.getModel()?.getLineCount() || line;
          const ln = Math.min(line, max);
          const maxColumn = ed.getModel()?.getLineMaxColumn(ln) || column;
          ed.revealLineInCenter(ln);
          ed.setPosition({ lineNumber: ln, column: Math.max(1, Math.min(column, maxColumn)) });
          ed.focus();
          return true;
        } catch {
          return false;
        }
      },
      openSymbolPicker: () => {
        const inst = editorRef.current;
        if (!inst) return false;
        const ed = typeof inst.getModifiedEditor === 'function' ? inst.getModifiedEditor() : inst;
        try {
          ed.trigger('keyboard', 'editor.action.quickOutline', null);
          return true;
        } catch {
          return false;
        }
      },
      runCommand: (commandId: string) => {
        const inst = editorRef.current;
        if (!inst || !commandId) return false;
        const ed = typeof inst.getModifiedEditor === 'function' ? inst.getModifiedEditor() : inst;
        try {
          ed.trigger('keyboard', commandId, null);
          return true;
        } catch {
          return false;
        }
      },
    };
    return () => {
      if (apiRef.current && active) apiRef.current = null;
    };
  }, [active, apiRef, file.path, file.preview]);

  useEffect(() => {
    if (!file.preview || file.preview === 'binary') {
      setPreviewDataUrl('');
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewDataUrl('');
    setPreviewError('');
    setPreviewLoading(true);
    if (!hasBridge()) {
      setPreviewError('Electron 앱에서 파일 미리보기를 사용할 수 있어.');
      setPreviewLoading(false);
      return;
    }
    api().readFileBytes(file.path).then((result) => {
      if (cancelled) return;
      const validMime = file.preview === 'image' ? result.mime?.startsWith('image/')
        : file.preview === 'pdf' ? result.mime === 'application/pdf'
          : file.preview === 'audio' ? result.mime?.startsWith('audio/')
            : file.preview === 'video' ? result.mime?.startsWith('video/')
              : false;
      if (!result.ok || !result.base64 || !validMime) {
        const typeName = file.preview === 'image' ? '이미지' : file.preview === 'pdf' ? 'PDF' : file.preview === 'audio' ? '오디오' : '영상';
        setPreviewError(result.error === 'TOO_LARGE' ? `${typeName} 파일이 너무 커서 미리볼 수 없어 (8MB 제한).` : result.error || `${typeName} 미리보기를 불러오지 못했어.`);
        return;
      }
      setPreviewDataUrl(`data:${result.mime};base64,${result.base64}`);
    }).catch((error: unknown) => {
      if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setPreviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [file.path, file.preview]);

  useEffect(() => setImageZoom(1), [file.path, file.preview]);

  useEffect(() => {
    if (!navigationMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigationMenuRef.current?.contains(event.target)) setNavigationMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [navigationMenuOpen]);

  useEffect(() => {
    if (!active || file.readOnly) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, file.readOnly]);

  useEffect(() => {
    if (!active || !isMarkdown || file.preview || file.showDiff) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        setMarkdownPreview((value) => !value);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, isMarkdown, file.preview, file.showDiff]);

  const renderNavigationLocation = (location: { path: string; line: number; column: number }, key: string, current: boolean) => {
    const bookmarked = navigationBookmarkKeys.has(locationKey(location));
    const relativePath = relativePathFromRoot(props.workspaceRoot, location.path);
    return <div className="editor-location-history-row" key={key}>
      <button type="button" role="menuitemradio" aria-checked={current} className={current ? 'editor-location-history-item current' : 'editor-location-history-item'} title={`${location.path}:${location.line}:${location.column}`} onClick={() => {
        setNavigationMenuOpen(false);
        props.onNavigateToLocation(location);
      }}>
        <span className="editor-location-history-file">{relativePath}</span>
        <span className="editor-location-history-line">{location.line}:{location.column}</span>
        {current && <span className="editor-location-history-current">현재</span>}
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={bookmarked} className={bookmarked ? 'editor-location-bookmark on' : 'editor-location-bookmark'} aria-label={bookmarked ? `${relativePath} ${location.line}줄 북마크 해제` : `${relativePath} ${location.line}줄 북마크 저장`} title={bookmarked ? '북마크 해제' : '북마크 저장'} onClick={() => props.onToggleNavigationBookmark(location)}>
        <StarIcon size={13} filled={bookmarked} />
      </button>
    </div>;
  };

  return (
    <div className="file-editor">
      <div className="file-bar">
        <span className="file-name" title={file.path}>
          {file.dirty && !file.readOnly && <span className="dirty-dot" />} {file.name}
        </span>
        <span className={`file-status${file.diskState ? ` disk-${file.diskState}` : ''}`} role={file.diskState ? 'status' : undefined}>{file.diskState === 'missing' ? '디스크에서 삭제됨' : file.diskState === 'unavailable' ? '파일을 불러올 수 없음' : file.diskState === 'changed' ? '디스크 변경됨 · 저장 안 됨' : file.preview === 'image' ? '이미지 미리보기' : file.preview === 'pdf' ? 'PDF 미리보기' : file.preview === 'audio' ? '오디오 미리보기' : file.preview === 'video' ? '영상 미리보기' : file.preview === 'binary' ? '바이너리 파일' : file.dirty ? '저장 안 됨' : '저장됨'}</span>
        <button type="button" className="file-path-context" title={`파일 경로 복사: ${file.path}`} aria-label={`파일 경로 복사: ${file.path}`} onClick={props.onCopyPath}>
          <span>{relativePathFromRoot(props.workspaceRoot, file.path).split('/').slice(0, -1).join(' / ') || '프로젝트 루트'}</span>
          <CopyIcon size={11} />
        </button>
        {!file.preview && <button type="button" className="icon-btn editor-selection-prompt" title="선택한 코드와 파일 위치를 메시지 입력창에 추가" aria-label="선택한 코드를 메시지 입력창에 추가" disabled={!hasSelection} onClick={addSelectionToPrompt}><SendIcon size={13} /></button>}
        {!file.preview && <button type="button" className="icon-btn editor-search-selection" title="선택한 텍스트를 프로젝트 파일에서 검색" aria-label="선택한 텍스트를 프로젝트 파일에서 검색" disabled={!hasSelection} onClick={onSearchSelection}><SearchIcon size={13} /></button>}
        {!file.preview && <div className="editor-location-nav" role="group" aria-label="코드 위치 기록" ref={navigationMenuRef}>
          <button type="button" className="icon-btn editor-location-nav-back" title="이전 코드 위치 (Alt+←)" aria-label="이전 코드 위치" aria-keyshortcuts="Alt+ArrowLeft" disabled={!props.canNavigateBack} onClick={props.onNavigateBack}><ChevronRightIcon size={13} /></button>
          <button type="button" className="icon-btn editor-location-nav-forward" title="다음 코드 위치 (Alt+→)" aria-label="다음 코드 위치" aria-keyshortcuts="Alt+ArrowRight" disabled={!props.canNavigateForward} onClick={props.onNavigateForward}><ChevronRightIcon size={13} /></button>
          <button type="button" className="icon-btn editor-location-nav-history" title="코드 위치 기록과 북마크" aria-label="코드 위치 기록과 북마크 열기" aria-haspopup="menu" aria-expanded={navigationMenuOpen} disabled={!props.navigationEntries.length && !props.navigationBookmarks.length} onClick={() => {
            const opening = !navigationMenuOpen;
            setNavigationMenuOpen(opening);
            if (opening) scheduleAfterPaint(() => navigationMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus());
          }}><ClockIcon size={13} /></button>
          {navigationMenuOpen && <div className="editor-location-history-menu" role="menu" aria-label="최근 코드 위치" onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setNavigationMenuOpen(false);
              navigationMenuRef.current?.querySelector<HTMLButtonElement>('.editor-location-nav-history')?.focus();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'));
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : current < 0 ? 0 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }
          }}>
            {props.navigationBookmarks.length > 0 && <>
              <div className="editor-location-history-head"><StarIcon size={11} filled /> 북마크 위치</div>
              {props.navigationBookmarks.slice().reverse().map((location, index) => renderNavigationLocation(location, `bookmark:${locationKey(location)}:${index}`, false))}
            </>}
            {recentNavigationLocations.length > 0 && <>
              <div className="editor-location-history-head">최근 코드 위치</div>
              {recentNavigationLocations.map(({ location, index }) => renderNavigationLocation(location, `recent:${locationKey(location)}:${index}`, index === props.navigationIndex))}
            </>}
          </div>}
        </div>}
        {!file.preview && <button type="button" className="file-cursor-position" title="줄 또는 열로 이동 (Ctrl+G)" aria-label={`현재 줄 ${cursorPosition.line}, 열 ${cursorPosition.column}. 눌러서 위치로 이동`} onClick={props.onRequestGoToLine}>Ln {cursorPosition.line}, Col {cursorPosition.column}</button>}
        {isMarkdown && !file.preview && !file.showDiff && <button type="button" className="btn editor-preview-toggle" title="Markdown 원문/미리보기 전환 (Ctrl+Shift+V)" aria-label="Markdown 미리보기 전환" aria-keyshortcuts="Control+Shift+V Meta+Shift+V" aria-pressed={markdownPreview} onClick={() => setMarkdownPreview((value) => !value)}>{markdownPreview ? '원문' : '미리보기'}</button>}
        {!file.preview && <button
          type="button"
          className={file.showDiff ? 'icon-btn on' : 'icon-btn'}
          title={file.externalContent !== undefined ? '디스크 변경 내용과 비교 보기' : 'diff 보기 토글'}
          aria-label={file.showDiff ? '변경 사항 diff 숨기기' : file.externalContent !== undefined ? '디스크 변경 내용과 비교 보기' : '변경 사항 diff 보기'}
          aria-pressed={file.showDiff}
          onClick={onToggleDiff}
        >
          <DiffIcon size={14} />
        </button>}
        {!file.preview && !file.readOnly && <button className="icon-btn" type="button" onClick={onReload} title="디스크에서 다시 불러오기" aria-label="디스크에서 다시 불러오기">
          <RefreshIcon size={14} />
        </button>}
        {file.preview && <button className="btn" type="button" onClick={onOpenExternal} title="운영체제 기본 앱에서 열기">
          <ExternalLinkIcon size={14} /> 기본 앱
        </button>}
        {file.preview === 'image' && <div className="file-image-zoom" role="group" aria-label="이미지 확대/축소">
          <button type="button" title="이미지 축소 (Ctrl+마우스 휠 아래)" aria-label="이미지 축소" disabled={imageZoom <= 0.25} onClick={() => setImageZoom((value) => adjustImageZoom(value, -1))}>−</button>
          <output aria-live="polite" aria-label={`이미지 확대 비율 ${imageZoomPercent(imageZoom)}`}>{imageZoomPercent(imageZoom)}</output>
          <button type="button" title="이미지 확대 (Ctrl+마우스 휠 위)" aria-label="이미지 확대" disabled={imageZoom >= 5} onClick={() => setImageZoom((value) => adjustImageZoom(value, 1))}>+</button>
          <button type="button" title="이미지 맞춤 크기로" aria-label="이미지 맞춤 크기로" onClick={() => setImageZoom(1)}>맞춤</button>
        </div>}
        {!file.readOnly && (
          <button className="btn" onClick={onSave} disabled={!file.dirty}>
            <SaveIcon size={14} /> 저장
          </button>
        )}
      </div>
      <div className="file-body">
        {file.preview ? (
          <div className={`file-media-preview file-preview-${file.preview}`} aria-label={`${file.name} ${file.preview} 미리보기`} onWheel={(event) => {
            if (file.preview !== 'image' || !(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            setImageZoom((value) => adjustImageZoom(value, event.deltaY < 0 ? 1 : -1));
          }}>
            {previewLoading ? <div className="empty-note">미리보기를 불러오는 중…</div>
              : previewError ? <div className="tree-error">{previewError}</div>
                : file.preview === 'binary' ? <div className="binary-preview-message"><strong>{file.name}</strong><span>이 형식은 텍스트 편집기에서 열 수 없어.</span><span>파일 아이콘과 이름으로 종류를 확인해줘.</span></div>
                  : previewDataUrl && file.preview === 'image' ? <img src={previewDataUrl} alt={file.name} style={{ width: `${imageZoom * 100}%`, height: `${imageZoom * 100}%` }} onError={() => setPreviewError('이 이미지 형식은 앱에서 미리볼 수 없어.')} />
                    : previewDataUrl && file.preview === 'pdf' ? <iframe src={previewDataUrl} title={`${file.name} PDF 미리보기`} onError={() => setPreviewError('PDF 미리보기를 표시하지 못했어.')} />
                      : previewDataUrl && file.preview === 'audio' ? <audio src={previewDataUrl} controls onError={() => setPreviewError('이 오디오 코덱은 미리보기에서 지원하지 않아.')} />
                        : previewDataUrl && file.preview === 'video' ? <video src={previewDataUrl} controls onError={() => setPreviewError('이 영상 코덱은 미리보기에서 지원하지 않아.')} /> : null}
          </div>
        ) : markdownPreview && isMarkdown && !file.showDiff ? (
          <div className="markdown-file-preview" aria-label={`${file.name} Markdown 미리보기`}>
            <React.Suspense fallback={<div className="editor-loading" role="status">미리보기를 불러오는 중…</div>}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                a({ href, children }: { href?: string; children?: React.ReactNode }) {
                  const openLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
                    event.preventDefault();
                    let url: URL;
                    try { url = new URL(href || ''); } catch { return; }
                    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || (url.username || url.password)) return;
                    if (hasBridge()) void api().openExternalLink(url.toString()).catch(() => {});
                    else window.open(url.toString(), '_blank', 'noopener,noreferrer');
                  };
                  return <a href={href} title={href} target="_blank" rel="noopener noreferrer" onClick={openLink}>{children}</a>;
                },
                pre({ children }: { children?: React.ReactNode }) {
                  const code = markdownNodeText(children).replace(/\n$/, '');
                  const copied = copiedMarkdownCode === code;
                  return <div className="markdown-code-block">
                    <button type="button" className="markdown-code-copy" onClick={() => void copyMarkdownCode(code)} aria-label={markdownCopyError && copied ? '코드 복사 실패' : copied ? '코드 복사됨' : '코드 복사'} title={markdownCopyError && copied ? '클립보드에 복사하지 못했어' : copied ? '복사됨' : '코드 복사'}>
                      {copied && !markdownCopyError ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                    </button>
                    <pre>{children}</pre>
                  </div>;
                },
              }}>{file.content}</ReactMarkdown>
            </React.Suspense>
          </div>
        ) : file.showDiff ? (
          <React.Suspense fallback={<div className="editor-loading" role="status">코드 편집기를 준비하는 중…</div>}>
            <MonacoDiffEditor
              key={`diff:${file.path}`}
              original={file.externalContent ?? file.original}
              modified={file.content}
              language={languageFromPath(file.path)}
              onMount={(ed) => {
                editorRef.current = ed;
                trackCursor(ed);
                ed.getModifiedEditor().addAction({
                  id: 'musician.searchSelectionInFiles',
                  label: '프로젝트 파일에서 선택 항목 검색',
                  contextMenuGroupId: 'navigation',
                  contextMenuOrder: 1.5,
                  precondition: 'editorHasSelection',
                  run: onSearchSelection,
                });
                ed.getModifiedEditor().onDidChangeModelContent(() => {
                  onChange(ed.getModifiedEditor().getValue());
                });
              }}
              theme={monacoTheme}
              options={{ renderSideBySide: true, minimap: { enabled: false }, wordWrap: props.wordWrap ? 'on' : 'off', fontFamily: 'ui-monospace, "SFMono-Regular", "Cascadia Code", "Segoe UI Mono", Consolas, "D2Coding", monospace', fontSize: props.fontSize, readOnly: !!file.readOnly, automaticLayout: true }}
            />
          </React.Suspense>
        ) : (
          <React.Suspense fallback={<div className="editor-loading" role="status">코드 편집기를 준비하는 중…</div>}>
            <MonacoEditor
              key={`edit:${file.path}`}
              value={file.content}
              language={languageFromPath(file.path)}
              path={file.path}
              onMount={(ed) => {
                editorRef.current = ed;
                trackCursor(ed);
                ed.addAction({
                  id: 'musician.searchSelectionInFiles',
                  label: '프로젝트 파일에서 선택 항목 검색',
                  contextMenuGroupId: 'navigation',
                  contextMenuOrder: 1.5,
                  precondition: 'editorHasSelection',
                  run: onSearchSelection,
                });
              }}
              onChange={(v) => onChange(v ?? '')}
              theme={monacoTheme}
              options={{ minimap: { enabled: false }, wordWrap: props.wordWrap ? 'on' : 'off', fontFamily: 'ui-monospace, "SFMono-Regular", "Cascadia Code", "Segoe UI Mono", Consolas, "D2Coding", monospace', fontSize: props.fontSize, readOnly: !!file.readOnly, automaticLayout: true }}
            />
          </React.Suspense>
        )}
      </div>
    </div>
  );
}
