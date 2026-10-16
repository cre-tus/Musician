import React, { useEffect, useMemo, useState } from 'react';
import { filterLogLines } from '../lib/filter-log.mjs';
import { maskSecrets } from '../lib/secret-mask.mjs';

interface LogLabels {
  searchPh: string;
  errorsOnly: string;
  wrap: string;
  copy: string;
  copied: string;
}

// One toolbar for every static log block: search, errors-only, wrap, copy.
export default function LogView({ text, labels, tone, renderLine }: {
  text: string;
  labels: LogLabels;
  tone?: 'stderr';
  renderLine?: (line: string, index: number) => React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const lines = useMemo(
    () => filterLogLines(text, { query, errorsOnly }),
    [text, query, errorsOnly],
  );
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copyAll = () => {
    const done = () => setCopied(true);
    try {
      const clip = (navigator as unknown as { clipboard?: { writeText?: (s: string) => Promise<void> } }).clipboard;
      if (clip?.writeText) {
        clip.writeText(text).then(done, done);
        return;
      }
    } catch { /* fall through to the legacy path */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch { /* copy stays unavailable */ }
    done();
  };
  return (
    <div className="logview">
      <div className="logview-toolbar" role="toolbar">
        <input
          type="search"
          className="logview-search"
          value={query}
          placeholder={labels.searchPh}
          aria-label={labels.searchPh}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={`mini-btn${errorsOnly ? ' on' : ''}`}
          aria-pressed={errorsOnly}
          onClick={() => setErrorsOnly((v) => !v)}
        >
          {labels.errorsOnly}
        </button>
        <button
          type="button"
          className={`mini-btn${wrap ? ' on' : ''}`}
          aria-pressed={wrap}
          onClick={() => setWrap((v) => !v)}
        >
          {labels.wrap}
        </button>
        <button type="button" className="mini-btn" onClick={copyAll}>
          {copied ? labels.copied : labels.copy}
        </button>
      </div>
      <pre className={`${wrap ? 'logview-pre wrap' : 'logview-pre'}${tone === 'stderr' ? ' stderr' : ''}`}>
        {renderLine ? lines.map((line, i) => (
          <React.Fragment key={i}>
            {i > 0 ? '\n' : null}
            {renderLine(line, i)}
          </React.Fragment>
        )) : maskSecrets(lines.join('\n'))}
      </pre>
    </div>
  );
}
