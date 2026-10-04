import React, { useEffect, useRef, useState } from 'react';
import type { EditorApi, OpenFile } from '../types';
import { api, hasBridge, languageFromPath } from '../lib/mudex';
import { relativePathFromRoot } from '../lib/path-utils.mjs';
import { formatEditorSelectionPrompt } from '../lib/editor-selection-prompt.mjs';
import { adjustImageZoom, imageZoomPercent } from '../lib/image-zoom.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { CheckIcon, ChevronRightIcon, ClockIcon, CopyIcon, DiffIcon, ExternalLinkIcon, RefreshIcon, SaveIcon, SearchIcon, SendIcon, StarIcon } from './icons';
import remarkGfm from 'remark-gfm';
import { useLang, useStrings } from '../lib/lang';
import { formatStr } from '../lib/i18n.mjs';

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
  const s = useStrings();
  const lang = useLang();
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
    }, lang);
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
      setPreviewError(s.editor.previewDesktopOnly);
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
        const typeName = file.preview === 'image' ? s.editor.mediaImage : file.preview === 'pdf' ? s.editor.mediaPdf : file.preview === 'audio' ? s.editor.mediaAudio : s.editor.mediaVideo;
        setPreviewError(result.error === 'TOO_LARGE' ? formatStr(s.editor.tooLarge, { type: typeName }) : result.error || formatStr(s.editor.previewLoadFailed, { type: typeName }));
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
        {current && <span className="editor-location-history-current">{s.editor.locCurrent}</span>}
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={bookmarked} className={bookmarked ? 'editor-location-bookmark on' : 'editor-location-bookmark'} aria-label={formatStr(bookmarked ? s.editor.bookmarkOff : s.editor.bookmarkOn, { path: relativePath, line: location.line })} title={bookmarked ? s.editor.unbookmarkTitle : s.editor.bookmarkTitle} onClick={() => props.onToggleNavigationBookmark(location)}>
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
        <span className={`file-status${file.diskState ? ` disk-${file.diskState}` : ''}`} role={file.diskState ? 'status' : undefined}>{file.diskState === 'missing' ? s.editor.statusMissing : file.diskState === 'unavailable' ? s.editor.statusUnavailable : file.diskState === 'changed' ? s.editor.statusChanged : file.preview === 'image' ? s.editor.statusImage : file.preview === 'pdf' ? s.editor.statusPdf : file.preview === 'audio' ? s.editor.statusAudio : file.preview === 'video' ? s.editor.statusVideo : file.preview === 'binary' ? s.editor.statusBinary : file.dirty ? s.editor.statusDirty : s.editor.statusSaved}</span>
        <button type="button" className="file-path-context" title={formatStr(s.editor.copyPathTitle, { path: file.path })} aria-label={formatStr(s.editor.copyPathTitle, { path: file.path })} onClick={props.onCopyPath}>
          <span>{relativePathFromRoot(props.workspaceRoot, file.path).split('/').slice(0, -1).join(' / ') || s.editor.projectRoot}</span>
          <CopyIcon size={11} />
        </button>
        {!file.preview && <button type="button" className="icon-btn editor-selection-prompt" title={s.editor.addSelectionTitle} aria-label={s.editor.addSelectionLabel} disabled={!hasSelection} onClick={addSelectionToPrompt}><SendIcon size={13} /></button>}
        {!file.preview && <button type="button" className="icon-btn editor-search-selection" title={s.editor.searchSelection} aria-label={s.editor.searchSelection} disabled={!hasSelection} onClick={onSearchSelection}><SearchIcon size={13} /></button>}
        {!file.preview && <div className="editor-location-nav" role="group" aria-label={s.editor.locNavGroup} ref={navigationMenuRef}>
          <button type="button" className="icon-btn editor-location-nav-back" title={s.editor.locBackTitle} aria-label={s.editor.locBackLabel} aria-keyshortcuts="Alt+ArrowLeft" disabled={!props.canNavigateBack} onClick={props.onNavigateBack}><ChevronRightIcon size={13} /></button>
          <button type="button" className="icon-btn editor-location-nav-forward" title={s.editor.locFwdTitle} aria-label={s.editor.locFwdLabel} aria-keyshortcuts="Alt+ArrowRight" disabled={!props.canNavigateForward} onClick={props.onNavigateForward}><ChevronRightIcon size={13} /></button>
          <button type="button" className="icon-btn editor-location-nav-history" title={s.editor.locMenuTitle} aria-label={s.editor.locMenuLabel} aria-haspopup="menu" aria-expanded={navigationMenuOpen} disabled={!props.navigationEntries.length && !props.navigationBookmarks.length} onClick={() => {
            const opening = !navigationMenuOpen;
            setNavigationMenuOpen(opening);
            if (opening) scheduleAfterPaint(() => navigationMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus());
          }}><ClockIcon size={13} /></button>
          {navigationMenuOpen && <div className="editor-location-history-menu" role="menu" aria-label={s.editor.locMenuAria} onKeyDown={(event) => {
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
              <div className="editor-location-history-head"><StarIcon size={11} filled /> {s.editor.bookmarksHead}</div>
              {props.navigationBookmarks.slice().reverse().map((location, index) => renderNavigationLocation(location, `bookmark:${locationKey(location)}:${index}`, false))}
            </>}
            {recentNavigationLocations.length > 0 && <>
              <div className="editor-location-history-head">{s.editor.recentHead}</div>
              {recentNavigationLocations.map(({ location, index }) => renderNavigationLocation(location, `recent:${locationKey(location)}:${index}`, index === props.navigationIndex))}
            </>}
          </div>}
        </div>}
        {!file.preview && <button type="button" className="file-cursor-position" title={s.editor.gotoTitle} aria-label={formatStr(s.editor.cursorLabel, { line: cursorPosition.line, column: cursorPosition.column })} onClick={props.onRequestGoToLine}>Ln {cursorPosition.line}, Col {cursorPosition.column}</button>}
        {isMarkdown && !file.preview && !file.showDiff && <button type="button" className="btn editor-preview-toggle" title={s.editor.mdToggleTitle} aria-label={s.editor.mdToggleLabel} aria-keyshortcuts="Control+Shift+V Meta+Shift+V" aria-pressed={markdownPreview} onClick={() => setMarkdownPreview((value) => !value)}>{markdownPreview ? s.editor.sourceBtn : s.editor.previewBtn}</button>}
        {!file.preview && <button
          type="button"
          className={file.showDiff ? 'icon-btn on' : 'icon-btn'}
          title={file.externalContent !== undefined ? s.editor.diffExternal : s.editor.diffToggle}
          aria-label={file.showDiff ? s.editor.diffHide : file.externalContent !== undefined ? s.editor.diffExternal : s.editor.diffShow}
          aria-pressed={file.showDiff}
          onClick={onToggleDiff}
        >
          <DiffIcon size={14} />
        </button>}
        {!file.preview && !file.readOnly && <button className="icon-btn" type="button" onClick={onReload} title={s.editor.reloadDisk} aria-label={s.editor.reloadDisk}>
          <RefreshIcon size={14} />
        </button>}
        {file.preview && <button className="btn" type="button" onClick={onOpenExternal} title={s.editor.openExternalTitle}>
          <ExternalLinkIcon size={14} /> {s.editor.defaultApp}
        </button>}
        {file.preview === 'image' && <div className="file-image-zoom" role="group" aria-label={s.editor.zoomGroup}>
          <button type="button" title={s.editor.zoomOutTitle} aria-label={s.editor.zoomOutLabel} disabled={imageZoom <= 0.25} onClick={() => setImageZoom((value) => adjustImageZoom(value, -1))}>−</button>
          <output aria-live="polite" aria-label={formatStr(s.editor.zoomRatioLabel, { pct: imageZoomPercent(imageZoom) })}>{imageZoomPercent(imageZoom)}</output>
          <button type="button" title={s.editor.zoomInTitle} aria-label={s.editor.zoomInLabel} disabled={imageZoom >= 5} onClick={() => setImageZoom((value) => adjustImageZoom(value, 1))}>+</button>
          <button type="button" title={s.editor.zoomFit} aria-label={s.editor.zoomFit} onClick={() => setImageZoom(1)}>{s.editor.zoomFitBtn}</button>
        </div>}
        {!file.readOnly && (
          <button className="btn" onClick={onSave} disabled={!file.dirty}>
            <SaveIcon size={14} /> {s.common.save}
          </button>
        )}
      </div>
      <div className="file-body">
        {file.preview ? (
          <div className={`file-media-preview file-preview-${file.preview}`} aria-label={formatStr(s.editor.mediaPreviewLabel, { name: file.name, preview: file.preview })} onWheel={(event) => {
            if (file.preview !== 'image' || !(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            setImageZoom((value) => adjustImageZoom(value, event.deltaY < 0 ? 1 : -1));
          }}>
            {previewLoading ? <div className="empty-note">{s.editor.loadingPreview}</div>
              : previewError ? <div className="tree-error">{previewError}</div>
                : file.preview === 'binary' ? <div className="binary-preview-message"><strong>{file.name}</strong><span>{s.editor.binaryLine1}</span><span>{s.editor.binaryLine2}</span></div>
                  : previewDataUrl && file.preview === 'image' ? <img src={previewDataUrl} alt={file.name} style={{ width: `${imageZoom * 100}%`, height: `${imageZoom * 100}%` }} onError={() => setPreviewError(s.editor.imgFormatErr)} />
                    : previewDataUrl && file.preview === 'pdf' ? <iframe src={previewDataUrl} title={formatStr(s.editor.pdfTitle, { name: file.name })} onError={() => setPreviewError(s.editor.pdfErr)} />
                      : previewDataUrl && file.preview === 'audio' ? <audio src={previewDataUrl} controls onError={() => setPreviewError(s.editor.audioErr)} />
                        : previewDataUrl && file.preview === 'video' ? <video src={previewDataUrl} controls onError={() => setPreviewError(s.editor.videoErr)} /> : null}
          </div>
        ) : markdownPreview && isMarkdown && !file.showDiff ? (
          <div className="markdown-file-preview" aria-label={formatStr(s.editor.mdPreviewLabel, { name: file.name })}>
            <React.Suspense fallback={<div className="editor-loading" role="status">{s.editor.loadingPreview}</div>}>
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
                    <button type="button" className="markdown-code-copy" onClick={() => void copyMarkdownCode(code)} aria-label={markdownCopyError && copied ? s.editor.codeCopyFailed : copied ? s.editor.codeCopied : s.editor.codeCopy} title={markdownCopyError && copied ? s.editor.copyFailedTitle : copied ? s.editor.copiedTitle : s.editor.codeCopy}>
                      {copied && !markdownCopyError ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                    </button>
                    <pre>{children}</pre>
                  </div>;
                },
              }}>{file.content}</ReactMarkdown>
            </React.Suspense>
          </div>
        ) : file.showDiff ? (
          <React.Suspense fallback={<div className="editor-loading" role="status">{s.editor.loadingEditor}</div>}>
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
                  label: s.editor.searchSelectionCtx,
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
          <React.Suspense fallback={<div className="editor-loading" role="status">{s.editor.loadingEditor}</div>}>
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
                  label: s.editor.searchSelectionCtx,
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
