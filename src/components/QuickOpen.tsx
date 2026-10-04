import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, hasBridge } from '../lib/mudex';
import { normalizePathForComparison } from '../lib/path-utils.mjs';
import { normalizePinnedFilePath, readPinnedFilePaths } from '../lib/pinned-file-paths.mjs';
import { FileTypeIcon, SearchIcon, StarIcon, XIcon } from './icons';

interface Result {
  path: string;
  relativePath: string;
}

interface Props {
  cwd: string;
  treeVersion: number;
  recentFiles: string[];
  openFiles: Array<{ path: string; dirty: boolean; active: boolean; diskState?: 'changed' | 'missing' | 'unavailable' }>;
  onOpen: (path: string, line?: number, column?: number, pinned?: boolean) => void;
  onClose: () => void;
}

function parseLocationQuery(value: string) {
  const query = value.trim();
  const match = query.match(/^(.*?):([1-9]\d*)(?::([1-9]\d*))?$/);
  const searchQuery = match?.[1]?.trim() || query;
  const line = match && searchQuery ? Number(match[2]) : undefined;
  const column = match?.[3] ? Number(match[3]) : undefined;
  return {
    searchQuery,
    line: Number.isSafeInteger(line) ? line : undefined,
    column: Number.isSafeInteger(column) ? column : undefined,
  };
}

function highlightMatches(value: string, query: string) {
  const chars = Array.from(value);
  const marked = new Set<number>();
  const lower = chars.map((char) => char.toLocaleLowerCase());
  const tokens = query.normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const needle = Array.from(token);
    let cursor = 0;
    const hits: number[] = [];
    for (const char of needle) {
      const found = lower.indexOf(char, cursor);
      if (found < 0) { hits.length = 0; break; }
      hits.push(found);
      cursor = found + 1;
    }
    if (hits.length === needle.length) hits.forEach((index) => marked.add(index));
  }
  if (!marked.size) return value;
  const parts: React.ReactNode[] = [];
  let start = 0;
  while (start < chars.length) {
    const isMarked = marked.has(start);
    let end = start + 1;
    while (end < chars.length && marked.has(end) === isMarked) end++;
    const text = chars.slice(start, end).join('');
    parts.push(isMarked ? <mark className="quick-open-match" key={start}>{text}</mark> : <React.Fragment key={start}>{text}</React.Fragment>);
    start = end;
  }
  return parts;
}

export default function QuickOpen({ cwd, treeVersion, recentFiles, openFiles, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('');
  const { searchQuery, line, column } = parseLocationQuery(query);
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [pinnedFiles, setPinnedFiles] = useState<string[]>(() => readPinnedFilePaths(cwd));
  const pinnedPaths = useMemo(() => new Set(pinnedFiles.map(normalizePinnedFilePath)), [pinnedFiles]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openFileByPath = useMemo(
    () => new Map(openFiles.map((file) => [normalizePathForComparison(file.path), file])),
    [openFiles],
  );
  const getOpenFile = (filePath: string) => openFileByPath.get(normalizePathForComparison(filePath));
  const openFileLabel = (file: NonNullable<ReturnType<typeof getOpenFile>>) => file.diskState === 'unavailable'
    ? '복원 대기'
    : file.diskState === 'missing'
      ? '삭제됨'
      : file.diskState === 'changed'
        ? '외부 변경'
        : file.dirty ? '수정됨' : file.active ? '현재' : '열림';
  const resultStatus = loading
    ? '파일을 검색하는 중'
    : error
      ? error
      : searchQuery.trim()
        ? `${results.length}${truncated ? '개 이상' : '개'} 파일 검색 결과`
        : `${results.filter((result) => pinnedPaths.has(normalizePinnedFilePath(result.path))).length}개 즐겨찾기 · ${results.length}개 파일`;

  useEffect(() => {
    setPinnedFiles(readPinnedFilePaths(cwd));
  }, [cwd, treeVersion]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    const value = searchQuery.trim();
    let cancelled = false;
    if (!value) {
      const root = normalizePinnedFilePath(cwd);
      const workspaceRecents = root
        ? recentFiles.filter((filePath) => normalizePinnedFilePath(filePath).startsWith(`${root}/`))
        : recentFiles;
      const favorites = pinnedFiles.map((filePath) => ({ path: filePath, favorite: true }));
      const favoritePaths = new Set(favorites.map((item) => normalizePinnedFilePath(item.path)));
      const recent = workspaceRecents.filter((filePath) => !favoritePaths.has(normalizePinnedFilePath(filePath)))
        .slice(0, Math.max(0, 12 - favorites.length)).map((filePath) => ({ path: filePath, favorite: false }));
      setResults([...favorites, ...recent].map(({ path: filePath }) => {
        const normalized = filePath.replace(/\\/g, '/');
        const relativePath = root && normalized.toLowerCase().startsWith(`${root}/`)
          ? normalized.slice(root.length + 1)
          : normalized;
        return { path: filePath, relativePath };
      }));
      setSelected(0);
      setLoading(false);
      setTruncated(false);
      setError('');
      return;
    }
    if (!cwd || !hasBridge()) {
      setResults([]);
      setLoading(false);
      setTruncated(false);
      setError('');
      return;
    }
    setResults([]);
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      api().searchFiles(cwd, value, { scope: 'quick-open' })
        .then((res) => {
          if (cancelled || res.error === 'CANCELLED') return;
          setResults(res.ok ? (res.files || []) : []);
          setTruncated(!!res.truncated);
          setError(res.ok ? '' : (res.error || '파일 검색 실패'));
          setSelected(0);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cwd, searchQuery, recentFiles, pinnedFiles]);

  useEffect(() => {
    if (!results[selected]) return;
    document.getElementById(`quick-open-result-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [results, selected]);

  const openSelected = (index = selected, pinned = false) => {
    const result = results[index];
    if (!result) return;
    onOpen(result.path, line, column, pinned);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((index) => results.length ? (index + 1) % results.length : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((index) => results.length ? (index - 1 + results.length) % results.length : 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSelected(selected, e.ctrlKey || e.metaKey);
    }
  };

  return (
    <div className="quick-open-backdrop" onMouseDown={onClose}>
      <section className="quick-open" role="dialog" aria-modal="true" aria-label="파일 빠르게 열기" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="quick-open-input-wrap">
          <SearchIcon size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="파일 이름, 경로 또는 파일:줄 검색…"
            aria-label="파일 검색"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={true}
            aria-controls="quick-open-results"
            aria-activedescendant={results[selected] ? `quick-open-result-${selected}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>ESC</kbd>
          <button className="icon-btn" onClick={onClose} title="닫기" aria-label="닫기"><XIcon size={15} /></button>
        </div>
        <div id="quick-open-results" className="quick-open-results" role="listbox" aria-label="파일 검색 결과" aria-busy={loading}>
          {!cwd && query.trim() ? (
            <div className="quick-open-empty">먼저 프로젝트 폴더를 선택해줘.</div>
          ) : !query.trim() ? (
            results.length === 0 ? (
              <div className="quick-open-empty">즐겨찾기나 최근 파일이 없어. 파일 이름을 입력해 찾아 열어줘.</div>
            ) : (
              <>
                <div className="quick-open-section">{pinnedFiles.length ? '즐겨찾기 · 최근 파일' : '최근 파일'}</div>
                {results.map((result, index) => {
                  const name = result.relativePath.split('/').pop() || result.relativePath;
                  const opened = getOpenFile(result.path);
                  return (
                    <button
                      type="button"
                      id={`quick-open-result-${index}`}
                      role="option"
                      aria-selected={index === selected}
                      key={result.path}
                      className={`quick-open-row${index === selected ? ' active' : ''}${opened ? ' open' : ''}`}
                      title={`${result.relativePath}${opened ? ` · ${openFileLabel(opened)}` : ''}`}
                      onMouseEnter={() => setSelected(index)}
                      onClick={() => openSelected(index)}
                    >
                      <FileTypeIcon name={name} size={17} />
                      <span className="quick-open-file-name">{highlightMatches(name, searchQuery)}</span>
                      {pinnedPaths.has(normalizePinnedFilePath(result.path)) && <span className="quick-open-favorite" title="즐겨찾기"><StarIcon size={13} /></span>}
                      <span className="quick-open-path">{highlightMatches(result.relativePath, searchQuery)}</span>
                      {opened && <span className={`quick-open-state${opened.diskState ? ` ${opened.diskState}` : opened.dirty ? ' dirty' : opened.active ? ' current' : ''}`}>{openFileLabel(opened)}</span>}
                      <span className="quick-open-enter">↵</span>
                    </button>
                  );
                })}
              </>
            )
          ) : loading && results.length === 0 ? (
            <div className="quick-open-empty">파일을 찾는 중…</div>
          ) : error ? (
            <div className="quick-open-empty">{error}</div>
          ) : results.length === 0 ? (
            <div className="quick-open-empty">일치하는 파일이 없어.</div>
          ) : (
            results.map((result, index) => {
              const name = result.relativePath.split('/').pop() || result.relativePath;
              const opened = getOpenFile(result.path);
              return (
                <button
                  type="button"
                  id={`quick-open-result-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  key={result.path}
                  className={`quick-open-row${index === selected ? ' active' : ''}${opened ? ' open' : ''}`}
                  title={`${result.relativePath}${opened ? ` · ${openFileLabel(opened)}` : ''}`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => openSelected(index)}
                >
                  <FileTypeIcon name={name} size={17} />
                  <span className="quick-open-file-name">{highlightMatches(name, searchQuery)}</span>
                  {pinnedPaths.has(normalizePinnedFilePath(result.path)) && <span className="quick-open-favorite" title="즐겨찾기"><StarIcon size={13} /></span>}
                  <span className="quick-open-path">{highlightMatches(result.relativePath, searchQuery)}</span>
                  {opened && <span className={`quick-open-state${opened.diskState ? ` ${opened.diskState}` : opened.dirty ? ' dirty' : opened.active ? ' current' : ''}`}>{openFileLabel(opened)}</span>}
                  <span className="quick-open-enter">↵</span>
                </button>
              );
            })
          )}
        </div>
        {truncated && <div className="quick-open-foot">결과가 많아 일부만 표시했어. 경로를 더 입력해줘.</div>}
        <div className="quick-open-hint">
          <span className="quick-open-status" role="status" aria-live="polite">
            {resultStatus}{line ? ` · ${line}행${column ? ` ${column}열` : ''}로 열기` : ''}
          </span>
          <span>↑↓ 이동</span><span>Enter 열기</span><span>Ctrl+Enter 고정 탭으로 열기</span><span>파일:줄[:열] 위치 이동</span><span>Esc 닫기</span>
        </div>
      </section>
    </div>
  );
}
