import React, { useEffect, useRef, useState } from 'react';
import { api, hasBridge } from '../lib/mudex';
import { agentBadgeState } from '../lib/browser-agent-badge.mjs';
import type { BrowserBookmark } from '../lib/browser-bookmarks.mjs';
import { isBrowserBookmarked } from '../lib/browser-bookmarks.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import type { BrowserShortcut } from '../types';
import { BackIcon, ChevronDownIcon, CopyIcon, ForwardIcon, GlobeIcon, HomeIcon, RefreshIcon, SearchIcon, StarIcon, StopIcon, XIcon } from './icons';
import { useLang, useStrings } from '../lib/lang';
import { formatStr } from '../lib/i18n.mjs';

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

function hostOf(url: string, fallback: string): string {
  try {
    const h = new URL(url).host;
    return h || url;
  } catch {
    return url || fallback;
  }
}

// One browser tab: the user browses here, and CLI agents drive the same
// page through the MCP bridge. The page itself is a native WebContentsView
// positioned over .browser-viewport (main process owns it). The native
// view paints above all React UI, so it parks whenever `obscured` (the
// [+] menu drops over its area) or the tab is not visible.
export default function BrowserTab(props: Props) {
  const s = useStrings();
  const lang = useLang();
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
      .then((st) => {
        if (st.ok) {
          setAddr(st.url || '');
          setLoading(st.loading);
          setCanBack(st.canGoBack);
          setCanFwd(st.canGoForward);
          if (st.url && st.url !== 'about:blank') urlRef.current(tabId, st.url);
          if (st.title || st.url) titleRef.current(tabId, st.title || hostOf(st.url || '', s.browser.newTab));
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
        titleRef.current(tabId, hostOf(ev.url, s.browser.newTab));
        api()
          .browserState(tabId)
          .then((st) => {
            if (st.ok) {
              setCanBack(st.canGoBack);
              setCanFwd(st.canGoForward);
            }
          })
          .catch(() => {});
      } else if (ev.type === 'title') {
        titleRef.current(tabId, ev.title || hostOf(ev.url, s.browser.newTab));
      } else if (ev.type === 'loading') {
        setLoading(ev.loading);
        if (!editingRef.current && ev.url) setAddr(ev.url);
      } else if (ev.type === 'failed') {
        setLoading(false);
        props.onNotice(formatStr(s.browser.openFailed, { detail: ev.desc || ev.code }));
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
  }, lang);
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
          if (!r.aborted) props.onNotice(formatStr(s.browser.navFailed, { detail: r.error || r.desc || (r.code != null ? String(r.code) : '') || s.common.unknownError }));
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
      props.onNotice(s.browser.copiedAddr);
    } catch {
      props.onNotice(s.browser.copyAddrFailed);
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
        <button type="button" className="icon-btn" title={s.browser.back} aria-label={s.browser.backLabel} disabled={!canBack} onClick={() => hasBridge() && api().browserBack(tabId).catch(() => {})}>
          <BackIcon size={15} />
        </button>
        <button type="button" className="icon-btn" title={s.browser.fwd} aria-label={s.browser.fwdLabel} disabled={!canFwd} onClick={() => hasBridge() && api().browserForward(tabId).catch(() => {})}>
          <ForwardIcon size={15} />
        </button>
        {loading ? (
          <button type="button" className="icon-btn" title={s.browser.stop} aria-label={s.browser.stopLabel} onClick={() => hasBridge() && api().browserStop(tabId).catch(() => {})}>
            <StopIcon size={15} />
          </button>
        ) : (
          <button type="button" className="icon-btn" title={s.browser.reload} aria-label={s.browser.reloadLabel} onClick={() => hasBridge() && api().browserReload(tabId).catch(() => {})}>
            <RefreshIcon size={15} />
          </button>
        )}
        <button type="button" className="icon-btn" title={s.browser.homeTitle} aria-label={s.browser.homeLabel} onClick={goHome}>
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
            placeholder={s.browser.addrPlaceholder}
            title={s.browser.addrTitle}
            spellCheck={false}
            aria-label={s.browser.addrLabel}
          />
          {loading && <span className="addr-spin" aria-hidden />}
        </div>
        <button type="button" className="icon-btn" title={bookmarked ? s.browser.unbookmark : s.browser.bookmark} aria-label={bookmarked ? s.browser.unbookmarkLabel : s.browser.bookmarkLabel} disabled={!addr.trim()} onClick={() => props.onToggleBookmark(tabId, addr)}>
          <StarIcon size={14} filled={bookmarked} />
        </button>
        <button type="button" className="icon-btn" title={s.browser.copyAddrTitle} aria-label={s.browser.copyAddrLabel} disabled={!addr.trim()} onClick={() => void copyAddress()}>
          <CopyIcon size={14} />
        </button>
        <button type="button" className="icon-btn" title={s.browser.findTitle} aria-label={s.browser.findLabel} onClick={() => setFindOpen(true)}>
          <SearchIcon size={14} />
        </button>
        <button className="btn" onClick={go}>
          {s.browser.goBtn}
        </button>
        {badge.mode === 'active' ? (
          <span className="agent-badge on" title={badge.title}>
            <span className="pulse" /> {badge.label}
          </span>
        ) : badge.clickable ? (
          <button type="button" className={badgeCls} title={badge.title} onClick={refreshHealth} aria-label={formatStr(s.browser.badgeRetry, { label: badge.label })}>
            {badge.label}
          </button>
        ) : (
          <span className={badgeCls} title={badge.title}>
            {badge.label}
          </span>
        )}
      </div>
      {findOpen && (
        <div className="browser-find-bar" role="search" aria-label={s.browser.findLabel} onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); closeFind(); }
          else if (event.key === 'Enter') { event.preventDefault(); moveFindMatch(!event.shiftKey); }
        }}>
          <SearchIcon size={14} />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(event) => setFindQuery(event.target.value)}
            aria-label={s.browser.findTextLabel}
            placeholder={s.browser.findLabel}
            autoComplete="off"
          />
          <span className="browser-find-count" role="status" aria-live="polite">
            {findQuery ? (findMatches ? `${activeMatchOrdinal}/${findMatches}` : s.browser.noMatch) : ''}
          </span>
          <button type="button" className="icon-btn" title={s.browser.prevTitle} aria-label={s.browser.prevLabel} disabled={!findMatches} onClick={() => moveFindMatch(false)}><ChevronDownIcon size={13} className="message-find-prev" /></button>
          <button type="button" className="icon-btn" title={s.browser.nextTitle} aria-label={s.browser.nextLabel} disabled={!findMatches} onClick={() => moveFindMatch(true)}><ChevronDownIcon size={13} /></button>
          <button type="button" className="icon-btn" title={s.browser.findCloseTitle} aria-label={s.browser.findCloseLabel} onClick={closeFind}><XIcon size={13} /></button>
        </div>
      )}
      <div ref={boxRef} className="browser-viewport">
        {!hasBridge() && (
          <div className="empty-note">{s.browser.needElectron}</div>
        )}
      </div>
    </section>
  );
}
