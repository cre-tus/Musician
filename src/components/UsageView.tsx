import React, { useEffect, useState } from 'react';
import type { Session, SubscriptionUsage } from '../types';
import { api, hasBridge } from '../lib/mudex';
import { BackIcon } from './icons';
import { useStrings } from '../lib/lang';
import { formatStr } from '../lib/i18n.mjs';
import { loadLastUsage, saveLastUsage } from '../lib/usage-cache.mjs';

type Strings = Record<string, Record<string, string>>;

interface Props {
  sessions: Session[];
  folder: string;
  onBack: () => void;
  onSelectThread: (id: string) => void;
}

function fmtTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtClock(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtReset(ms: number, s: Strings): string {
  const d = ms - Date.now();
  if (!ms || d <= 0) return s.usage.resetSoon;
  const days = Math.floor(d / 86400000);
  const h = Math.floor((d % 86400000) / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  if (days > 0) return formatStr(s.usage.resetDays, { d: days, h });
  if (h > 0) return formatStr(s.usage.resetHours, { h, m });
  if (m > 0) return formatStr(s.usage.resetMins, { m });
  return s.usage.resetSoon;
}

function barClass(pct: number): string {
  if (pct >= 90) return 'usage-fill crit';
  if (pct >= 70) return 'usage-fill warn';
  return 'usage-fill';
}

function UsageBar({ label, pct, resetMs }: { label: string; pct: number; resetMs: number }) {
  const s = useStrings();
  const rem = Math.max(0, 100 - pct);
  return (
    <div className="usage-row" title={formatStr(s.usage.barTitle, { label, rem: rem.toFixed(1), clock: fmtClock(resetMs) })}>
      <div className="usage-head">
        <b>{label}</b>
        <span>
          {formatStr(s.usage.barLeft, { rem: rem.toFixed(1), reset: fmtReset(resetMs, s) })}
        </span>
      </div>
      <div className="usage-bar">
        <div className={barClass(pct)} style={{ width: `${Math.min(100, Math.max(0, rem))}%` }} />
      </div>
    </div>
  );
}

export default function UsageView({ sessions, folder, onBack, onSelectThread }: Props) {
  const s = useStrings();
  const [usage, setUsage] = useState<SubscriptionUsage | null | undefined>(() => loadLastUsage(localStorage) ?? undefined);
  const [usageFailed, setUsageFailed] = useState(false);

  useEffect(() => {
    if (!hasBridge()) {
      setUsage((prev) => prev ?? null);
      setUsageFailed(true);
      return;
    }
    api()
      .mspUsage(folder || '')
      .then((r) => {
        if (r.ok && r.usage) {
          setUsage(r.usage);
          saveLastUsage(localStorage, r.usage);
          setUsageFailed(false);
        } else if (!r.ok) {
          // Failure keeps a cached value when one exists.
          setUsage((prev) => prev ?? null);
          setUsageFailed(true);
        } else {
          // ok-but-null means connected yet unobserved (usage appears after
          // the first turn) — keep cached data, only clear the loading state.
          setUsage((prev) => prev ?? null);
        }
      })
      .catch(() => {
        setUsage((prev) => prev ?? null);
        setUsageFailed(true);
      });
    // A null push carries no observation; never let it wipe shown data.
    const off = api().onMspUsage((p) => {
      if (p.usage) saveLastUsage(localStorage, p.usage);
      setUsage((prev) => p.usage ?? prev);
    });
    return () => {
      off();
    };
  }, [folder]);

  const rows = sessions
    .map((s) => {
      let input = 0;
      let output = 0;
      let turns = 0;
      for (const m of s.messages) {
        if (!m.usage) continue;
        turns++;
        input += m.usage.inputTokens || 0;
        output += m.usage.outputTokens || 0;
      }
      return { s, input, output, total: input + output, turns };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  const totIn = rows.reduce((a, r) => a + r.input, 0);
  const totOut = rows.reduce((a, r) => a + r.output, 0);

  return (
    <section className="page">
      <header className="topbar">
        <button className="btn" onClick={onBack}>
          <BackIcon size={14} /> {s.usage.back}
        </button>
        <div className="topbar-title">
          <h2>{s.usage.title}</h2>
          <p>{s.usage.sub}</p>
        </div>
      </header>
      <div className="page-body">
        <div className="section-cap">{s.usage.capQuota}</div>
        <div className="panel">
          {usage === undefined && <div className="empty-note">{s.common.loading}</div>}
          {usage === null && usageFailed && (
            <div className="empty-note">
              {s.usage.unavailable}
            </div>
          )}
          {usage === null && !usageFailed && (
            <div className="empty-note">
              {s.usage.waitingFirst}
            </div>
          )}
          {usage && (
            <>
              <UsageBar label={s.usage.barNow} pct={usage.window.usedPercent} resetMs={usage.window.resetsAtMs} />
              <UsageBar label={s.usage.barWeek} pct={usage.weekly.usedPercent} resetMs={usage.weekly.resetsAtMs} />
              <p className="modal-note" style={{ margin: '8px 0 0' }}>
                {formatStr(s.usage.planLine, { tier: usage.tier, clock: fmtClock(usage.observedAtMs) })}
              </p>
              {Date.now() - usage.observedAtMs > 3600000 && (
                <p className="modal-note" style={{ margin: '4px 0 0' }}>
                  {s.usage.staleNote}
                </p>
              )}
            </>
          )}
        </div>

        <div className="section-cap">{s.usage.capTokens}</div>
        <div className="panel">
          {rows.length === 0 && (
            <div className="empty-note">{s.usage.noTokens}</div>
          )}
          {rows.length > 0 && (
            <table className="token-table">
              <thead>
                <tr>
                  <th>{s.usage.thThread}</th>
                  <th className="num">{s.usage.thIn}</th>
                  <th className="num">{s.usage.thOut}</th>
                  <th className="num">{s.usage.thTotal}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.s.id} onClick={() => onSelectThread(r.s.id)} title={formatStr(s.usage.rowTitle, { turns: r.turns })}>
                    <td className="tok-title">
                      {r.s.title}
                      {r.s.engine === 'msp' && <span className="tag tag-msp">MSP</span>}
                    </td>
                    <td className="num">{fmtTokens(r.input)}</td>
                    <td className="num">{fmtTokens(r.output)}</td>
                    <td className="num">
                      <b>{fmtTokens(r.total)}</b>
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td>{s.usage.totalRow}</td>
                  <td className="num">{fmtTokens(totIn)}</td>
                  <td className="num">{fmtTokens(totOut)}</td>
                  <td className="num">
                    <b>{fmtTokens(totIn + totOut)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="modal-note" style={{ margin: '8px 0 0' }}>
            {s.usage.note}
          </p>
        </div>
      </div>
    </section>
  );
}
