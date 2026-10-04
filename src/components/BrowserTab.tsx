import React, { useEffect, useRef, useState } from 'react';
import { api, hasBridge } from '../lib/mudex';
import { agentBadgeState } from '../lib/browser-agent-badge.mjs';
import type { BrowserBookmark } from '../lib/browser-bookmarks.mjs';
import { isBrowserBookmarked } from '../lib/browser-bookmarks.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import type { BrowserShortcut } from '../types';
import { BackIcon, ChevronDownIcon, CopyIcon, ForwardIcon, GlobeIcon, HomeIcon, RefreshIcon, SearchIcon, StarIcon, StopIcon, XIcon } from './icons';

interface Props {
  tabId: string;
  home: string;
  initialUrl?: string;
  agentEnabled: boolean;
  active: boolean;
  obscured: boolean;
  onTitle: (tabId: string, title: string) => void;
  onUrl: (tabId: string, url: string) => void;
  onClose: () => void;
  onCloseAll: () => void;
  onSwitchTab: (mode: 'recent-next' | 'recent-previous' | 'ordered-left' | 'ordered-right') => void;
  onMoveTab: (direction: -1 | 1) => void;
  onAppShortcut: (shortcut: BrowserShortcut) => void;
  onNotice: (msg: string) => void;
  bookmarks: BrowserBookmark[];
  onToggleBookmark: (tabId: string, url: string) => void;
}

function hostOf(url: string): string {
  try {
    const h = new URL(url).host;
    return h || url;
  } catch {
    return url || '새 탭';
  }
}

// One browser tab: the user browses here, and CLI agents drive the same
// page through the MCP bridge. The page itself is a native WebContentsView
// positioned over .browser-viewport (main process owns it). The native
// view paints above all React UI, so it parks whenever `obscured` (the
// [+] menu drops over its area) or the tab is not visible.
export default function BrowserTab(props: Props) {
  const { tabId } = props;
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const editingRef = useRef(false);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState(0);
  const [activeMatchOrdinal, setActiveMatchOrdinal] = useState(0);
  const [agentAt, setAgentAt] = useState(0);
  const [agentMethod, setAgentMethod] = useState('');
  const [health, setHealth] = useState<{ ok: boolean; reason?: string | null } | null>(null);

  // Live bridge signal (same pre-flight the engine runs). Never claims a
  // connection from the setting alone.
  const refreshHealth = () => {
    if (!hasBridge() || !props.agentEnabled) {
      setHealth(null);
      return;
    }
    api()
      .browserHealth()
      .then((r) => setHealth({ ok: r.ok, reason: r.reason || null }))
      .catch(() => setHealth({ ok: false, reason: 'HEALTH_CHECK_FAILED' }));
  };
  const boxRef = useRef<HTMLDivElement | null>(null);
  const addrRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const findQueryRef = useRef(findQuery);
  findQueryRef.current = findQuery;
  const titleRef = useRef(props.onTitle);
  titleRef.current = props.onTitle;
  const urlRef = useRef(props.onUrl);
  urlRef.current = props.onUrl;
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const closeAllRef = useRef(props.onCloseAll);
  closeAllRef.current = props.onCloseAll;
  const switchTabRef = useRef(props.onSwitchTab);
  switchTabRef.current = props.onSwitchTab;
  const moveTabRef = useRef(props.onMoveTab);
  moveTabRef.current = props.onMoveTab;
  const appShortcutRef = useRef(props.onAppShortcut);
  appShortcutRef.current = props.onAppShortcut;

  const pushBounds = () => {
    const el = boxRef.current;
    if (!el || !hasBridge()) return;
    const r = el.getBoundingClientRect();
    api()
      .browserBounds({ x: r.left, y: r.top, width: r.width, height: r.height })
      .catch(() => {});
  };

  // Mount: show the native view, sync state, track bounds.
  // Unmount (tab closed): destroy the native view.
  useEffect(() => {
    if (!hasBridge()) return;
    if (props.active && !props.obscured && !findOpen) {
      api()
        .browserShow(tabId, props.home || undefined, props.initialUrl || undefined)
        .catch((e) => props.onNotice(e instanceof Error ? e.message : String(e)));
    }
    api()
      .browserState(tabId)
      .then((s) => {
        if (s.ok) {
          setAddr(s.url || '');
          setLoading(s.loading);
          setCanBack(s.canGoBack);
          setCanFwd(s.canGoForward);
          if (s.url && s.url !== 'about:blank') urlRef.current(tabId, s.url);
          if (s.title || s.url) titleRef.current(tabId, s.title || hostOf(s.url || ''));
        }
      })
      .catch(() => {});
    pushBounds();
    const ro = new ResizeObserver(() => pushBounds());
    if (boxRef.current) ro.observe(boxRef.current);
    window.addEventListener('resize', pushBounds);
    const off = api().onBrowserEvent((ev) => {
      if (ev.tabId !== tabId) return;
      if (ev.type === 'url') {
        if (!editingRef.current) setAddr(ev.url);
        if (ev.url) urlRef.current(tabId, ev.url);
        titleRef.current(tabId, hostOf(ev.url));
        api()
          .browserState(tabId)
          .then((s) => {
            if (s.ok) {
              setCanBack(s.canGoBack);
              setCanFwd(s.canGoForward);
            }
          })
          .catch(() => {});
      } else if (ev.type === 'title') {
        titleRef.current(tabId, ev.title || hostOf(ev.url));
      } else if (ev.type === 'loading') {
        setLoading(ev.loading);
        if (!editingRef.current && ev.url) setAddr(ev.url);
      } else if (ev.type === 'failed') {
        setLoading(false);
        props.onNotice(`페이지 열기 실패: ${ev.desc || ev.code}`);
      } else if (ev.type === 'agent') {
        setAgentAt(Date.now());
        setAgentMethod(ev.method);
      } else if (ev.type === 'shortcut' && ev.shortcut === 'focus-address') {
        editingRef.current = true;
        scheduleAfterPaint(() => {
          addrRef.current?.focus();
          addrRef.current?.select();
        });
      } else if (ev.type === 'shortcut' && ev.shortcut === 'find-in-page') {
        setFindOpen(true);
      } else if (ev.type === 'shortcut' && ev.shortcut === 'close-tab') {
        closeRef.current();
      } else if (ev.type === 'shortcut' && ev.shortcut === 'close-all-tabs') {
        closeAllRef.current();
      } else if (ev.type === 'shortcut' && ev.shortcut.startsWith('recent-tab-')) {
        switchTabRef.current(ev.shortcut === 'recent-tab-next' ? 'recent-next' : 'recent-previous');
      } else if (ev.type === 'shortcut' && ev.shortcut.startsWith('ordered-tab-')) {
        switchTabRef.current(ev.shortcut === 'ordered-tab-right' ? 'ordered-right' : 'ordered-left');
      } else if (ev.type === 'shortcut' && ev.shortcut.startsWith('move-tab-')) {
        moveTabRef.current(ev.shortcut === 'move-tab-right' ? 1 : -1);
      } else if (ev.type === 'shortcut') {
        appShortcutRef.current(ev.shortcut);
      } else if (ev.type === 'find-result' && ev.query === findQueryRef.current) {
        setFindMatches(ev.matches);
        setActiveMatchOrdinal(ev.activeMatchOrdinal);
      }
    });
    // Opportunistic health: session pre-flight results feed the same badge.
    const offHealth = api().onMspMcpHealth((p) => {
      const entry = (p.health || []).find((h) => h.name === 'musician-browser');
      if (entry) setHealth({ ok: entry.ok, reason: entry.reason });
    });
    const offUnavailable = api().onMspMcpUnavailable(() => {
      setHealth({ ok: false, reason: 'CLI_MCP_UNAVAILABLE' });
    });
    return () => {
      off();
      offHealth();
      offUnavailable();
      ro.disconnect();
      window.removeEventListener('resize', pushBounds);
      if (hasBridge()) api().browserClose(tabId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Mount + setting flips (re-)check the live signal; clearing when off.
  useEffect(() => {
    refreshHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agentEnabled]);

  // Visibility: park the native view unless this tab is shown and clear.
  useEffect(() => {
    if (!hasBridge()) return;
    if (props.active && !props.obscured) {
      api()
        .browserShow(tabId, props.home || undefined, props.initialUrl || undefined)
        .catch(() => {})
        .finally(() => pushBounds());
    } else {
      api().browserHide(tabId).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active, props.obscured, findOpen, tabId]);

  useEffect(() => {
    if (!findOpen || !hasBridge()) return;
    if (!findQuery.trim()) {
      setFindMatches(0);
      setActiveMatchOrdinal(0);
      void api().browserFind(tabId, '').catch(() => {});
      return;
    }
    const timer = window.setTimeout(() => {
      void api().browserFind(tabId, findQuery, true, false).catch(() => {});
    }, 90);
    return () => window.clearTimeout(timer);
  }, [findOpen, findQuery, tabId]);

  useEffect(() => {
    if (!findOpen) return;
    scheduleAfterPaint(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [findOpen]);

  // Agent badge fades a few seconds after the last agent action.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!agentAt) return;
    const t = setTimeout(() => setTick((n) => n + 1), 3200);
    return () => clearTimeout(t);
  }, [agentAt]);
  const agentActive = agentAt > 0 && Date.now() - agentAt < 3000;
  const badge = agentBadgeState({
    agentEnabled: props.agentEnabled && hasBridge(),
    health,
    agentActive,
    method: agentMethod,
  });
  const badgeCls = badge.mode === 'off' ? 'agent-badge off' : badge.mode === 'down' ? 'agent-badge down' : 'agent-badge';

  const navigateTo = (target: string) => {
    const url = target.trim();
    if (!url || !hasBridge()) return;
    editingRef.current = false;
    addrRef.current?.blur();
    setAddr(url);
    setLoading(true);
    api()
      .browserNavigate(tabId, url)
      .then((r) => {
        if (!r.ok) {
          setLoading(false);
          // Aborted loads (superseded/stopped) are benign — stay silent.
          if (!r.aborted) props.onNotice(`이동 실패: ${r.error || r.desc || (r.code != null ? String(r.code) : '') || '알 수 없는 오류'}`);
        }
      })
      .catch((e) => {
        setLoading(false);
        props.onNotice(e instanceof Error ? e.message : String(e));
      });
  };

  const go = () => navigateTo(addr);
  const goHome = () => navigateTo(props.home.trim() || 'https://www.google.com');

  const copyAddress = async () => {
    const value = addr.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      props.onNotice('브라우저 주소를 복사했어.');
    } catch {
      props.onNotice('브라우저 주소를 복사하지 못했어.');
    }
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindQuery('');
    setFindMatches(0);
    setActiveMatchOrdinal(0);
    if (hasBridge()) void api().browserFind(tabId, '').catch(() => {});
  };

  const moveFindMatch = (forward: boolean) => {
    if (!findQuery.trim() || !hasBridge()) return;
    void api().browserFind(tabId, findQuery, forward, true).catch(() => {});
  };

  const bookmarked = isBrowserBookmarked(props.bookmarks, addr);

  return (
    <section className="browser-tab">
      <div className="browser-bar">
        <button type="button" className="icon-btn" title="뒤로" aria-label="브라우저 뒤로" disabled={!canBack} onClick={() => hasBridge() && api().browserBack(tabId).catch(() => {})}>
          <BackIcon size={15} />
        </button>
        <button type="button" className="icon-btn" title="앞으로" aria-label="브라우저 앞으로" disabled={!canFwd} onClick={() => hasBridge() && api().browserForward(tabId).catch(() => {})}>
          <ForwardIcon size={15} />
        </button>
        {loading ? (
          <button type="button" className="icon-btn" title="중지" aria-label="브라우저 탐색 중지" onClick={() => hasBridge() && api().browserStop(tabId).catch(() => {})}>
            <StopIcon size={15} />
          </button>
        ) : (
          <button type="button" className="icon-btn" title="새로고침" aria-label="브라우저 새로고침" onClick={() => hasBridge() && api().browserReload(tabId).catch(() => {})}>
            <RefreshIcon size={15} />
          </button>
        )}
        <button type="button" className="icon-btn" title="홈으로 이동" aria-label="브라우저 홈" onClick={goHome}>
          <HomeIcon size={15} />
        </button>
        <div className="addr-wrap">
          <GlobeIcon size={14} />
          <input
            ref={addrRef}
            className="addr-input"
            value={addr}
            onChange={(e) => {
              editingRef.current = true;
              setAddr(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go();
              else if (e.key === 'Escape') {
                editingRef.current = false;
                addrRef.current?.blur();
              }
            }}
            onBlur={() => { editingRef.current = false; }}
            placeholder="주소 또는 검색어 입력 후 Enter"
            title="주소 또는 검색어 입력 · Ctrl+L로 주소창 선택"
            spellCheck={false}
            aria-label="주소"
          />
          {loading && <span className="addr-spin" aria-hidden />}
        </div>
        <button type="button" className="icon-btn" title={bookmarked ? '북마크에서 제거' : '북마크에 추가'} aria-label={bookmarked ? '브라우저 북마크에서 제거' : '브라우저 북마크에 추가'} disabled={!addr.trim()} onClick={() => props.onToggleBookmark(tabId, addr)}>
          <StarIcon size={14} filled={bookmarked} />
        </button>
        <button type="button" className="icon-btn" title="주소 복사" aria-label="브라우저 주소 복사" disabled={!addr.trim()} onClick={() => void copyAddress()}>
          <CopyIcon size={14} />
        </button>
        <button type="button" className="icon-btn" title="페이지에서 찾기 (Ctrl+F)" aria-label="페이지에서 찾기" onClick={() => setFindOpen(true)}>
          <SearchIcon size={14} />
        </button>
        <button className="btn" onClick={go}>
          이동
        </button>
        {badge.mode === 'active' ? (
          <span className="agent-badge on" title={badge.title}>
            <span className="pulse" /> {badge.label}
          </span>
        ) : badge.clickable ? (
          <button type="button" className={badgeCls} title={badge.title} onClick={refreshHealth} aria-label={`${badge.label} - 다시 연결`}>
            {badge.label}
          </button>
        ) : (
          <span className={badgeCls} title={badge.title}>
            {badge.label}
          </span>
        )}
      </div>
      {findOpen && (
        <div className="browser-find-bar" role="search" aria-label="페이지에서 찾기" onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); closeFind(); }
          else if (event.key === 'Enter') { event.preventDefault(); moveFindMatch(!event.shiftKey); }
        }}>
          <SearchIcon size={14} />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
            aria-label="웹페이지에서 찾을 텍스트"
            placeholder="페이지에서 찾기"
            autoComplete="off"
          />
          <span className="browser-find-count" role="status" aria-live="polite">
            {findQuery ? (findMatches ? `${activeMatchOrdinal}/${findMatches}` : '일치 없음') : ''}
          </span>
          <button type="button" className="icon-btn" title="이전 결과 (Shift+Enter)" aria-label="이전 검색 결과" disabled={!findMatches} onClick={() => moveFindMatch(false)}><ChevronDownIcon size={13} className="message-find-prev" /></button>
          <button type="button" className="icon-btn" title="다음 결과 (Enter)" aria-label="다음 검색 결과" disabled={!findMatches} onClick={() => moveFindMatch(true)}><ChevronDownIcon size={13} /></button>
          <button type="button" className="icon-btn" title="검색 닫기 (Esc)" aria-label="페이지 검색 닫기" onClick={closeFind}><XIcon size={13} /></button>
        </div>
      )}
      <div ref={boxRef} className="browser-viewport">
        {!hasBridge() && (
          <div className="empty-note">Electron 앱에서 실행해야 브라우저를 사용할 수 있습니다.</div>
        )}
      </div>
    </section>
  );
}
