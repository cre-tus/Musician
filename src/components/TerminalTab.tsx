import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, hasBridge } from '../lib/mudex';
import { rankTerminalHistory } from '../lib/terminal-history-search.mjs';
import { findTerminalLinks } from '../lib/terminal-links.mjs';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { CopyIcon, RefreshIcon, StopIcon } from './icons';

interface Props {
  tabId: string;
  shell: 'powershell' | 'cmd';
  cwd: string;
  dark: boolean;
  active: boolean;
  onShellChange: (shell: 'powershell' | 'cmd') => void;
  onNotice: (msg: string) => void;
}

const TERMINAL_HISTORY_KEY = 'mudex:terminal-history:v1';
const HISTORY_LIMIT = 200;
const HISTORY_CONTEXT_LIMIT = 24;

function terminalHistoryScope(shell: Props['shell'], cwd: string): string {
  return JSON.stringify([shell, cwd || '']);
}

function loadTerminalHistory(scope: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TERMINAL_HISTORY_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const history = (raw as Record<string, unknown>)[scope];
    return Array.isArray(history) ? history.filter((entry): entry is string => typeof entry === 'string').slice(-HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveTerminalHistory(scope: string, history: string[]) {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TERMINAL_HISTORY_KEY) || '{}');
    const previous = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const ordered = Object.entries(previous).filter(([key, value]) => key !== scope && Array.isArray(value));
    ordered.push([scope, history.slice(-HISTORY_LIMIT)]);
    const retained = ordered.slice(-HISTORY_CONTEXT_LIMIT);
    localStorage.setItem(TERMINAL_HISTORY_KEY, JSON.stringify(Object.fromEntries(retained)));
  } catch {
    /* storage may be unavailable or full */
  }
}

// Terminal tab: xterm rendering over a piped shell (line mode — type a
// line, Enter to run). Full-screen TUI apps don't work without a PTY.
export default function TerminalTab(props: Props) {
  const { tabId, shell, cwd, dark, active } = props;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [running, setRunning] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const lineRef = useRef('');
  const cursorRef = useRef(0);
  const histRef = useRef<string[]>([]);
  const historyScopeRef = useRef(terminalHistoryScope(shell, cwd));
  const histIdxRef = useRef(-1);
  const historySearchInputRef = useRef<HTMLInputElement | null>(null);
  const historyResultsRef = useRef<HTMLDivElement | null>(null);
  const historySearchDraftRef = useRef<{ line: string; cursor: number } | null>(null);
  const replaceLineRef = useRef<(next: string, nextCursor?: number) => void>(() => {});
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historySearchIndex, setHistorySearchIndex] = useState(0);
  const runningRef = useRef(false);
  runningRef.current = running;
  const shellSeqRef = useRef(0);
  const historyMatches = rankTerminalHistory(histRef.current, historySearchQuery);

  useEffect(() => {
    if (historySearchOpen) historySearchInputRef.current?.focus();
  }, [historySearchOpen]);

  useEffect(() => {
    if (historySearchOpen) historyResultsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [historySearchOpen, historySearchIndex, historySearchQuery]);

  const finishHistorySearch = (restoreDraft: boolean) => {
    if (restoreDraft && historySearchDraftRef.current) {
      const { line, cursor } = historySearchDraftRef.current;
      replaceLineRef.current(line, cursor);
    }
    historySearchDraftRef.current = null;
    setHistorySearchOpen(false);
    scheduleAfterPaint(() => termRef.current?.focus());
  };

  const acceptHistorySearch = () => {
    const match = historyMatches[historySearchIndex];
    if (!match) return;
    replaceLineRef.current(match.command);
    histIdxRef.current = match.index;
    finishHistorySearch(false);
  };

  const startShell = (sh: 'powershell' | 'cmd') => {
    if (!hasBridge()) return;
    shellSeqRef.current += 1;
    const want = shellSeqRef.current;
    setRunning(true);
    api()
      .termStart(tabId, sh, cwd || '', want)
      .then((r) => {
        if (!r.ok) {
          setRunning(false);
          props.onNotice(`터미널 시작 실패: ${r.error || '알 수 없는 오류'}`);
        } else if (typeof r.seq === 'number') {
          shellSeqRef.current = r.seq;
        }
      })
      .catch((e) => {
        setRunning(false);
        props.onNotice(e instanceof Error ? e.message : String(e));
      });
  };

  const restart = () => {
    if (!hasBridge()) return;
    api()
      .termKill(tabId)
      .catch(() => {})
      .finally(() => {
        termRef.current?.clear();
        lineRef.current = '';
        cursorRef.current = 0;
        histIdxRef.current = -1;
        startShell(shell);
      });
  };

  const kill = () => {
    if (!hasBridge()) return;
    api().termKill(tabId).catch(() => {});
  };

  // Mount: xterm + shell + output events. Unmount (tab closed): kill shell.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !hasBridge()) return;
    histRef.current = loadTerminalHistory(historyScopeRef.current);
    const terminalFont = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace';
    const term = new Terminal({
      fontSize: 13,
      fontFamily: terminalFont,
      cursorBlink: true,
      theme: dark
        ? { background: '#111312', foreground: '#f2f3f2', cursor: '#68aaff' }
        : { background: '#ffffff', foreground: '#202221', cursor: '#0968db' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Clickable http(s) links, opened through the shared external-link
    // bridge (same allowlist as chat links). Single-line spans only:
    // wrapped URLs stay text.
    const linkDisposable = term.registerLinkProvider({
      provideLinks: (lineNumber, callback) => {
        try {
          const text = term.buffer.active.getLine(lineNumber)?.translateToString(true) ?? '';
          callback(findTerminalLinks(text).map((link) => ({
            range: { start: { x: link.start, y: lineNumber }, end: { x: link.end, y: lineNumber } },
            text: link.url,
            activate: (_event, url) => {
              if (!hasBridge()) return;
              void api().openExternalLink(url).catch(() => {});
            },
          })));
        } catch {
          callback(undefined);
        }
      },
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey)) return true;
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault(); // xterm: returning false alone doesn't stop reload
        event.stopPropagation();
        if (!runningRef.current || historySearchOpen) return false;
        historySearchDraftRef.current = { line: lineRef.current, cursor: cursorRef.current };
        setHistorySearchQuery('');
        setHistorySearchIndex(0);
        setHistorySearchOpen(true);
        return false;
      }
      if (event.key.toLowerCase() === 'l') {
        term.clear();
        return false;
      }
      if (event.key.toLowerCase() === 'c' && term.hasSelection()) {
        try {
          void navigator.clipboard.writeText(term.getSelection()).catch(() => props.onNotice('터미널 선택 내용을 복사하지 못했습니다.'));
        } catch {
          props.onNotice('터미널 선택 내용을 복사하지 못했습니다.');
        }
        return false;
      }
      if (event.key.toLowerCase() === 'v') {
        try {
          void navigator.clipboard.readText()
            .then((text) => term.paste(text.replace(/\r?\n/g, ' ')))
            .catch(() => props.onNotice('클립보드 내용을 붙여넣지 못했습니다.'));
        } catch {
          props.onNotice('클립보드 내용을 붙여넣지 못했습니다.');
        }
        return false;
      }
      return true;
    });
    try {
      fit.fit();
    } catch {
      /* sized on first resize */
    }
    termRef.current = term;
    fitRef.current = fit;
    const selectionDisposable = term.onSelectionChange(() => setHasSelection(term.hasSelection()));

    const off = api().onTermEvent((ev) => {
      if (ev.tabId !== tabId) return;
      if (typeof ev.seq === 'number' && ev.seq !== shellSeqRef.current) return;
      if (ev.type === 'output') {
        term.write(ev.text.replace(/\r?\n/g, '\r\n'));
      } else {
        setRunning(false);
        const msg = ev.error ? `종료됨: ${ev.error}` : `종료됨 (코드 ${ev.code})`;
        term.write(`\r\n\x1b[90m${msg} — 다시 시작으로 새 셸\x1b[0m\r\n`);
      }
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* hidden tab */
      }
    });
    ro.observe(el);

    const cells = (text: string) => Array.from(text).reduce((total, char) => {
      const point = char.codePointAt(0) || 0;
      const wide = point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a || (point >= 0x2e80 && point <= 0xa4cf) || (point >= 0xac00 && point <= 0xd7a3) || (point >= 0xf900 && point <= 0xfaff) || (point >= 0xfe10 && point <= 0xfe6f) || (point >= 0xff00 && point <= 0xff60) || (point >= 0xffe0 && point <= 0xffe6));
      return total + (wide ? 2 : 1);
    }, 0);
    const replaceLine = (next: string, nextCursor = Array.from(next).length) => {
      const previous = Array.from(lineRef.current);
      const previousCursor = Math.max(0, Math.min(cursorRef.current, previous.length));
      const prefixWidth = cells(previous.slice(0, previousCursor).join(''));
      const previousWidth = cells(previous.join(''));
      if (prefixWidth) term.write(`\x1b[${prefixWidth}D`);
      if (previousWidth) term.write(`\x1b[${previousWidth}P`);
      const nextChars = Array.from(next);
      const safeCursor = Math.max(0, Math.min(nextCursor, nextChars.length));
      lineRef.current = next;
      cursorRef.current = safeCursor;
      term.write(next);
      const suffixWidth = cells(nextChars.slice(safeCursor).join(''));
      if (suffixWidth) term.write(`\x1b[${suffixWidth}D`);
    };
    replaceLineRef.current = replaceLine;

    const disp = term.onData((data) => {
      if (!runningRef.current) return;
      for (let index = 0; index < data.length;) {
        const keySequence = data.slice(index, index + 3);
        if (keySequence === '\x1b[A' || keySequence === '\x1b[B') {
          const h = histRef.current;
          if (h.length === 0) {
            index += 3;
            continue;
          }
          let historyIndex = histIdxRef.current;
          if (keySequence === '\x1b[A') {
            historyIndex = historyIndex < 0 ? h.length - 1 : Math.max(0, historyIndex - 1);
          } else {
            historyIndex = historyIndex < 0 ? -1 : Math.min(h.length - 1, historyIndex + 1);
            if (histIdxRef.current >= 0 && historyIndex === histIdxRef.current && historyIndex === h.length - 1) historyIndex = -1;
          }
          histIdxRef.current = historyIndex;
          const next = historyIndex < 0 ? '' : h[historyIndex];
          replaceLine(next);
          index += 3;
          continue;
        }
        if (keySequence === '\x1b[D' || keySequence === '\x1b[C') {
          const chars = Array.from(lineRef.current);
          if (keySequence === '\x1b[D' && cursorRef.current > 0) {
            const amount = cells(chars[cursorRef.current - 1]);
            term.write(`\x1b[${amount}D`);
            cursorRef.current -= 1;
          } else if (keySequence === '\x1b[C' && cursorRef.current < chars.length) {
            const amount = cells(chars[cursorRef.current]);
            term.write(`\x1b[${amount}C`);
            cursorRef.current += 1;
          }
          index += 3;
          continue;
        }
        if (keySequence === '\x1b[H' || keySequence === '\x1b[F') {
          const chars = Array.from(lineRef.current);
          const nextCursor = keySequence === '\x1b[H' ? 0 : chars.length;
          const movement = cells(chars.slice(Math.min(cursorRef.current, nextCursor), Math.max(cursorRef.current, nextCursor)).join(''));
          if (movement) term.write(`\x1b[${movement}${nextCursor < cursorRef.current ? 'D' : 'C'}`);
          cursorRef.current = nextCursor;
          index += 3;
          continue;
        }
        if (data.slice(index, index + 4) === '\x1b[3~') {
          const chars = Array.from(lineRef.current);
          if (cursorRef.current < chars.length) {
            const amount = cells(chars[cursorRef.current]);
            term.write(`\x1b[${amount}P`);
            chars.splice(cursorRef.current, 1);
            lineRef.current = chars.join('');
          }
          index += 4;
          continue;
        }
        const codePoint = data.codePointAt(index);
        if (codePoint === undefined) break;
        const ch = String.fromCodePoint(codePoint);
        index += ch.length;
        if (ch === '\r') {
          const line = lineRef.current;
          lineRef.current = '';
          cursorRef.current = 0;
          histIdxRef.current = -1;
          if (line.trim()) {
            const history = histRef.current;
            if (history[history.length - 1] !== line) history.push(line);
            if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
            saveTerminalHistory(historyScopeRef.current, history);
          }
          term.write('\r\n');
          if (hasBridge()) api().termInput(tabId, `${line}\r\n`).catch(() => {});
        } else if (ch === '\x7f' || ch === '\b') {
          const chars = Array.from(lineRef.current);
          if (cursorRef.current > 0) {
            const amount = cells(chars[cursorRef.current - 1]);
            term.write(`\x1b[${amount}D\x1b[${amount}P`);
            chars.splice(cursorRef.current - 1, 1);
            cursorRef.current -= 1;
            lineRef.current = chars.join('');
          }
        } else if (ch === '\x03') {
          replaceLine('');
          histIdxRef.current = -1;
          term.write('^C\r\n');
        } else if (ch === '\x0c') {
          const chars = Array.from(lineRef.current);
          term.clear();
          term.write(lineRef.current);
          const suffixWidth = cells(chars.slice(cursorRef.current).join(''));
          if (suffixWidth) term.write(`\x1b[${suffixWidth}D`);
        } else if (ch === '\x01') {
          const chars = Array.from(lineRef.current);
          const amount = cells(chars.slice(0, cursorRef.current).join(''));
          if (amount) term.write(`\x1b[${amount}D`);
          cursorRef.current = 0;
        } else if (ch === '\x05') {
          const chars = Array.from(lineRef.current);
          const amount = cells(chars.slice(cursorRef.current).join(''));
          if (amount) term.write(`\x1b[${amount}C`);
          cursorRef.current = chars.length;
        } else if (ch === '\x15') {
          const chars = Array.from(lineRef.current);
          replaceLine(chars.slice(cursorRef.current).join(''), 0);
        } else if (ch === '\x0b') {
          const chars = Array.from(lineRef.current);
          replaceLine(chars.slice(0, cursorRef.current).join(''), cursorRef.current);
        } else if (ch === '\x17') {
          const chars = Array.from(lineRef.current);
          const left = chars.slice(0, cursorRef.current).join('').replace(/\s*\S+\s*$/, '');
          const right = chars.slice(cursorRef.current).join('');
          replaceLine(left + right, Array.from(left).length);
        } else if (ch >= ' ' || ch === '\t') {
          const chars = Array.from(lineRef.current);
          const before = chars.slice(0, cursorRef.current).join('');
          const after = chars.slice(cursorRef.current).join('');
          const suffixWidth = cells(after);
          lineRef.current = before + ch + after;
          cursorRef.current += 1;
          term.write(ch + after);
          if (suffixWidth) term.write(`\x1b[${suffixWidth}D`);
        }
      }
    });

    startShell(shell);
    return () => {
      off();
      ro.disconnect();
      disp.dispose();
      linkDisposable.dispose();
      selectionDisposable.dispose();
      term.dispose();
      termRef.current = null;
      replaceLineRef.current = () => {};
      if (hasBridge()) api().termKill(tabId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Becoming visible: refit (xterm can't measure while display:none).
  useEffect(() => {
    if (!active) return;
    scheduleAfterPaint(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* ignore */
      }
    });
  }, [active]);

  return (
    <div className="term-tab">
      <div className="term-bar">
        <select
          className="term-shell"
          value={shell}
          onChange={(e) => {
            const next = e.target.value === 'cmd' ? ('cmd' as const) : ('powershell' as const);
            props.onShellChange(next);
            historyScopeRef.current = terminalHistoryScope(next, cwd);
            histRef.current = loadTerminalHistory(terminalHistoryScope(next, cwd));
            if (hasBridge()) {
              api()
                .termKill(tabId)
                .catch(() => {})
                .finally(() => {
                  termRef.current?.clear();
                  lineRef.current = '';
                  cursorRef.current = 0;
                  histIdxRef.current = -1;
                  startShell(next);
                });
            }
          }}
          aria-label="셸"
        >
          <option value="powershell">PowerShell</option>
          <option value="cmd">cmd</option>
        </select>
        <span className="term-meta" title={cwd || '기본 폴더'}>
          {running ? '실행 중' : '중지됨'} · {cwd ? cwd.split(/[\\/]/).pop() : '기본 폴더'}
        </span>
        <button
          className="mini-btn"
          title={cwd ? `작업 폴더 경로 복사: ${cwd}` : '작업 폴더가 없습니다'}
          aria-label="터미널 작업 폴더 경로 복사"
          disabled={!cwd}
          onClick={async () => {
            if (!cwd) return;
            try { await navigator.clipboard.writeText(cwd); props.onNotice('터미널 작업 폴더 경로를 복사했어.'); }
            catch { props.onNotice('터미널 작업 폴더 경로를 복사하지 못했어.'); }
          }}
        >
          <CopyIcon size={13} /> 경로
        </button>
        <button
          className="mini-btn"
          title="선택한 터미널 출력 복사 (Ctrl+C)"
          onClick={async () => {
            const term = termRef.current;
            if (!term?.hasSelection()) return;
            try { await navigator.clipboard.writeText(term.getSelection()); }
            catch { props.onNotice('터미널 선택 내용을 복사하지 못했습니다.'); }
          }}
          disabled={!hasSelection}
        >
          <CopyIcon size={13} /> 복사
        </button>
        <button className="mini-btn" title="셸 다시 시작" onClick={restart}>
          <RefreshIcon size={13} /> 다시 시작
        </button>
        <button className="mini-btn" title="셸 종료" onClick={kill} disabled={!running}>
          <StopIcon size={13} /> 중지
        </button>
      </div>
      {historySearchOpen && <div className="term-history-search" role="dialog" aria-label="터미널 명령 기록 검색">
        <div className="term-history-search-head">
          <input
            ref={historySearchInputRef}
            value={historySearchQuery}
            onChange={(event) => { setHistorySearchQuery(event.target.value); setHistorySearchIndex(0); }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') { event.preventDefault(); finishHistorySearch(true); }
              else if (event.key === 'ArrowDown' && historyMatches.length) { event.preventDefault(); setHistorySearchIndex((index) => (index + 1) % historyMatches.length); }
              else if (event.key === 'ArrowUp' && historyMatches.length) { event.preventDefault(); setHistorySearchIndex((index) => (index - 1 + historyMatches.length) % historyMatches.length); }
              else if (event.key === 'Enter') { event.preventDefault(); acceptHistorySearch(); }
            }}
            placeholder="명령 기록 검색…"
            aria-label="명령 기록 검색"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="term-history-search-hint">↑↓ 선택 · Enter 입력 · Esc 취소</span>
        </div>
        <div ref={historyResultsRef} className="term-history-search-list" role="listbox" aria-label="명령 기록">
          {historyMatches.length ? historyMatches.map((match, index) => <button
            key={`${match.index}:${match.command}`}
            type="button"
            role="option"
            aria-selected={index === historySearchIndex}
            className={index === historySearchIndex ? 'term-history-command active' : 'term-history-command'}
            onMouseEnter={() => setHistorySearchIndex(index)}
            onClick={acceptHistorySearch}
            title={match.command}
          >{match.command}</button>) : <div className="term-history-empty">일치하는 명령이 없어.</div>}
        </div>
      </div>}
      <div ref={boxRef} className="term-body" />
      {!hasBridge() && <div className="empty-note">Electron 앱에서 실행해야 터미널을 사용할 수 있습니다.</div>}
    </div>
  );
}
