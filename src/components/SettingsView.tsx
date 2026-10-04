import React, { useEffect, useRef, useState } from 'react';
import type { CliSettings, CliStatus, MudexApi } from '../types';
import { api, hasBridge } from '../lib/mudex';
import { maskHomePath, maskHomePathEverywhere } from '../lib/path-utils.mjs';
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

const APPROVAL_MODES: [string, string][] = [
  ['', 'CLI 기본값'],
  ['allowAll', '모두 허용'],
  ['promptUnmatched', '모르는 것만 묻기'],
  ['onRequest', '요청 시에만 묻기'],
  ['denyUnmatched', '모르는 건 거부'],
];

export default function SettingsView(props: Props) {
  const { settings, cliStatus, cliResolved, folder, groupBy } = props;
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
    const summary = tokens.length === 0 ? '' : visibleSections === 0 ? '일치하는 설정이 없습니다.' : `${matchedRows}개 설정 · ${visibleSections}개 섹션`;
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
        r.status === 'already-registered' ? '이미 등록되어 있어.'
        : r.status === 'updated' ? '등록 정보를 새 경로로 업데이트했어.'
        : r.status === 'name-taken' ? '같은 이름의 다른 서버가 있어 등록하지 않았어.'
        : r.status === 'invalid-json' ? 'CLI 설정 파일 JSON이 깨져 있어 등록하지 않았어.'
        : r.status === 'write-failed' ? '설정 파일 쓰기에 실패했어.'
        : r.ok ? 'CLI 설정에 브라우저 도구를 등록했어. 다음 exec/터미널 실행부터 적용돼.'
        : (r.error || '등록하지 못했어.');
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
      setResult({ ok: false, error: 'Electron 앱에서 실행해야 합니다.', cmd: '' });
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
          <BackIcon size={14} /> 스레드
        </button>
        <div className="topbar-title">
          <h2>설정</h2>
          <p>바꾸면 바로 이 기기에 저장됩니다. 실행 중인 스레드에는 적용되지 않습니다.</p>
        </div>
        <span className="save-state">{lastSaved ? `저장됨 ${lastSaved.toLocaleTimeString()}` : '자동 저장'}</span>
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
            placeholder="설정 검색 (예: 모델, 승인, 알림)…"
            aria-label="설정 검색"
            aria-keyshortcuts="Escape ArrowDown"
            autoComplete="off"
            spellCheck={false}
          />
          {filterSummary && <span className="settings-filter-summary" role="status" aria-live="polite">{filterSummary}</span>}
          {filterQuery && <button type="button" className="icon-btn" title="검색 지우기 (Esc)" aria-label="설정 검색 지우기" onClick={() => setFilterQuery('')}><XIcon size={13} /></button>}
        </div>
        <div className="settings-sections" ref={settingsSectionsRef}>
        <div ref={filterEmptyRef} className="settings-filter-empty" role="status" hidden>일치하는 설정이 없어. 다른 단어로 검색해줘.</div>
        <div className="section-cap">외관</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>앱 테마</b>
              <p>밝은 화면 또는 어두운 화면. 기본값은 어두움.</p>
            </div>
            <div className="segmented" role="group" aria-label="앱 테마">
              {([
                ['light', '밝음'],
                ['dark', '어두움'],
              ] as const).map(([v, label]) => (
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
              <b>코드 색상</b>
              <p>에디터·diff 색상. 앱 테마와 독립적입니다.</p>
            </div>
            <div className="segmented" role="group" aria-label="코드 색상">
              {([
                ['auto', '자동'],
                ['vs', '밝음'],
                ['vs-dark', '어두움'],
                ['hc-black', '고대비'],
              ] as const).map(([v, label]) => (
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

        <div className="section-cap">새 스레드</div>
        <div className="panel">
          <div className="setting-row col">
            <div>
              <b>모델</b>
              <p>새 스레드가 시작할 모델. 비우면 CLI 기본값.</p>
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
                  {m || 'CLI 기본값'}
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
              placeholder="직접 입력 (예: muse-spark-1.3)"
              spellCheck={false}
            />
          </div>
          <div className="setting-row col">
            <div>
              <b>추가 인자</b>
              <p>
                <code>muse exec</code>에 붙는 옵션 (공백 구분). 승인 없이 돌리려면 CLI의
                비대화형 옵션을 여기에 넣으세요.
              </p>
            </div>
            <input
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              onBlur={() => {
                if (extraArgs !== settings.extraArgs) commit({ extraArgs });
              }}
              onKeyDown={blurOnEnter}
              placeholder="예: --max-model-steps 30"
              spellCheck={false}
            />
          </div>
          <div className="setting-row col">
            <div>
              <b>작업 폴더 고정</b>
              <p>비우면 열린 폴더에서 실행합니다.</p>
            </div>
            <input
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              onBlur={() => {
                if (workdir !== settings.workdir) commit({ workdir });
              }}
              onKeyDown={blurOnEnter}
              placeholder="예: C:\work\my-project"
              spellCheck={false}
            />
          </div>
          <div className="setting-row">
            <div>
              <b>실행 타임아웃 (초)</b>
              <p>0이면 무제한. 지나면 실행을 강제 종료합니다.</p>
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

        <div className="section-cap">스레드 목록</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>그룹 기준</b>
              <p>사이드바 정렬 방식.</p>
            </div>
            <div className="segmented" role="group" aria-label="그룹 기준">
              <button
                className={groupBy === 'project' ? 'seg active' : 'seg'}
                onClick={() => props.onGroupBy('project')}
              >
                프로젝트
              </button>
              <button
                className={groupBy === 'status' ? 'seg active' : 'seg'}
                onClick={() => props.onGroupBy('status')}
              >
                상태
              </button>
            </div>
          </div>
        </div>

        <div className="section-cap">CLI</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>실행 엔진</b>
              <p>MSP(세션·승인·사용량) 우선, 실패하면 exec로. 고정도 가능.</p>
            </div>
            <div className="segmented" role="group" aria-label="실행 엔진">
              {(
                [
                  ['auto', '자동'],
                  ['msp', 'MSP'],
                  ['exec', 'exec'],
                ] as const
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
              <b>승인 모드</b>
              <p>MSP 세션의 도구 승인 기본값. 비우면 CLI 기본값.</p>
            </div>
            <select
              className="approval-select"
              value={APPROVAL_MODES.some(([v]) => v === settings.approvalMode) ? settings.approvalMode : ''}
              onChange={(e) => commit({ approvalMode: e.target.value })}
            >
              {APPROVAL_MODES.map(([v, label]) => (
                <option key={v || '(cli)'} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-row col">
            <div>
              <b>CLI 실행 경로</b>
              <p>
                비우면 PATH에서 자동 감지
                {cliResolved ? (
                  <>
                    {' '}(현재: <code>{cliResolved}</code>)
                  </>
                ) : (
                  ''
                )}
                . 상태: {cliStatus === 'ok' ? '연결됨' : cliStatus === 'missing' ? '없음' : cliStatus === 'checking' ? '확인 중' : cliStatus === 'error' ? '오류' : '미확인'}.
              </p>
            </div>
            <input
              value={cliPath}
              onChange={(e) => setCliPath(e.target.value)}
              onBlur={() => {
                if (cliPath !== settings.cliPath) commit({ cliPath });
              }}
              onKeyDown={blurOnEnter}
              placeholder="비우면 PATH에서 자동 감지"
              spellCheck={false}
            />
          </div>
          <div className="setting-row">
            <div>
              <b>연결 테스트</b>
              <p>
                <code>muse exec --help</code>을 실행해 봅니다.
              </p>
            </div>
            <button className="btn" onClick={runTest} disabled={testing}>
              {testing ? '테스트 중…' : '테스트'}
            </button>
          </div>
          {result && (
            <div className="test-output">
              {result.engine && (
                <div>
                  <b>엔진:</b>{' '}
                  <span className="src-tag">
                    {result.engine === 'msp' ? 'MSP 연결됨' : result.engine === 'exec' ? 'exec만 가능' : '사용 불가'}
                  </span>
                </div>
              )}
              {result.msp && (
                <div>
                  <b>MSP:</b>{' '}
                  {result.msp.ok ? (
                    <>
                      연결됨{result.msp.server?.version ? ` (${result.msp.server.version})` : ''}
                      {result.msp.resolvedPath ? (
                        <>
                          {' '}· <code>{maskHomePath(result.msp.resolvedPath)}</code>
                        </>
                      ) : null}
                      {result.msp.fingerprintWarning ? (
                        <div className="test-err">{result.msp.fingerprintWarning}</div>
                      ) : null}
                      {result.msp.sessionMcp === false ? (
                        <div className="test-err">브라우저 도구 미지원 — CLI 업데이트가 필요합니다.</div>
                      ) : result.msp.sessionMcp === true ? (
                        <div>
                          브라우저 도구:{' '}
                          <span className="src-tag">지원됨</span>
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
                    {result.source === 'setting' ? '직접 지정' : `자동 감지(${result.source})`}
                  </span>
                  {result.version ? (
                    <>
                      {' '}· <b>버전:</b> <code>{result.version}</code>
                    </>
                  ) : null}
                </div>
              )}
              {result.cmd && (
                <div>
                  <b>실행:</b> <code>{maskHomePathEverywhere(result.cmd)}</code>
                </div>
              )}
              {!result.ok && result.error === 'CLI_NOT_FOUND' && (
                <div className="test-err">CLI를 찾을 수 없습니다. 설치 여부와 경로를 확인하세요.</div>
              )}
              {!result.ok && result.error && result.error !== 'CLI_NOT_FOUND' && (
                <div className="test-err">{result.error}</div>
              )}
              {result.stdout && <pre>{result.stdout}</pre>}
              {result.stderr && <pre className="stderr">{result.stderr}</pre>}
            </div>
          )}
          <p className="modal-note" style={{ margin: 0 }}>
            채팅은 MSP(<code>muse serve</code>) 우선, 실패하면{' '}
            <code>muse exec [옵션] “프롬프트”</code>로 실행됩니다 (프롬프트는 항상 맨 마지막).
            CLI 로그인/구독을 그대로 사용하고, Musician은 키를 저장하지 않습니다.
          </p>
        </div>

        <div className="section-cap">브라우저</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>에이전트 조종</b>
              <p>켜면 CLI 에이전트가 이 앱의 브라우저 탭을 같이 조작합니다 (이동·클릭·입력·캡처).</p>
            </div>
            <div className="segmented" role="group" aria-label="에이전트 조종">
              <button
                className={settings.browserAgent ? 'seg active' : 'seg'}
                onClick={() => commit({ browserAgent: true })}
              >
                켜짐
              </button>
              <button
                className={!settings.browserAgent ? 'seg active' : 'seg'}
                onClick={() => commit({ browserAgent: false })}
              >
                꺼짐
              </button>
            </div>
          </div>
          <div className="setting-row col">
            <div>
              <b>홈페이지</b>
              <p>브라우저 탭을 처음 열 때 보여줄 주소. 비우면 Google.</p>
            </div>
            <input
              value={browserHome}
              onChange={(e) => setBrowserHome(e.target.value)}
              onBlur={() => {
                if (browserHome !== settings.browserHome) commit({ browserHome });
              }}
              onKeyDown={blurOnEnter}
              placeholder="예: https://github.com"
              spellCheck={false}
            />
          </div>
          <div className="setting-row col">
            <div>
              <b>에이전트 연결 (MCP)</b>
              <p>
                MSP 채팅은 자동으로 연결됩니다. exec·터미널에서 쓰는 CLI는 아래 항목을
                CLI 설정의 mcpServers에 등록해야 browser_navigate·snapshot·click·type
                같은 도구를 씁니다. 실행 파일은 이 앱 자체라 Node 설치가 필요 없습니다.
              </p>
            </div>
            <div className="mcp-cmd">
              <code title={maskHomePathEverywhere(mcpCmd)}>{maskHomePathEverywhere(mcpCmd) || '앱에서 실행해야 표시됩니다.'}</code>
              <button className="btn" onClick={copyMcp} disabled={!mcpCmd}>
                <CopyIcon size={14} /> {copied ? '복사됨' : '복사'}
              </button>
            </div>
            {mcpBlock && (
              <pre className="mcp-block" title={mcpSettingsPath ? `붙여넣기 위치: ${maskHomePath(mcpSettingsPath)}` : undefined}>{maskHomePathEverywhere(mcpBlock)}</pre>
            )}
            <div className="mcp-register-row">
              <button className="btn" onClick={copyMcpBlock} disabled={!mcpBlock}>
                <CopyIcon size={14} /> {blockCopied ? '복사됨' : '설정 블록 복사'}
              </button>
              <button className="btn" onClick={() => void registerMcp()} disabled={!mcpBlock || mcpRegistering}>
                {mcpRegistering ? '등록 중…' : 'CLI 설정에 등록'}
              </button>
              {mcpRegisterMsg && <span className="mcp-register-msg" role="status">{mcpRegisterMsg}</span>}
              {!mcpRegisterMsg && mcpRegistration === 'stale-update' && (
                <span className="mcp-register-msg" role="status">등록된 경로가 바뀌었어. 다시 등록해줘.</span>
              )}
            </div>
          </div>
        </div>

        <div className="section-cap">알림</div>
        <div className="panel">
          <div className="setting-row">
            <div>
              <b>백그라운드 작업 완료 알림</b>
              <p>다른 대화를 보거나 창이 포커스를 잃은 동안 작업이 끝나면 시스템 알림을 보냅니다. 프롬프트 본문은 알림에 표시하지 않습니다.</p>
            </div>
            <div className="segmented" role="group" aria-label="백그라운드 작업 완료 알림">
              <button
                className={settings.backgroundNotifications ? 'seg active' : 'seg'}
                aria-pressed={settings.backgroundNotifications}
                onClick={() => commit({ backgroundNotifications: true })}
              >켜짐</button>
              <button
                className={!settings.backgroundNotifications ? 'seg active' : 'seg'}
                aria-pressed={!settings.backgroundNotifications}
                onClick={() => commit({ backgroundNotifications: false })}
              >꺼짐</button>
            </div>
          </div>
        </div>

        <div className="section-cap">단축키</div>
        <div className="panel">
          <div className="setting-row">
            <span>사이드바 토글</span>
            <span className="keys">
              <kbd>Ctrl+B</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>설정 열기</span>
            <span className="keys"><kbd>Ctrl+,</kbd></span>
          </div>
          <div className="setting-row">
            <span>명령 팔레트 / 파일 이름·내용 검색 / 탐색기</span>
            <span className="keys">
              <kbd>F1</kbd> <kbd>Ctrl+Shift+P</kbd> <kbd>Ctrl+K</kbd> <kbd>Ctrl+P</kbd> <kbd>Ctrl+Shift+F</kbd> <kbd>Ctrl+Shift+E</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>파일 저장 / 모두 저장 / 현재·전체 탭 닫기 / 탭 이동·순서 변경</span>
            <span className="keys">
              <kbd>Ctrl+S</kbd> <kbd>Ctrl+Shift+S</kbd> <kbd>Ctrl+W</kbd> <kbd>Ctrl+Shift+W</kbd> <kbd>Ctrl+Shift+T</kbd> <kbd>Ctrl+Tab</kbd> <kbd>Ctrl+Shift+PageUp</kbd> <kbd>Ctrl+Shift+PageDown</kbd> <kbd>Ctrl+Shift+←/→</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>탭 번호로 바로 이동 (9는 마지막 탭)</span>
            <span className="keys"><kbd>Ctrl+1–9</kbd></span>
          </div>
          <div className="setting-row">
            <span>터미널 기록 검색 / 화면 지우기</span>
            <span className="keys">
              <kbd>Ctrl+R</kbd> <kbd>Ctrl+L</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>현재 프로젝트에서 터미널 열기</span>
            <span className="keys"><kbd>Ctrl+Shift+`</kbd></span>
          </div>
          <div className="setting-row">
            <span>전송 / 줄바꿈</span>
            <span className="keys">
              <kbd>Enter</kbd> <kbd>Shift+Enter</kbd>
            </span>
          </div>
          <div className="setting-row">
            <span>예약된 프롬프트 관리</span>
            <span className="keys"><kbd>Ctrl+Alt+R</kbd></span>
          </div>
          <div className="setting-row">
            <span>슬래시 명령 (입력 시작)</span>
            <span className="keys"><kbd>/new</kbd></span>
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
