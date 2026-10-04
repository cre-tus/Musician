import React, { useEffect, useState } from 'react';
import type { Session, SubscriptionUsage } from '../types';
import { api, hasBridge } from '../lib/mudex';
import { BackIcon } from './icons';

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

function fmtReset(ms: number): string {
  const d = ms - Date.now();
  if (!ms || d <= 0) return '곧 초기화';
  const days = Math.floor(d / 86400000);
  const h = Math.floor((d % 86400000) / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  if (days > 0) return `${days}일 ${h}시간 후 초기화`;
  if (h > 0) return `${h}시간 ${m}분 후 초기화`;
  if (m > 0) return `${m}분 후 초기화`;
  return '곧 초기화';
}

function barClass(pct: number): string {
  if (pct >= 90) return 'usage-fill crit';
  if (pct >= 70) return 'usage-fill warn';
  return 'usage-fill';
}

function UsageBar({ label, pct, resetMs }: { label: string; pct: number; resetMs: number }) {
  const rem = Math.max(0, 100 - pct);
  return (
    <div className="usage-row" title={`${label} 남음 ${rem.toFixed(1)}% · 초기화: ${fmtClock(resetMs)}`}>
      <div className="usage-head">
        <b>{label}</b>
        <span>
          남음 {rem.toFixed(1)}% · {fmtReset(resetMs)}
        </span>
      </div>
      <div className="usage-bar">
        <div className={barClass(pct)} style={{ width: `${Math.min(100, Math.max(0, rem))}%` }} />
      </div>
    </div>
  );
}

export default function UsageView({ sessions, folder, onBack, onSelectThread }: Props) {
  const [usage, setUsage] = useState<SubscriptionUsage | null | undefined>(undefined);

  useEffect(() => {
    if (!hasBridge()) {
      setUsage(null);
      return;
    }
    api()
      .mspUsage(folder || '')
      .then((r) => setUsage(r.ok ? r.usage ?? null : null))
      .catch(() => setUsage(null));
    const off = api().onMspUsage((p) => setUsage(p.usage));
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
          <BackIcon size={14} /> 스레드
        </button>
        <div className="topbar-title">
          <h2>사용량</h2>
          <p>구독 요금제 기준. 비용 추정은 표시하지 않습니다.</p>
        </div>
      </header>
      <div className="page-body">
        <div className="section-cap">구독 사용률</div>
        <div className="panel">
          {usage === undefined && <div className="empty-note">불러오는 중…</div>}
          {usage === null && (
            <div className="empty-note">
              사용량 정보를 가져올 수 없습니다. MSP에 연결된 뒤 다시 열어 보세요.
            </div>
          )}
          {usage && (
            <>
              <UsageBar label="이번 창" pct={usage.window.usedPercent} resetMs={usage.window.resetsAtMs} />
              <UsageBar label="주간" pct={usage.weekly.usedPercent} resetMs={usage.weekly.resetsAtMs} />
              <p className="modal-note" style={{ margin: '8px 0 0' }}>
                요금제: {usage.tier} · 관측: {fmtClock(usage.observedAtMs)}
              </p>
            </>
          )}
        </div>

        <div className="section-cap">스레드별 토큰</div>
        <div className="panel">
          {rows.length === 0 && (
            <div className="empty-note">아직 집계된 토큰이 없습니다. MSP로 대화하면 여기에 쌓입니다.</div>
          )}
          {rows.length > 0 && (
            <table className="token-table">
              <thead>
                <tr>
                  <th>스레드</th>
                  <th className="num">입력</th>
                  <th className="num">출력</th>
                  <th className="num">합계</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.s.id} onClick={() => onSelectThread(r.s.id)} title={`${r.turns}턴 · 클릭하면 스레드로 이동`}>
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
                  <td>합계</td>
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
            토큰은 MSP 실행에서 보고된 값만 집계합니다. exec 실행은 집계되지 않습니다.
          </p>
        </div>
      </div>
    </section>
  );
}
