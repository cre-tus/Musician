import React, { useEffect, useRef, useState } from 'react';
import type { CliSettings, CliStatus, MudexApi, TurnHook } from '../types';
import { api, hasBridge } from '../lib/mudex';
import { maskHomePath, maskHomePathEverywhere } from '../lib/path-utils.mjs';
import { SLASH_COMMANDS } from '../lib/slash-commands.mjs';
import { CUSTOM_SLASH_KEY, readCustomSlashCommands, writeCustomSlashCommands } from '../lib/custom-slash.mjs';
import type { CustomSlashCommand } from '../lib/custom-slash.mjs';
import { mirrorStoredKey } from '../lib/durable-state.mjs';
import { cleanHooks, normalizeHookTimeout, validateHooks } from '../lib/hooks.mjs';
import { formatStr } from '../lib/i18n.mjs';
import { useLang, useStrings } from '../lib/lang';
import { BackIcon, CopyIcon, SearchIcon, XIcon } from './icons';

interface Props {
  settings: CliSettings;
  cliStatus: CliStatus;
  cliResolved: string;
  folder: string;
  groupBy: 'project' | 'status';
  onGroupBy: (g: 'project' | 'status') => void;
  onSave: (settings: CliSettings) => void;
  onBack: () => void;
}

type TestResult = Awaited<ReturnType<MudexApi['cliTest']>>;

interface HostModel {
  modelId: string;
  displayLabel: string;
  isActive: boolean;
  isDefault: boolean;
}

const MODELS = ['', 'muse-spark-1.3', 'muse-spark-1.2'];

export default function SettingsView(props: Props) {
  const { settings, cliStatus, cliResolved, folder, groupBy } = props;
  const lang = useLang();
  const strings = useStrings();
  const st = strings.settings;
  const approvalModes: [string, string][] = [
    ['', st.cliDefault],
    ['allowAll', st.approvalAllowAll],
    ['promptUnmatched', st.approvalPromptUnmatched],
    ['onRequest', st.approvalOnRequest],
    ['denyUnmatched', st.approvalDenyUnmatched],
  ];
  const [modelText, setModelText] = useState(settings.model);
  const [extraArgs, setExtraArgs] = useState(settings.extraArgs);
  const [workdir, setWorkdir] = useState(settings.workdir);
  const [cliPath, setCliPath] = useState(settings.cliPath);
  const [timeoutSec, setTimeoutSec] = useState(String(Math.round(settings.timeoutMs / 1000)));
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hostModels, setHostModels] = useState<HostModel[]>([]);
  const [browserHome, setBrowserHome] = useState(settings.browserHome);
  const [mcpCmd, setMcpCmd] = useState('');
  const [mcpBlock, setMcpBlock] = useState('');
  const [mcpSettingsPath, setMcpSettingsPath] = useState('');
  const [copied, setCopied] = useState(false);
  const [blockCopied, setBlockCopied] = useState(false);
  const [mcpRegistering, setMcpRegistering] = useState(false);
  const [mcpRegisterMsg, setMcpRegisterMsg] = useState('');
  const [mcpRegistration, setMcpRegistration] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [filterSummary, setFilterSummary] = useState('');
  const [customCmds, setCustomCmds] = useState<CustomSlashCommand[]>(() => {
    try { return readCustomSlashCommands(localStorage, SLASH_COMMANDS.map((c) => c.id)); } catch { return []; }
  });
  const [customMsg, setCustomMsg] = useState('');
  const saveCustomCmds = () => {
    const builtinIds = SLASH_COMMANDS.map((c) => c.id);
    const r = writeCustomSlashCommands(localStorage, customCmds, builtinIds);
    if (!r.ok) {
      const code = r.error || 'WRITE_FAILED';
      setCustomMsg(
        code === 'BAD_NAME' ? st.customErrBadName
        : code === 'DUPLICATE' ? st.customErrDuplicate
        : code === 'RESERVED' ? st.customErrReserved
        : code === 'EMPTY_TEMPLATE' ? st.customErrEmpty
        : code === 'TEMPLATE_TOO_LONG' ? st.customErrTooLong
        : code === 'TOO_MANY' ? st.customErrTooMany
        : st.customErrWrite,
      );
      return;
    }
    if (hasBridge()) {
      try {
        const apiObj = api();
        mirrorStoredKey({ set: (key: string, value: string | null) => apiObj.rendererStateSet(key, value) }, localStorage, CUSTOM_SLASH_KEY);
      } catch { /* durable backup best-effort */ }
    }
    setCustomCmds(readCustomSlashCommands(localStorage, builtinIds));
    setCustomMsg(formatStr(st.customSaved, { n: customCmds.length }));
  };
  const [hooks, setHooks] = useState<TurnHook[]>(() => {
    try { return cleanHooks(settings.hooks); } catch { return []; }
  });
  const [hookMsg, setHookMsg] = useState('');
  const [hookTesting, setHookTesting] = useState<number | null>(null);
  const saveHooks = () => {
    const v = validateHooks(hooks);
    if (!v.ok) {
      const code = v.error || 'EMPTY_COMMAND';
      const base =
        code === 'EMPTY_COMMAND' ? st.hookErrEmpty
        : code === 'COMMAND_TOO_LONG' ? st.hookErrTooLong
        : code === 'TOO_MANY' ? st.hookErrTooMany
        : code === 'BAD_EVENT' ? st.hookErrBadEvent
        : st.hookErrDuplicate;
      setHookMsg(v.index ? `${base} (#${v.index})` : base);
      return;
    }
    const clean = cleanHooks(hooks);
    commit({ hooks: clean });
    setHooks(clean);
    setHookMsg(formatStr(st.hookSaved, { n: clean.length }));
  };
  const testHook = async (index: number) => {
    const h = hooks[index];
    if (!h || !h.command.trim() || !hasBridge() || hookTesting !== null) return;
    setHookTesting(index);
    try {
      const r = await api().hookTest(h.command.trim(), folder || '');
      setHookMsg(r.ok ? formatStr(st.hookTestOk, { code: r.code ?? 0 }) : formatStr(st.hookTestFailed, { err: r.error || '' }));
    } catch (e) {
      setHookMsg(formatStr(st.hookTestFailed, { err: e instanceof Error ? e.message : String(e) }));
    } finally {
      setHookTesting(null);
    }
  };
  const settingsSectionsRef = useRef<HTMLDivElement | null>(null);
  const filterEmptyRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  // External changes (e.g. chat toolbar) flow back into the text fields.
  useEffect(() => setModelText(settings.model), [settings.model]);
  useEffect(() => setExtraArgs(settings.extraArgs), [settings.extraArgs]);
  useEffect(() => setWorkdir(settings.workdir), [settings.workdir]);
  useEffect(() => setCliPath(settings.cliPath), [settings.cliPath]);
  useEffect(() => setTimeoutSec(String(Math.round(settings.timeoutMs / 1000))), [settings.timeoutMs]);
  useEffect(() => setBrowserHome(settings.browserHome), [settings.browserHome]);

  const commit = (patch: Partial<CliSettings>) => {
    props.onSave({ ...props.settings, ...patch });
    setLastSaved(new Date());
  };
  const commitTimeout = () => {
    const sec = Math.min(86400, Math.max(0, parseInt(timeoutSec, 10) || 0));
    setTimeoutSec(String(sec));
    commit({ timeoutMs: sec * 1000 });
  };
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  useEffect(() => {
    if (!hasBridge()) return;
    api()
      .mspModels(folder || '')
      .then((r) => {
        if (r.ok) setHostModels(r.models || []);
      })
      .catch(() => {});
    api()
      .browserMcpCmd()
      .then((r) => {
        if (!r.ok) return;
        const cmd = r.command || '';
        const args = (r.args || []).map((a) => `"${a}"`).join(' ');
        setMcpCmd(cmd ? `"${cmd}"${args ? ` ${args}` : ''}` : '');
        setMcpBlock(r.settingsBlock || '');
        setMcpSettingsPath(r.settingsPath || '');
        setMcpRegistration(r.registration || '');
      })
      .catch(() => {});
  }, [folder]);

  useEffect(() => {
    const root = settingsSectionsRef.current;
    if (!root) return;
    const tokens = filterQuery.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = (value: string) => {
      const text = value.normalize('NFKC').toLocaleLowerCase();
      return tokens.every((token) => text.includes(token));
    };
    let matchedRows = 0;
    let visibleSections = 0;
    for (const heading of Array.from(root.querySelectorAll<HTMLElement>(':scope > .section-cap'))) {
      const panel = heading.nextElementSibling as HTMLElement | null;
      if (!panel?.classList.contains('panel')) continue;
      const rows = Array.from(panel.querySelectorAll<HTMLElement>(':scope > .setting-row'));
      const headingMatches = tokens.length > 0 && matches(heading.textContent || '');
      let sectionRows = 0;
      for (const row of rows) {
        const visible = tokens.length === 0 || headingMatches || matches(row.textContent || '');
        row.hidden = !visible;
        if (visible) sectionRows++;
      }
      const visible = tokens.length === 0 || headingMatches || sectionRows > 0 || (!rows.length && matches(panel.textContent || ''));
      heading.hidden = !visible;
      panel.hidden = !visible;
      if (visible) visibleSections++;
      matchedRows += sectionRows;
    }
    if (filterEmptyRef.current) filterEmptyRef.current.hidden = tokens.length === 0 || visibleSections > 0;
    const summary = tokens.length === 0 ? '' : visibleSections === 0 ? st.filterSummaryNone : formatStr(st.filterSummary, { rows: matchedRows, sections: visibleSections });
    setFilterSummary((previous) => previous === summary ? previous : summary);
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const copyText = async (text: string, done: () => void) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    done();
  };
  const copyMcp = () => {
    void copyText(mcpCmd, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const copyMcpBlock = () => {
    void copyText(mcpBlock, () => {
      setBlockCopied(true);
      setTimeout(() => setBlockCopied(false), 1500);
    });
  };
  const registerMcp = async () => {
    if (!hasBridge() || mcpRegistering) return;
    setMcpRegistering(true);
    setMcpRegisterMsg('');
    try {
      const r = await api().browserMcpRegister();
      const msg =
        r.status === 'already-registered' ? st.mcpRegistered
        : r.status === 'updated' ? st.mcpUpdated
        : r.status === 'name-taken' ? st.mcpNameTaken
        : r.status === 'invalid-json' ? st.mcpInvalidJson
        : r.status === 'write-failed' ? st.mcpWriteFailed
        : r.ok ? st.mcpRegisteredOk
        : (r.error || st.mcpRegisterFailed);
      setMcpRegisterMsg(msg);
      if (r.ok) setMcpRegistration('current');
    } catch (e) {
      setMcpRegisterMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setMcpRegistering(false);
    }
  };

  const runTest = async () => {
    if (!hasBridge()) {
      setResult({ ok: false, error: st.needElectron, cmd: '' });
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      const res = await api().cliTest();
      setResult(res);
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e), cmd: '' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="page">
      <header className="topbar">
        <button className="btn" onClick={props.onBack}>
          <BackIcon size={14} /> {st.backThreads}
        </button>
        <div className="topbar-title">
          <h2>{st.title}</h2>
          <p>{st.sub}</p>
        </div>
        <span className="save-state">{lastSaved ? formatStr(st.savedAt, { time: lastSaved.toLocaleTimeString(lang === 'en' ? 'en-US' : 'ko-KR') }) : st.autosave}</span>
      </header>
      <div className="page-body">
        <div className="settings-filter">
          <SearchIcon size={15} />
          <input
            ref={filterInputRef}
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && filterQuery) {
                event.preventDefault();
                setFilterQuery('');
              } else if (event.key === 'ArrowDown' && filterQuery) {
                const first = Array.from(settingsSectionsRef.current?.querySelectorAll<HTMLElement>(
                  '.section-cap:not([hidden]) + .panel .setting-row:not([hidden]) button:not(:disabled), .section-cap:not([hidden]) + .panel .setting-row:not([hidden]) input:not(:disabled), .section-cap:not([hidden]) + .panel .setting-row:not([hidden]) select:not(:disabled)',
                ) || []).find((element) => element.offsetParent !== null);
                if (first) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
            placeholder={st.filterPlaceholder}
            aria-label={st.filterLabel}
            aria-keyshortcuts="Escape ArrowDown"
            autoComplete="off"
            spellCheck={false}
          />
          {filterSummary && <span className="settings-filter-summary" role="status" aria-live="polite">{filterSummary}</span>}
          {filterQuery && <button type="button" className="icon-btn" title={st.filterClearTitle} aria-label={st.filterClearLabel} onClick={() => setFilterQuery('')}><XIcon size={13} /></button>}
        </div>
        <div className="settings-sections" ref={settingsSectionsRef}>
        <div ref={filterEmptyRef} className="settings-filter-empty" role="status" hidden>{st.filterEmpty}</div>
        <div className="section-cap">{st.secAppearance}</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>{st.themeLabel}</b>
              <p>{st.themeDesc}</p>
            </div>
            <div className="segmented" role="group" aria-label={st.themeLabel}>
              {([
                ['light', st.themeLight],
                ['dark', st.themeDark],
              ] as Array<readonly [typeof settings.theme, string]>).map(([v, label]) => (
                <button
                  key={v}
                  className={settings.theme === v ? 'seg active' : 'seg'}
                  onClick={() => commit({ theme: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <b>{st.langLabel}</b>
              <p>{st.langDesc}</p>
            </div>
            <div className="segmented" role="group" aria-label={st.langLabel}>
              {([
                ['ko', st.langKo],
                ['en', st.langEn],
              ] as Array<readonly ['ko' | 'en', string]>).map(([v, label]) => (
                <button
                  key={v}
                  className={(settings.lang || 'ko') === v ? 'seg active' : 'seg'}
                  onClick={() => commit({ lang: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <b>{st.codeThemeLabel}</b>
              <p>{st.codeThemeDesc}</p>
            </div>
            <div className="segmented" role="group" aria-label={st.codeThemeLabel}>
              {([
                ['auto', st.codeAuto],
                ['vs', st.codeLight],
                ['vs-dark', st.codeDark],
                ['hc-black', st.codeContrast],
              ] as Array<readonly [string, string]>).map(([v, label]) => (
                <button
                  key={v}
                  className={settings.codeTheme === v ? 'seg active' : 'seg'}
                  onClick={() => commit({ codeTheme: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="section-cap">{st.secNewThread}</div>
        <div className="panel">
          <div className="setting-row col">
            <div>
              <b>{st.modelLabel}</b>
              <p>{st.modelDesc}</p>
            </div>
            <div className="pill-picks">
              {[...hostModels.map((m) => m.modelId), ...MODELS]
                .filter((m, i, a) => a.indexOf(m) === i)
                .map((m) => (
                <button
                  key={m || '(default)'}
                  className={settings.model === m ? 'pick active' : 'pick'}
                  onClick={() => commit({ model: m })}
                >
                  {m || st.cliDefault}
                </button>
              ))}
            </div>
            <input
              value={modelText}
              onChange={(e) => setModelText(e.target.value)}
              onBlur={() => {
                if (modelText !== settings.model) commit({ model: modelText });
              }}
              onKeyDown={blurOnEnter}
              placeholder={st.modelPlaceholder}
              spellCheck={false}
            />
          </div>
          <div className="setting-row col">
            <div>
              <b>{st.argsLabel}</b>
              <p>
                {st.argsDescPre}<code>muse exec</code>{st.argsDescPost}
              </p>
            </div>
            <input
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              onBlur={() => {
                if (extraArgs !== settings.extraArgs) commit({ extraArgs });
              }}
              onKeyDown={blurOnEnter}
              placeholder={st.argsPlaceholder}
              spellCheck={false}
            />
          </div>
          <div className="setting-row col">
            <div>
              <b>{st.workdirLabel}</b>
              <p>{st.workdirDesc}</p>
            </div>
            <input
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              onBlur={() => {
                if (workdir !== settings.workdir) commit({ workdir });
              }}
              onKeyDown={blurOnEnter}
              placeholder={st.workdirPlaceholder}
              spellCheck={false}
            />
          </div>
          <div className="setting-row">
            <div>
              <b>{st.timeoutLabel}</b>
              <p>{st.timeoutDesc}</p>
            </div>
            <input
              className="narrow"
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(e.target.value)}
              onBlur={commitTimeout}
              onKeyDown={blurOnEnter}
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="section-cap">{st.secThreads}</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>{st.groupLabel}</b>
              <p>{st.groupDesc}</p>
            </div>
            <div className="segmented" role="group" aria-label={st.groupLabel}>
              <button
                className={groupBy === 'project' ? 'seg active' : 'seg'}
                onClick={() => props.onGroupBy('project')}
              >
                {st.groupProject}
              </button>
              <button
                className={groupBy === 'status' ? 'seg active' : 'seg'}
                onClick={() => props.onGroupBy('status')}
              >
                {st.groupStatus}
              </button>
            </div>
          </div>
        </div>

        <div className="section-cap">{st.secCli}</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>{st.engineLabel}</b>
              <p>{st.engineDesc}</p>
            </div>
            <div className="segmented" role="group" aria-label={st.engineLabel}>
              {(
                [
                  ['auto', st.engineAuto],
                  ['msp', 'MSP'],
                  ['exec', 'exec'],
                ] as Array<readonly [typeof settings.engine, string]>
              ).map(([v, label]) => (
                <button
                  key={v}
                  className={settings.engine === v ? 'seg active' : 'seg'}
                  onClick={() => commit({ engine: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <b>{st.approvalLabel}</b>
              <p>{st.approvalDesc}</p>
            </div>
            <select
              className="approval-select"
              value={approvalModes.some(([v]) => v === settings.approvalMode) ? settings.approvalMode : ''}
              onChange={(e) => commit({ approvalMode: e.target.value })}
            >
              {approvalModes.map(([v, label]) => (
                <option key={v || '(cli)'} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row col">
            <div>
              <b>{st.cliPathLabel}</b>
              <p>
                {st.cliPathDesc}
                {cliResolved ? (
                  <>
                    {' '}({st.cliCurrent}: <code>{cliResolved}</code>)
                  </>
                ) : (
                  ''
                )}
                . {st.cliStateLabel}: {cliStatus === 'ok' ? st.cliStateOk : cliStatus === 'missing' ? st.cliStateMissing : cliStatus === 'checking' ? st.cliStateChecking : cliStatus === 'error' ? st.cliStateError : st.cliStateUnknown}.
              </p>
            </div>
            <input
              value={cliPath}
              onChange={(e) => setCliPath(e.target.value)}
              onBlur={() => {
                if (cliPath !== settings.cliPath) commit({ cliPath });
              }}
              onKeyDown={blurOnEnter}
              placeholder={st.cliPathDesc}
              spellCheck={false}
            />
          </div>
          <div className="setting-row">
            <div>
              <b>{st.testLabel}</b>
              <p>
                {st.testDescPre}<code>muse exec --help</code>{st.testDescPost}
              </p>
            </div>
            <button className="btn" onClick={runTest} disabled={testing}>
              {testing ? st.testingBtn : st.testBtn}
            </button>
          </div>
          {result && (
            <div className="test-output">
              {result.engine && (
                <div>
                  <b>{st.resultEngine}</b>{' '}
                  <span className="src-tag">
                    {result.engine === 'msp' ? st.engineMsp : result.engine === 'exec' ? st.engineExec : st.engineNone}
                  </span>
                </div>
              )}
              {result.msp && (
                <div>
                  <b>MSP:</b>{' '}
                  {result.msp.ok ? (
                    <>
                      {st.mspConnected}{result.msp.server?.version ? ` (${result.msp.server.version})` : ''}
                      {result.msp.resolvedPath ? (
                        <>
                          {' '}· <code>{maskHomePath(result.msp.resolvedPath)}</code>
                        </>
                      ) : null}
                      {result.msp.fingerprintWarning ? (
                        <div className="test-err">{result.msp.fingerprintWarning}</div>
                      ) : null}
                      {result.msp.sessionMcp === false ? (
                        <div className="test-err">{st.mspToolsUnsupported}</div>
                      ) : result.msp.sessionMcp === true ? (
                        <div>
                          {st.mspTools}{' '}
                          <span className="src-tag">{st.mspToolsSupported}</span>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="test-err">{result.msp.error}</span>
                  )}
                </div>
              )}
              {result.exec && !result.exec.ok && (
                <div>
                  <b>exec:</b> <span className="test-err">{result.exec.error}</span>
                </div>
              )}
              {result.resolvedPath && (
                <div>
                  <b>CLI:</b> <code>{maskHomePath(result.resolvedPath)}</code>{' '}
                  <span className="src-tag">
                    {result.source === 'setting' ? st.cliSrcDirect : formatStr(st.cliSrcAuto, { source: result.source })}
                  </span>
                  {result.version ? (
                    <>
                      {' '}· <b>{st.versionLabel}</b> <code>{result.version}</code>
                    </>
                  ) : null}
                </div>
              )}
              {result.cmd && (
                <div>
                  <b>{st.runLabel}</b> <code>{maskHomePathEverywhere(result.cmd)}</code>
                </div>
              )}
              {!result.ok && result.error === 'CLI_NOT_FOUND' && (
                <div className="test-err">{st.cliNotFound}</div>
              )}
              {!result.ok && result.error && result.error !== 'CLI_NOT_FOUND' && (
                <div className="test-err">{result.error}</div>
              )}
              {result.stdout && <pre>{result.stdout}</pre>}
              {result.stderr && <pre className="stderr">{result.stderr}</pre>}
            </div>
          )}
          <p className="modal-note" style={{ margin: 0 }}>
            {st.execNoteA}<code>muse serve</code>{st.execNoteB}{' '}
            <code>{st.execNoteCmd}</code>{st.execNoteC}{' '}
            {st.execNoteD}
          </p>
        </div>

        <div className="section-cap">{st.secCustom}</div>
        <div className="panel">
          <div className="setting-row col">
            <div>
              <b>{st.secCustom}</b>
              <p>{st.customDesc}</p>
              <p><code>$ARGUMENTS</code> · {st.customHint}</p>
            </div>
            <div className="custom-cmd-list">
              {customCmds.length === 0 && <div className="custom-cmd-empty">{st.customEmpty}</div>}
              {customCmds.map((cmd, index) => (
                <div className="custom-cmd-row" key={`custom-row-${index}`}>
                  <div className="custom-cmd-top">
                    <span className="custom-cmd-slash">/</span>
                    <input
                      className="custom-cmd-name"
                      value={cmd.name}
                      onChange={(e) => {
                        const next = customCmds.slice();
                        next[index] = { ...next[index], name: e.target.value };
                        setCustomCmds(next);
                        setCustomMsg('');
                      }}
                      placeholder={st.customNamePh}
                      spellCheck={false}
                      aria-label={st.customNamePh}
                    />
                    <input
                      className="custom-cmd-desc"
                      value={cmd.desc}
                      onChange={(e) => {
                        const next = customCmds.slice();
                        next[index] = { ...next[index], desc: e.target.value };
                        setCustomCmds(next);
                        setCustomMsg('');
                      }}
                      placeholder={st.customDescPh}
                      spellCheck={false}
                      aria-label={st.customDescPh}
                    />
                    <button
                      type="button"
                      className="btn custom-cmd-del"
                      onClick={() => {
                        setCustomCmds(customCmds.filter((_, i) => i !== index));
                        setCustomMsg('');
                      }}
                    >
                      {st.customDelete}
                    </button>
                  </div>
                  <textarea
                    className="custom-cmd-template"
                    value={cmd.template}
                    onChange={(e) => {
                      const next = customCmds.slice();
                      next[index] = { ...next[index], template: e.target.value };
                      setCustomCmds(next);
                      setCustomMsg('');
                    }}
                    placeholder={st.customTemplatePh}
                    rows={2}
                    spellCheck={false}
                    aria-label={st.customTemplatePh}
                  />
                </div>
              ))}
            </div>
            <div className="custom-cmd-bar">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setCustomCmds([...customCmds, { name: '', template: '', desc: '' }]);
                  setCustomMsg('');
                }}
              >
                {st.customAdd}
              </button>
              <button type="button" className="btn-primary" onClick={saveCustomCmds}>
                {st.customSave}
              </button>
              {customMsg && <span className="custom-cmd-msg" role="status">{customMsg}</span>}
            </div>
          </div>
        </div>

        <div className="section-cap">{st.secHooks}</div>
        <div className="panel">
          <div className="setting-row col">
            <div>
              <b>{st.secHooks}</b>
              <p>{st.hookDesc}</p>
            </div>
            <div className="hook-list">
              {hooks.length === 0 && <div className="custom-cmd-empty">{st.hookEmpty}</div>}
              {hooks.map((h, index) => (
                <div className="hook-row" key={`hook-row-${index}`}>
                  <label className="hook-enabled">
                    <input
                      type="checkbox"
                      checked={h.enabled !== false}
                      onChange={(e) => {
                        const next = hooks.slice();
                        next[index] = { ...next[index], enabled: e.target.checked };
                        setHooks(next);
                        setHookMsg('');
                      }}
                    />
                  </label>
                  <select
                    className="hook-event"
                    value={h.event}
                    onChange={(e) => {
                      const next = hooks.slice();
                      next[index] = { ...next[index], event: e.target.value as TurnHook['event'] };
                      setHooks(next);
                      setHookMsg('');
                    }}
                    aria-label={st.secHooks}
                  >
                    <option value="turn-start">{st.hookEventTurnStart}</option>
                    <option value="turn-done">{st.hookEventTurnDone}</option>
                  </select>
                  <input
                    className="hook-command"
                    value={h.command}
                    onChange={(e) => {
                      const next = hooks.slice();
                      next[index] = { ...next[index], command: e.target.value };
                      setHooks(next);
                      setHookMsg('');
                    }}
                    placeholder={st.hookCommandPh}
                    spellCheck={false}
                    aria-label={st.hookCommandPh}
                  />
                  <input
                    className="hook-timeout"
                    type="number"
                    min={5}
                    max={120}
                    value={h.timeoutSec}
                    onChange={(e) => {
                      const next = hooks.slice();
                      next[index] = { ...next[index], timeoutSec: normalizeHookTimeout(e.target.value) };
                      setHooks(next);
                      setHookMsg('');
                    }}
                    title="timeout (s)"
                    aria-label="timeout (s)"
                  />
                  <button
                    type="button"
                    className="btn hook-test"
                    disabled={hookTesting !== null}
                    onClick={() => void testHook(index)}
                  >
                    {st.hookTest}
                  </button>
                  <button
                    type="button"
                    className="btn custom-cmd-del"
                    onClick={() => {
                      setHooks(hooks.filter((_, i) => i !== index));
                      setHookMsg('');
                    }}
                  >
                    {st.hookDelete}
                  </button>
                </div>
              ))}
            </div>
            <div className="custom-cmd-bar">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setHooks([...hooks, { event: 'turn-done', command: '', enabled: true, timeoutSec: 30 }]);
                  setHookMsg('');
                }}
              >
                {st.hookAdd}
              </button>
              <button type="button" className="btn-primary" onClick={saveHooks}>
                {st.hookSave}
              </button>
              {hookMsg && <span className="custom-cmd-msg" role="status">{hookMsg}</span>}
            </div>
          </div>
        </div>

        <div className="section-cap">{st.secBrowser}</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>{st.agentLabel}</b>
              <p>{st.agentDesc}</p>
            </div>
            <div className="segmented" role="group" aria-label={st.agentLabel}>
              <button
                className={settings.browserAgent ? 'seg active' : 'seg'}
                onClick={() => commit({ browserAgent: true })}
              >
                {st.onBtn}
              </button>
              <button
                className={!settings.browserAgent ? 'seg active' : 'seg'}
                onClick={() => commit({ browserAgent: false })}
              >
                {st.offBtn}
              </button>
            </div>
          </div>
          <div className="setting-row col">
            <div>
              <b>{st.homeLabel}</b>
              <p>{st.homeDesc}</p>
            </div>
            <input
              value={browserHome}
              onChange={(e) => setBrowserHome(e.target.value)}
              onBlur={() => {
                if (browserHome !== settings.browserHome) commit({ browserHome });
              }}
              onKeyDown={blurOnEnter}
              placeholder={st.homePlaceholder}
              spellCheck={false}
            />
          </div>
          <div className="setting-row col">
            <div>
              <b>{st.mcpLabel}</b>
              <p>
                {st.mcpDesc}
              </p>
            </div>
            <div className="mcp-cmd">
              <code title={maskHomePathEverywhere(mcpCmd)}>{maskHomePathEverywhere(mcpCmd) || st.mcpCmdEmpty}</code>
              <button className="btn" onClick={copyMcp} disabled={!mcpCmd}>
                <CopyIcon size={14} /> {copied ? st.copiedBtn : st.copyBtn}
              </button>
            </div>
            {mcpBlock && (
              <pre className="mcp-block" title={mcpSettingsPath ? formatStr(st.mcpPasteAt, { path: maskHomePath(mcpSettingsPath) }) : undefined}>{maskHomePathEverywhere(mcpBlock)}</pre>
            )}
            <div className="mcp-register-row">
              <button className="btn" onClick={copyMcpBlock} disabled={!mcpBlock}>
                <CopyIcon size={14} /> {blockCopied ? st.copiedBtn : st.copyBlockBtn}
              </button>
              <button className="btn" onClick={() => void registerMcp()} disabled={!mcpBlock || mcpRegistering}>
                {mcpRegistering ? st.registeringBtn : st.registerBtn}
              </button>
              {mcpRegisterMsg && <span className="mcp-register-msg" role="status">{mcpRegisterMsg}</span>}
              {!mcpRegisterMsg && mcpRegistration === 'stale-update' && (
                <span className="mcp-register-msg" role="status">{st.mcpStale}</span>
              )}
            </div>
          </div>
        </div>

        <div className="section-cap">{st.secNotif}</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>{st.notifLabel}</b>
              <p>{st.notifDesc}</p>
            </div>
            <div className="segmented" role="group" aria-label={st.notifLabel}>
              <button
                className={settings.backgroundNotifications ? 'seg active' : 'seg'}
                aria-pressed={settings.backgroundNotifications}
                onClick={() => commit({ backgroundNotifications: true })}
              >{st.onBtn}</button>
              <button
                className={!settings.backgroundNotifications ? 'seg active' : 'seg'}
                aria-pressed={!settings.backgroundNotifications}
                onClick={() => commit({ backgroundNotifications: false })}
              >{st.offBtn}</button>
            </div>
          </div>
        </div>

        <div className="section-cap">{st.secShortcuts}</div>
        <div className="panel">
          <div className="setting-row">
            <span>{st.scSidebar}</span>
            <span className="keys">
              <kbd>Ctrl+B</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>{strings.shortcuts.nl16}</span>
            <span className="keys"><kbd>Ctrl+,</kbd></span>
          </div>
          <div className="setting-row">
            <span>{st.scPalette}</span>
            <span className="keys">
              <kbd>F1</kbd> <kbd>Ctrl+Shift+P</kbd> <kbd>Ctrl+K</kbd> <kbd>Ctrl+P</kbd> <kbd>Ctrl+Shift+F</kbd> <kbd>Ctrl+Shift+E</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>{st.scFileTabs}</span>
            <span className="keys">
              <kbd>Ctrl+S</kbd> <kbd>Ctrl+Shift+S</kbd> <kbd>Ctrl+W</kbd> <kbd>Ctrl+Shift+W</kbd> <kbd>Ctrl+Shift+T</kbd> <kbd>Ctrl+Tab</kbd> <kbd>Ctrl+Shift+PageUp</kbd> <kbd>Ctrl+Shift+PageDown</kbd> <kbd>Ctrl+Shift+←/→</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>{st.scTabNumber}</span>
            <span className="keys"><kbd>Ctrl+1–9</kbd></span>
          </div>
          <div className="setting-row">
            <span>{st.scTerm}</span>
            <span className="keys">
              <kbd>Ctrl+R</kbd> <kbd>Ctrl+L</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>{st.scTermHere}</span>
            <span className="keys"><kbd>Ctrl+Shift+`</kbd></span>
          </div>
          <div className="setting-row">
            <span>{st.scSend}</span>
            <span className="keys">
              <kbd>Enter</kbd> <kbd>Shift+Enter</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>{strings.shortcuts.nl06}</span>
            <span className="keys"><kbd>Ctrl+Alt+R</kbd></span>
          </div>
          <div className="setting-row">
            <span>{strings.shortcuts.cl08}</span>
            <span className="keys"><kbd>/new</kbd></span>
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
