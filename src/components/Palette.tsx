import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '../types';
import { readRecentCommandIds, recordRecentCommand, writeRecentCommandIds } from '../lib/recent-command-history.mjs';
import { matchScore, parsePaletteQuery, scopePaletteItems } from '../lib/palette-query.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';

export interface PaletteAction {
  id: string;
  title: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}

interface Props {
  sessions: Session[];
  actions: PaletteAction[];
  onSelectThread: (id: string) => void;
  onClose: () => void;
}

export default function Palette({ sessions, actions, onSelectThread, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [recentCommandIds, setRecentCommandIds] = useState(() => readRecentCommandIds());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const paletteRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!returnFocusRef.current && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      returnFocusRef.current = document.activeElement;
    }
    inputRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      if (!target?.isConnected) return;
      scheduleAfterPaint(() => {
        if (!document.querySelector('[role="dialog"][aria-modal="true"]')) {
          target.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  const parsedQuery = parsePaletteQuery(query);
  const q = parsedQuery.query.toLowerCase();
  const threads = useMemo(() => {
    const matchingSessions = parsedQuery.scope === 'commands' || parsedQuery.scope === 'tabs' ? [] : sessions;
    const ranked = matchingSessions.map((session, order) => ({
      session,
      order,
      score: q ? matchScore(q, [session.title, session.cwd || '', ...session.messages.filter((message) => message.role === 'user').slice(-3).map((message) => message.text)]) : 0,
    })).filter((item) => item.score >= 0);
    ranked.sort((a, b) => b.score - a.score || a.order - b.order);
    return ranked.slice(0, 8).map((item) => item.session);
  }, [sessions, q, parsedQuery.scope]);
  const matchedActions = useMemo(() => {
    const matchingActions = scopePaletteItems(parsedQuery.scope, [], actions).actions;
    const ranked = matchingActions.map((action, order) => ({
      action,
      order,
      score: q ? matchScore(q, [action.title, action.id, action.hint || '', ...(action.keywords || [])]) : 0,
    })).filter((item) => item.score >= 0);
    ranked.sort((a, b) => b.score - a.score || a.order - b.order);
    return ranked.map((item) => item.action);
  }, [actions, q, parsedQuery.scope]);
  const recentActions = useMemo(() => {
    if (q || parsedQuery.scope === 'sessions' || parsedQuery.scope === 'tabs') return [];
    return recentCommandIds
      .map((id) => actions.find((action) => action.id === id))
      .filter((action): action is PaletteAction => !!action);
  }, [actions, q, parsedQuery.scope, recentCommandIds]);
  const recentActionIds = useMemo(() => new Set(recentActions.map((action) => action.id)), [recentActions]);
  const otherActions = useMemo(() => matchedActions.filter((action) => !recentActionIds.has(action.id)), [matchedActions, recentActionIds]);
  const total = threads.length + recentActions.length + otherActions.length;
  const selectedIndex = total > 0 ? Math.min(index, total - 1) : 0;
  const activeOptionId = total > 0 ? `command-palette-option-${selectedIndex}` : undefined;
  const actionSectionLabel = parsedQuery.scope === 'tabs' ? '열린 탭' : '명령';

  useEffect(() => {
    setIndex(0);
  }, [q, parsedQuery.scope]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.palette-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [index, threads.length, matchedActions.length]);

  const choose = (i: number) => {
    if (i < threads.length) onSelectThread(threads[i].id);
    else {
      const actionIndex = i - threads.length;
      const action = actionIndex < recentActions.length
        ? recentActions[actionIndex]
        : otherActions[actionIndex - recentActions.length];
      if (!action) return;
      const next = recordRecentCommand(recentCommandIds, action.id);
      setRecentCommandIds(next);
      writeRecentCommandIds(next);
      action.run();
    }
  };

  return (
    <div
      className="palette-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          const focusable = Array.from(paletteRef.current?.querySelectorAll<HTMLElement>(
            'input:not([disabled]), button:not([disabled])',
          ) || []).filter((element) => element.offsetParent !== null);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) {
            e.preventDefault();
            inputRef.current?.focus();
          } else if (e.shiftKey && (document.activeElement === first || !paletteRef.current?.contains(document.activeElement))) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && (document.activeElement === last || !paletteRef.current?.contains(document.activeElement))) {
            e.preventDefault();
            first.focus();
          }
        } else if (e.key === 'Escape') onClose();
        else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setIndex((v) => (total > 0 ? (Math.min(v, total - 1) + 1) % total : 0));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setIndex((v) => (total > 0 ? (Math.min(v, total - 1) - 1 + total) % total : 0));
        } else if (e.key === 'Home' && total > 0) {
          e.preventDefault();
          setIndex(0);
        } else if (e.key === 'End' && total > 0) {
          e.preventDefault();
          setIndex(total - 1);
        } else if (e.key === 'PageDown' && total > 0) {
          e.preventDefault();
          setIndex((v) => Math.min(total - 1, v + 8));
        } else if (e.key === 'PageUp' && total > 0) {
          e.preventDefault();
          setIndex((v) => Math.max(0, v - 8));
        } else if (e.key === 'Enter' && total > 0) {
          e.preventDefault();
          choose(selectedIndex);
        }
      }}
    >
      <div ref={paletteRef} className="palette" role="dialog" aria-modal="true" aria-label="명령 팔레트" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="검색 · >명령 · #세션 · @열린 탭"
          aria-label="검색"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="command-palette-options"
          aria-activedescendant={activeOptionId}
        />
        <div ref={listRef} id="command-palette-options" className="palette-list" role="listbox" aria-label={`${actionSectionLabel} 팔레트 결과`}>
          {threads.length > 0 && (
            <div role="group" aria-label="스레드">
              <div className="palette-head" aria-hidden="true">스레드</div>
              {threads.map((s, i) => (
                <div
                  key={s.id}
                  id={`command-palette-option-${i}`}
                  role="option"
                  aria-selected={i === selectedIndex}
                  aria-posinset={i + 1}
                  aria-setsize={total}
                  className={i === selectedIndex ? 'palette-row active' : 'palette-row'}
                  onClick={() => choose(i)}
                  onMouseEnter={() => setIndex(i)}
                >
                  <span className="palette-session-main">
                    <span className="palette-title">{s.title}</span>
                    {s.cwd && <span className="palette-session-context" title={s.cwd}>{s.cwd}</span>}
                  </span>
                  {(s.pinned || s.archived) && <span className="palette-session-state">{s.archived ? '보관됨' : '고정됨'}</span>}
                </div>
              ))}
            </div>
          )}
          {recentActions.length > 0 && (
            <div role="group" aria-label="최근 명령">
              <div className="palette-head" aria-hidden="true">최근 명령</div>
              {recentActions.map((action, index) => {
                const optionIndex = threads.length + index;
                return (
                  <div
                    key={`recent-${action.id}`}
                    id={`command-palette-option-${optionIndex}`}
                    role="option"
                    aria-selected={optionIndex === selectedIndex}
                    aria-posinset={optionIndex + 1}
                    aria-setsize={total}
                    className={optionIndex === selectedIndex ? 'palette-row active' : 'palette-row'}
                    onClick={() => choose(optionIndex)}
                    onMouseEnter={() => setIndex(optionIndex)}
                  >
                    <span className="palette-title">{action.title}</span>
                    <span className="palette-hint">{action.hint || '최근 사용'}</span>
                  </div>
                );
              })}
            </div>
          )}
          {otherActions.length > 0 && (
            <div role="group" aria-label={actionSectionLabel}>
              <div className="palette-head" aria-hidden="true">{actionSectionLabel}</div>
              {otherActions.map((a, j) => {
                const i = threads.length + recentActions.length + j;
                return (
                  <div
                    key={a.id}
                    id={`command-palette-option-${i}`}
                    role="option"
                    aria-selected={i === selectedIndex}
                    aria-posinset={i + 1}
                    aria-setsize={total}
                    className={i === selectedIndex ? 'palette-row active' : 'palette-row'}
                    onClick={() => choose(i)}
                    onMouseEnter={() => setIndex(i)}
                  >
                    <span className="palette-title">{a.title}</span>
                    {a.hint && <span className="palette-hint">{a.hint}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {total === 0 && <div className="empty-note">{parsedQuery.scope === 'tabs' ? '일치하는 열린 탭이 없습니다.' : '결과가 없습니다.'}</div>}
        </div>
        <div className="palette-hint">
          <span role="status" aria-live="polite">{total > 0 ? `${total}개 결과 · ↑↓ 이동 · Enter 실행 · Home/End 처음/끝 · PgUp/PgDn 빠른 이동` : '결과가 없습니다.'} · &gt; 명령 · # 세션 · @ 열린 탭{recentActions.length > 0 ? ' · 최근 명령은 이 기기에 저장' : ''}</span>
          {!q && recentActions.length > 0 && <button type="button" className="palette-history-clear" onClick={() => {
            setRecentCommandIds([]);
            writeRecentCommandIds([]);
          }}>최근 기록 지우기</button>}
        </div>
      </div>
    </div>
  );
}
