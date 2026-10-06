import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CliSkillRow, SkillCandidate } from '../types';
import { api, hasBridge } from '../lib/mudex';
import { formatStr } from '../lib/i18n.mjs';
import { skillPreviewUrl } from '../lib/skill-preview.mjs';
import { useStrings } from '../lib/lang';
import { RefreshIcon, SearchIcon, StarIcon, TrashIcon } from './icons';

type Notice = { kind: 'ok' | 'err'; text: string } | null;

export default function SkillsTab({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const strings = useStrings();
  const t = strings.skills;
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SkillCandidate[] | null>(null);
  const [installed, setInstalled] = useState<CliSkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const explain = useCallback((code: string | undefined, detail: string, reset?: string) => {
    if (code === 'RATE_LIMITED') return reset ? formatStr(t.errRate, { time: reset }) : t.errRateSoon;
    if (code === 'EMPTY_QUERY') return t.errEmpty;
    if (code === 'NETWORK_ERROR') return formatStr(t.errNet, { error: detail });
    return formatStr(t.errFailed, { error: detail || code || '' });
  }, [t]);

  const reload = useCallback(async () => {
    if (!hasBridge()) {
      setLoading(false);
      setNotice({ kind: 'err', text: t.errNeedApp });
      return;
    }
    setLoading(true);
    try {
      const res = await api().skills('list');
      if (res.ok) {
        setInstalled(res.skills || []);
      } else {
        setNotice({ kind: 'err', text: explain(res.code, res.error || '') });
      }
    } catch (err) {
      setNotice({ kind: 'err', text: explain('NETWORK_ERROR', String((err as Error)?.message || err)) });
    } finally {
      setLoading(false);
    }
  }, [explain, t.errNeedApp]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!hasBridge()) {
        setLoading(false);
        setNotice({ kind: 'err', text: t.errNeedApp });
        return;
      }
      try {
        const res = await api().skills('list');
        if (cancelled) return;
        if (res.ok) setInstalled(res.skills || []);
        else setNotice({ kind: 'err', text: explain(res.code, res.error || '') });
      } catch (err) {
        if (!cancelled) setNotice({ kind: 'err', text: explain('NETWORK_ERROR', String((err as Error)?.message || err)) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [explain, t.errNeedApp]);

  const runSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!hasBridge()) {
      setNotice({ kind: 'err', text: t.errNeedApp });
      return;
    }
    if (!query.trim()) {
      setNotice({ kind: 'err', text: t.errEmpty });
      return;
    }
    setSearching(true);
    setNotice(null);
    try {
      // Natural-language queries go to the CLI first; direct GitHub search
      // is the fallback when the agent run fails.
      const agent = await api().skills('agentSearch', { query: query.trim() });
      // No direct-search fallback on RATE_LIMITED: it burns the same quota.
      const res = agent.ok || agent.code === 'RATE_LIMITED' ? agent : await api().skills('search', { query: query.trim() });
      if (res.ok) {
        setResults(res.results || []);
        if ((res.results || []).length === 0) setNotice({ kind: 'err', text: t.noResults });
      } else {
        setNotice({ kind: 'err', text: explain(res.code, res.error || '', res.reset) });
      }
    } catch (err) {
      setNotice({ kind: 'err', text: explain('NETWORK_ERROR', String((err as Error)?.message || err)) });
    } finally {
      setSearching(false);
    }
  };

  const installRepo = async (candidate: SkillCandidate) => {
    if (busyId) return;
    setBusyId(candidate.repo);
    setNotice(null);
    try {
      const res = await api().skills('installRepo', { repo: candidate.repo, subdir: candidate.subdir });
      if (res.ok) {
        setNotice({ kind: 'ok', text: formatStr(t.doneInstalled, { name: candidate.repo }) });
        await reload();
      } else {
        setNotice({ kind: 'err', text: explain(res.code, res.error || '') });
      }
    } catch (err) {
      setNotice({ kind: 'err', text: explain('NETWORK_ERROR', String((err as Error)?.message || err)) });
    } finally {
      setBusyId(null);
    }
  };

  const installFolder = async () => {
    if (busyId || !hasBridge()) return;
    const picked = await api().pickFolder();
    if (!picked.ok || picked.cancelled || !picked.path) return;
    setBusyId('__folder__');
    setNotice(null);
    try {
      const res = await api().skills('install', { path: picked.path });
      if (res.ok) {
        setNotice({ kind: 'ok', text: formatStr(t.doneInstalled, { name: picked.path }) });
        await reload();
      } else {
        setNotice({ kind: 'err', text: explain(res.code, res.error || '') });
      }
    } catch (err) {
      setNotice({ kind: 'err', text: explain('NETWORK_ERROR', String((err as Error)?.message || err)) });
    } finally {
      setBusyId(null);
    }
  };

  const toggleSkill = async (row: CliSkillRow) => {
    if (busyId) return;
    const action = row.activation === 'off' ? 'enable' : 'disable';
    setBusyId(row.id);
    setNotice(null);
    try {
      const res = await api().skills(action, { id: row.id });
      if (res.ok) {
        setNotice({ kind: 'ok', text: formatStr(action === 'enable' ? t.doneEnabled : t.doneDisabled, { name: row.name }) });
        await reload();
      } else {
        setNotice({ kind: 'err', text: explain(res.code, res.error || '') });
      }
    } catch (err) {
      setNotice({ kind: 'err', text: explain('NETWORK_ERROR', String((err as Error)?.message || err)) });
    } finally {
      setBusyId(null);
    }
  };

  const uninstallSkill = async (row: CliSkillRow) => {
    if (busyId) return;
    setBusyId(row.id);
    setNotice(null);
    try {
      const res = await api().skills('uninstall', { id: row.id });
      if (res.ok) {
        setNotice({ kind: 'ok', text: formatStr(t.doneUninstalled, { name: row.name }) });
        await reload();
      } else {
        setNotice({ kind: 'err', text: explain(res.code, res.error || '') });
      }
    } catch (err) {
      setNotice({ kind: 'err', text: explain('NETWORK_ERROR', String((err as Error)?.message || err)) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="skills-tab">
      <form className="skills-search" onSubmit={(e) => void runSearch(e)}>
        <SearchIcon size={14} />
        <input
          ref={inputRef}
          className="skills-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchPh}
          aria-label={t.searchTitle}
        />
        <button type="submit" className="btn" disabled={searching}>
          {searching ? t.searching : t.searchBtn}
        </button>
      </form>
      {results !== null && (
        <section className="skills-section" aria-label={t.resultsTitle}>
          <div className="skills-head">{t.resultsTitle} ({results.length})</div>
          {results.length === 0 ? (
            <div className="skills-empty">{t.noResults}</div>
          ) : (
            <ul className="skills-list">
              {results.map((candidate) => {
                const preview = skillPreviewUrl(candidate);
                return (
                  <li key={candidate.repo} className="skills-row">
                    <StarIcon size={13} />
                    <div className="skills-row-main">
                      <div className="skills-row-title">{candidate.repo} · ★{candidate.stars}</div>
                      {candidate.description && <div className="skills-row-desc">{candidate.description}</div>}
                    </div>
                    {preview !== '' && (
                      <button
                        className="btn"
                        disabled={busyId !== null}
                        onClick={() => onOpenUrl(preview)}
                        aria-label={`${t.viewBtn} ${candidate.repo}`}
                        title={`${t.viewBtn} ${candidate.repo}`}
                      >
                        {t.viewBtn}
                      </button>
                    )}
                    <button
                      className="btn"
                      disabled={busyId !== null}
                      onClick={() => void installRepo(candidate)}
                    >
                      {busyId === candidate.repo ? t.installing : t.installBtn}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      <section className="skills-section" aria-label={t.localTitle}>
        <div className="skills-head">
          <span>{t.localTitle} ({installed.length})</span>
          <span className="skills-head-actions">
            <button className="btn" onClick={() => void installFolder()} disabled={busyId !== null}>
              {t.folderBtn}
            </button>
            <button className="btn icon-btn" onClick={() => void reload()} disabled={loading} aria-label={t.refreshBtn} title={t.refreshBtn}>
              <RefreshIcon size={13} />
            </button>
          </span>
        </div>
        {loading ? (
          <div className="skills-empty">{strings.common.loading}</div>
        ) : installed.length === 0 ? (
          <div className="skills-empty">{t.localEmpty}</div>
        ) : (
          <ul className="skills-list">
            {installed.map((row) => (
              <li key={row.id} className="skills-row">
                <div className="skills-row-main">
                  <div className="skills-row-title">{row.name} <span className="skills-scope">{row.scope}</span></div>
                  {row.description && <div className="skills-row-desc">{row.description}</div>}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.activation !== 'off'}
                  aria-label={`${row.activation === 'off' ? t.enableBtn : t.disableBtn} ${row.name}`}
                  className={row.activation === 'off' ? 'skills-switch off' : 'skills-switch on'}
                  disabled={busyId !== null}
                  onClick={() => void toggleSkill(row)}
                >
                  <span className="skills-knob" aria-hidden="true">{row.activation === 'off' ? 'OFF' : 'ON'}</span>
                </button>
                {row.scope === 'user' && (
                  <button
                    className="btn icon-btn"
                    disabled={busyId !== null}
                    onClick={() => void uninstallSkill(row)}
                    aria-label={`${t.uninstallBtn} ${row.name}`}
                    title={`${t.uninstallBtn} ${row.name}`}
                  >
                    <TrashIcon size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {notice && (
        <div className={notice.kind === 'ok' ? 'skills-notice ok' : 'skills-notice err'} role="status">
          {notice.text}
        </div>
      )}
    </div>
  );
}
