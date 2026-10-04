// MSP engine: drives `muse serve` via @muse-code/sdk (plain CJS; the SDK is
// ESM so it is loaded with a lazy dynamic import).
//
// Pattern: bare spawnMspConnection + manual Session objects + our own
// notification pump. (MuseClient claims the single notification handler, and
// we also need usage/token frames.) Subscription only — no Model API keys.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import('@muse-code/sdk');
  return sdkPromise;
}

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+-R[0-9]+(\.[0-9]+)?$/;
const APPROVAL_MODES = new Set(['allowAll', 'promptUnmatched', 'onRequest', 'denyUnmatched']);
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
// Real hosts reject session/start carrying mcpServers unless sessionMcp was
// granted at handshake ("session MCP configuration requires the sessionMcp
// capability"). Request it up front; hosts that predate it fail the full
// handshake and get a bare retry (see ensureHost/test).
const BASE_CAPS = ['userShell'];
const FULL_CAPS = ['userShell', 'sessionMcp'];

function checkInstallDir(dir) {
  try {
    const ver = fs.readFileSync(path.join(dir, '.muse-version'), 'utf8').trim();
    if (!VERSION_RE.test(ver)) return null;
    const bin = path.join(dir, `muse-bin-${ver}.exe`);
    if (fs.statSync(bin).isFile()) return { path: bin, source: 'install-dir' };
  } catch {
    /* not an install dir */
  }
  return null;
}

// Resolve the REAL serve binary. Launchers/shims (.cmd/.ps1) cannot host a
// stdio JSON-RPC session, so anything but a direct executable is refused.
function findServeBinary(explicit) {
  if (explicit && String(explicit).trim()) {
    const p = String(explicit).trim();
    try {
      if (fs.statSync(p).isFile()) return { path: p, source: 'setting' };
    } catch {
      /* fall through: let spawn report ENOENT */
    }
    return { path: p, source: 'setting' };
  }
  const pathDirs = String(process.env.PATH || process.env.Path || '')
    .split(path.delimiter)
    .map((s) => String(s || '').trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  if (process.platform === 'win32') {
    const dirs = [];
    if (process.env.MUSE_INSTALL_DIR) dirs.push(process.env.MUSE_INSTALL_DIR);
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'muse'));
    for (const d of dirs) {
      const hit = checkInstallDir(d);
      if (hit) return hit;
    }
    for (const d of pathDirs) {
      const hit = checkInstallDir(d);
      if (hit) return hit;
    }
    for (const d of pathDirs) {
      const exe = path.join(d, 'muse.exe');
      try {
        if (fs.statSync(exe).isFile()) return { path: exe, source: 'PATH' };
      } catch {
        /* next */
      }
    }
    return { path: 'muse.exe', source: 'not-found' };
  }
  for (const d of pathDirs) {
    const f = path.join(d, 'muse');
    try {
      if (fs.statSync(f).isFile()) return { path: f, source: 'PATH' };
    } catch {
      /* next */
    }
  }
  return { path: 'muse', source: 'not-found' };
}

function serveError(code, detail) {
  const e = new Error(detail ? `${code}:${detail}` : code);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------- shapes
function slimItem(it) {
  if (!it || typeof it !== 'object') return null;
  const o = { itemId: it.itemId, kind: it.kind, status: it.status, revision: it.revision };
  for (const k of [
    'turnId', 'text', 'summary', 'displayText', 'fallbackText', 'message', 'visibleOutput',
    'tool', 'args', 'failureReason', 'durationMs', 'usage', 'exitCode', 'approvalId',
  ]) {
    if (it[k] !== undefined) o[k] = it[k];
  }
  return o;
}

function slimOutcome(o) {
  if (!o || typeof o !== 'object') return { kind: 'unknown' };
  if (o.kind === 'completed') {
    const p = o.params || {};
    return {
      kind: 'completed',
      terminal: p.terminal || 'completed',
      durationMs: p.durationMs ?? null,
      usage: p.usage || null,
      reason: p.reason || null,
      errorText: p.error ? p.error.message || String(p.error.kind || 'error') : null,
    };
  }
  if (o.kind === 'unqueued') return { kind: 'unqueued' };
  return { kind: o.kind || 'unknown' };
}

function slimApproval(req) {
  return {
    approvalId: req.approvalId,
    requirementId: req.currentRequirementId,
    sessionId: req.sessionId,
    turnId: req.turnId,
    toolName: req.toolName,
    subject: req.subject || {},
    rawArgs: req.rawArgs || '',
    choices: (req.availableChoices || []).map((c) => ({
      choiceId: c.choiceId,
      label: c.label,
      decision: c.decision,
      scope: c.scope,
      acceptsFeedback: !!c.acceptsFeedback,
      rulePreview: c.rulePreview || null,
    })),
  };
}

function slimSession(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    sessionId: s.sessionId,
    title: s.title || s.name || s.firstUserPrompt || null,
    name: s.name || null,
    workspaceRoot: s.workspaceRoot || null,
    status: s.status || null,
    turnCount: typeof s.turnCount === 'number' ? s.turnCount : 0,
    updatedAt: s.updatedAt || s.createdAt || null,
    modelId: s.modelId || null,
  };
}

function slimUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const w = (x) => (x && typeof x.usedPercent === 'number' ? x : null);
  const win = w(u.window);
  const weekly = w(u.weekly);
  if (!win || !weekly || typeof u.observedAtMs !== 'number') return null;
  return {
    tier: typeof u.tier === 'string' ? u.tier : 'unknown',
    observedAtMs: u.observedAtMs,
    window: { usedPercent: win.usedPercent, resetsAtMs: win.resetsAtMs, windowDurationMins: win.windowDurationMins ?? null },
    weekly: { usedPercent: weekly.usedPercent, resetsAtMs: weekly.resetsAtMs },
  };
}

// History items → chat transcript. Text kinds only; the rest would need the
// full item renderer (v1 keeps the message list).
function historyToMessages(items) {
  const out = [];
  for (const it of items || []) {
    if (!it || typeof it !== 'object') continue;
    if (it.kind === 'userMessage') {
      const text = it.displayText || it.text || (it.fallbackText || '');
      if (text) out.push({ role: 'user', text });
    } else if (it.kind === 'agentMessage') {
      const text = it.text || it.fallbackText || '';
      if (text) out.push({ role: 'assistant', text });
    }
  }
  return out;
}

class MspEngine {
  // send(channel, payload): main-process fan-out to the renderer.
  // museBin/serveArgs: test seams — run a fake host instead of real `muse serve`.
  constructor({ send, version, museBin, serveArgs, getSessionConfig, preflightSessionConfig }) {
    this.send = send;
    this.getSessionConfig = getSessionConfig;
    this.preflightSessionConfig = preflightSessionConfig;
    this.version = version || '0.0.0';
    this.museBin = museBin || null;
    this.serveArgs = serveArgs || ['serve'];
    this.hosts = new Map(); // key -> host
    this.threads = new Map(); // threadKey -> { threadKey, host, session, mspSessionId, turnId }
    this.pendingApprovals = new Map(); // key -> { resolve, reject, threadKey, hostKey }
    this.approvalSeq = 0;
    this.pendingUserInputs = new Map(); // key -> { host, hostKey, threadKey, sessionId, userInputId }
    this.userInputSeq = 0;
  }

  _key(cwd) {
    return cwd || '__default__';
  }

  // One handshake attempt. Closes the failed attempt so no serve process leaks.
  async _handshake(bin, cwd, caps, onStderr) {
    const { spawnMspConnection } = await loadSdk();
    const handshake = spawnMspConnection({
      command: bin.path,
      args: this.serveArgs,
      cwd: cwd || undefined,
      env: process.env,
      onStderr,
    });
    try {
      return await handshake.initialize({
        clientInfo: { name: 'mudex', version: this.version },
        capabilities: { requestedCapabilities: caps },
      });
    } catch (err) {
      try {
        await handshake.close().catch(() => {});
      } catch {
        /* best effort */
      }
      throw err;
    }
  }

  async ensureHost(cwd, settings) {
    const key = this._key(cwd);
    const existing = this.hosts.get(key);
    if (existing && !existing.dead) return existing;
    if (existing) this.hosts.delete(key);
    const { readSessionDurability } = await loadSdk();
    const s = settings || {};
    const bin = this.museBin ? { path: this.museBin, source: 'test' } : findServeBinary(s.cliPath);
    if (bin.source === 'not-found') throw serveError('CLI_NOT_FOUND');
    if (!this.museBin && /\.(cmd|bat|ps1|sh)$/i.test(bin.path)) {
      throw serveError('SERVE_NEEDS_EXE', bin.path);
    }
    const onStderr = (c) => this.send('msp:stderr', { key, text: String(c) });
    let spawned;
    let sessionMcp = true;
    try {
      spawned = await this._handshake(bin, cwd, FULL_CAPS, onStderr);
    } catch (firstErr) {
      // Hosts older than session MCP fail the full handshake: retry bare so
      // plain chat keeps working, and mark the host degraded for callers.
      try {
        spawned = await this._handshake(bin, cwd, BASE_CAPS, onStderr);
        sessionMcp = false;
      } catch (err) {
        throw serveError('SERVE_HANDSHAKE_FAIL', (err && err.message) || String(err));
      }
    }
    const durability = readSessionDurability(spawned.initializeResult);
    const host = { key, cwd, spawned, connection: spawned.connection, durability, sessions: new Map(), dead: false, bin, sessionMcp };
    spawned.connection.onNotification((n) => this._onNotification(host, n));
    spawned.connection.onServerRequest((req) => this._onServerRequest(host, req));
    spawned.exited.then(
      (exit) => this._onHostExit(host, { code: exit.code, signal: exit.signal }),
      () => this._onHostExit(host, { code: null, signal: null }),
    );
    this.hosts.set(key, host);
    return host;
  }

  _assertMcpCapable(host, config, mspSessionId, lang = 'ko') {
    const needsMcp = config && config.mcpServers && Object.keys(config.mcpServers).length > 0;
    if (needsMcp && host.sessionMcp === false) {
      this.send('msp:mcp-unavailable', { key: host.key, mspSessionId: mspSessionId || null });
      throw serveError('CLI_NO_SESSION_MCP', lang === 'en'
        ? 'Browser tools need a Muse CLI update (session MCP unsupported)'
        : '브라우저 도구를 쓰려면 Muse CLI 업데이트가 필요합니다 (세션 MCP 미지원)');
    }
  }

  // Retire one host and forget its threads/pendings. Used for conflict bounce.
  async _dropHost(host) {
    host.dead = true;
    if (this.hosts.get(host.key) === host) this.hosts.delete(host.key);
    for (const [k, t] of this.threads) if (t.host === host) this.threads.delete(k);
    for (const [k, p] of this.pendingApprovals) {
      if (p.hostKey !== host.key) continue;
      this.pendingApprovals.delete(k);
      try {
        p.reject(new Error('HOST_BOUNCED'));
      } catch {
        /* already settled */
      }
    }
    for (const [key, pending] of this.pendingUserInputs) {
      if (pending.hostKey === host.key) this.pendingUserInputs.delete(key);
    }
    try {
      await host.spawned.close();
    } catch {
      /* best effort */
    }
  }

  async _threadSession(threadKey, cwd, settings, mspSessionId) {
    const live = this.threads.get(threadKey);
    if (live && !live.host.dead) return { t: live, history: [] };
    let host = await this.ensureHost(cwd, settings);
    const { Session } = await loadSdk();
    const s = settings || {};
    const id = (live && live.mspSessionId) || mspSessionId;
    const config = this.getSessionConfig ? await this.getSessionConfig(s) : undefined;
    this._assertMcpCapable(host, config, id, s.lang);
    // Optional servers fail silently on the host (no error, no event), so
    // pre-flight them here and publish the result for UI/logs. The config is
    // left intact: the host still decides, and editing it could desync a
    // loaded session runtime (see the conflict retry below).
    const hasMcpServers = config && config.mcpServers && Object.keys(config.mcpServers).length > 0;
    let mcpHealth = null;
    if (hasMcpServers && this.preflightSessionConfig) {
      try {
        mcpHealth = await this.preflightSessionConfig(config, { cwd, settings: s });
      } catch (err) {
        mcpHealth = [{ name: '*', ok: false, reason: `PREFLIGHT_FAILED:${(err && err.message) || err}` }];
      }
      this.send('msp:mcp-health', { key: host.key, mspSessionId: id || null, health: mcpHealth });
    }
    let session;
    let history = [];
    if (id) {
      const attempt = () => host.connection.command('session/resume', { sessionId: id, ...(config ? { config } : {}) });
      let res;
      try {
        res = await attempt();
      } catch (err) {
        // The host rejects MCP config changes against an already-loaded
        // session ("conflicts with the loaded session runtime"). A fresh host
        // accepts the new config, so bounce an IDLE host and retry once.
        if (!/conflicts with the loaded session runtime/.test(String((err && err.message) || err))) throw err;
        const busy = [...this.threads.values()].some((t) => t.host === host && !t.host.dead && t.turnId);
        if (busy) {
          throw serveError('CLI_MCP_CONFIG_CONFLICT', s.lang === 'en'
            ? 'Another conversation is running. Resume again after it ends to apply the browser tool settings'
            : '다른 대화가 진행 중입니다. 끝난 뒤 다시 이어하기하면 브라우저 도구 설정이 적용됩니다');
        }
        this.send('msp:host-bounced', { key: host.key, reason: 'mcp-config-conflict' });
        await this._dropHost(host);
        host = await this.ensureHost(cwd, settings);
        this._assertMcpCapable(host, config, id, s.lang);
        res = await attempt();
      }
      session = new Session({
        sessionId: id,
        durability: host.durability,
        connection: host.connection,
        opening: { verb: 'session/resume', result: res },
      });
      history = (res.history && res.history.items) || [];
    } else {
      const params = {};
      if (config) params.config = config;
      if (cwd) params.workspaceRoot = cwd;
      if (s.model) params.modelId = s.model;
      if (APPROVAL_MODES.has(s.approvalMode)) params.approvalMode = s.approvalMode;
      if (REASONING_EFFORTS.has(s.reasoningEffort)) params.reasoningEffort = s.reasoningEffort;
      const res = await host.connection.command('session/start', params);
      const newId = res.session && res.session.sessionId;
      if (!newId) throw serveError('MSP_NO_SESSION');
      session = new Session({
        sessionId: newId,
        durability: host.durability,
        connection: host.connection,
        opening: { verb: 'session/start', result: res },
      });
      return this._registerThread(threadKey, host, session, newId, [], mcpHealth);
    }
    return this._registerThread(threadKey, host, session, id, history, mcpHealth);
  }

  _registerThread(threadKey, host, session, mspSessionId, history, mcpHealth) {
    session.onApproval((req) => this._handleApproval(threadKey, host.key, req));
    session.onApprovalError((f) =>
      this.send('msp:approval-error', { threadKey, failure: { kind: f.kind, approvalId: f.approvalId } }),
    );
    const t = { threadKey, host, session, mspSessionId, turnId: null };
    this.threads.set(threadKey, t);
    host.sessions.set(mspSessionId, t);
    return { t, history, mcpHealth: mcpHealth || null };
  }

  _handleApproval(threadKey, hostKey, req) {
    const key = `appr-${Date.now().toString(36)}-${(this.approvalSeq += 1)}`;
    return new Promise((resolve, reject) => {
      this.pendingApprovals.set(key, { resolve, reject, threadKey, hostKey });
      this.send('msp:approval', { key, threadKey, mspSessionId: req.sessionId, approval: slimApproval(req) });
    });
  }

  decideApproval(key, choiceId, feedback) {
    const p = this.pendingApprovals.get(key);
    if (!p) return false;
    this.pendingApprovals.delete(key);
    const decision = { choiceId };
    if (feedback) decision.feedback = feedback;
    p.resolve(decision);
    return true;
  }

  async sendTurn(threadKey, text, opts) {
    const o = opts || {};
    const { t, mcpHealth } = await this._threadSession(threadKey, o.cwd, o.settings, o.mspSessionId);
    const short = String(text).length > 200 ? `${String(text).slice(0, 200)}…` : String(text);
    const turn = await t.session.sendUserTurn({ input: [{ type: 'text', text: String(text) }], displayText: short });
    t.turnId = turn.turnId;
    // Stream items in the background; completion settles separately so the
    // ack returns promptly and the UI can show progress + cancel.
    void (async () => {
      try {
        for await (const item of turn.items()) {
          o.onItem({ turnId: turn.turnId, item: slimItem(item) });
        }
      } catch (err) {
        if (o.onItemError) o.onItemError(err);
      }
    })();
    void (async () => {
      try {
        const outcome = await turn.completed;
        t.turnId = null;
        o.onDone({ outcome: slimOutcome(outcome) });
      } catch (err) {
        t.turnId = null;
        o.onDone({ error: `TURN_FAILED:${(err && err.message) || err}` });
      }
    })();
    return { turnId: turn.turnId, mspSessionId: t.mspSessionId, mcpHealth: mcpHealth || null };
  }

  _onNotification(host, n) {
    const method = n && n.method;
    const p = (n && n.params) || {};
    const sid = typeof p.sessionId === 'string' ? p.sessionId : null;
    if (sid && host.sessions.has(sid)) {
      try {
        host.sessions.get(sid).session.apply(n);
      } catch (err) {
        this.send('msp:fold-error', { key: host.key, error: String((err && err.message) || err) });
      }
    }
    if (method === 'userInput/settled' && p.sessionId && p.userInputId) {
      for (const [key, pending] of this.pendingUserInputs) {
        if (pending.sessionId === p.sessionId && pending.userInputId === p.userInputId) this.pendingUserInputs.delete(key);
      }
      this.send('msp:user-input-settled', { sessionId: p.sessionId, userInputId: p.userInputId });
    }
    if (method === 'session/tokenUsage') {
      this.send('msp:tokens', {
        key: host.key,
        sessionId: sid,
        turnId: p.turnId || null,
        usage: p.usage || null,
        cumulative: p.cumulative || null,
        modelId: p.modelId || null,
        durationMs: p.durationMs ?? null,
      });
    } else if (method === 'session/contextUsage') {
      this.send('msp:context', {
        key: host.key,
        sessionId: sid,
        usedTokens: p.usedTokens ?? null,
        windowTokens: p.windowTokens ?? null,
        pressure: p.pressure || null,
      });
    } else if (method === 'usage/changed') {
      this.send('msp:usage', { key: host.key, usage: slimUsage(p.usage !== undefined ? p.usage : p) });
    } else if (method === 'approval/resolved') {
      this.send('msp:approval-resolved', { key: host.key, sessionId: sid, approvalId: p.approvalId || null });
    } else if (method === 'session/listChanged') {
      this.send('msp:sessions-changed', { key: host.key });
    }
  }

  async _onServerRequest(host, req) {
    if (req?.method === 'userInput/request') {
      const p = req.params || {};
      if (typeof p.sessionId !== 'string' || typeof p.userInputId !== 'string' || !Array.isArray(p.questions) || !p.questions.length) {
        if (typeof p.sessionId === 'string' && typeof p.userInputId === 'string') {
          const commandId = host.connection.mintCommandId();
          try {
            await host.connection.command('userInput/cancel', {
              commandId,
              sessionId: p.sessionId,
              userInputId: p.userInputId,
              reason: 'Musician에서 질문 형식을 표시할 수 없습니다.',
            }, { commandId });
          } catch { /* best effort */ }
        }
        return {};
      }
      const thread = host.sessions.get(p.sessionId);
      if (!thread) {
        const commandId = host.connection.mintCommandId();
        try {
          await host.connection.command('userInput/cancel', {
            commandId,
            sessionId: p.sessionId,
            userInputId: p.userInputId,
            reason: 'Musician에서 응답할 세션을 찾을 수 없습니다.',
          }, { commandId });
        } catch { /* best effort */ }
        return {};
      }
      const existing = [...this.pendingUserInputs].find(([, pending]) => pending.sessionId === p.sessionId && pending.userInputId === p.userInputId);
      const key = existing?.[0] || `input-${Date.now().toString(36)}-${(this.userInputSeq += 1)}`;
      const questions = p.questions.map((question) => ({
        id: String(question?.id || ''),
        header: String(question?.header || ''),
        question: String(question?.question || ''),
        options: Array.isArray(question?.options) ? question.options.map((option) => ({
          label: String(option?.label || ''),
          description: typeof option?.description === 'string' ? option.description : undefined,
          preview: option?.preview && typeof option.preview.content === 'string'
            ? { content: option.preview.content, format: String(option.preview.format || 'text') }
            : undefined,
        })).filter((option) => option.label) : [],
        selection: {
          mode: question?.selection?.mode === 'multiple' ? 'multiple' : 'single',
          minSelections: Number.isInteger(question?.selection?.minSelections) ? question.selection.minSelections : undefined,
          maxSelections: Number.isInteger(question?.selection?.maxSelections) ? question.selection.maxSelections : undefined,
        },
      })).filter((question) => question.id && question.question);
      if (!questions.length) {
        const commandId = host.connection.mintCommandId();
        try {
          await host.connection.command('userInput/cancel', {
            commandId,
            sessionId: p.sessionId,
            userInputId: p.userInputId,
            reason: 'Musician에서 질문 내용을 표시할 수 없습니다.',
          }, { commandId });
        } catch { /* best effort */ }
        return {};
      }
      if (!existing) this.pendingUserInputs.set(key, { host, hostKey: host.key, threadKey: thread.threadKey, sessionId: p.sessionId, userInputId: p.userInputId });
      this.send('msp:user-input', {
        key,
        threadKey: thread.threadKey,
        sessionId: p.sessionId,
        userInputId: p.userInputId,
        toolName: String(p.toolName || 'Muse'),
        questions,
        autoResolutionMs: Number.isFinite(p.autoResolutionMs) ? p.autoResolutionMs : undefined,
      });
      return {};
    }
    this.send('msp:server-request', {
      key: host.key,
      method: req && req.method,
      sessionId: req && req.params && req.params.sessionId,
    });
    return {};
  }

  async answerUserInput(key, answers) {
    return this._settleUserInput(key, 'userInput/answer', { answers });
  }

  async cancelUserInput(key) {
    return this._settleUserInput(key, 'userInput/cancel', { reason: '사용자가 응답을 건너뛰었습니다.' });
  }

  async _settleUserInput(key, method, values) {
    const pending = this.pendingUserInputs.get(key);
    if (!pending || pending.host.dead) return { ok: false, error: 'USER_INPUT_NO_LONGER_PENDING' };
    const commandId = pending.host.connection.mintCommandId();
    try {
      const result = await pending.host.connection.command(method, {
        ...values,
        commandId,
        sessionId: pending.sessionId,
        userInputId: pending.userInputId,
      }, { commandId });
      this.pendingUserInputs.delete(key);
      this.send('msp:user-input-settled', { sessionId: pending.sessionId, userInputId: pending.userInputId });
      return { ok: true, status: result.status };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  _onHostExit(host, exit) {
    if (host.dead) return;
    host.dead = true;
    for (const [k, p] of this.pendingApprovals) {
      if (p.hostKey === host.key) {
        this.pendingApprovals.delete(k);
        try {
          p.reject(new Error('HOST_DEAD'));
        } catch {
          /* already settled */
        }
      }
    }
    for (const [key, pending] of this.pendingUserInputs) {
      if (pending.hostKey === host.key) this.pendingUserInputs.delete(key);
    }
    this.send('msp:host-dead', { key: host.key, code: exit.code, signal: exit.signal });
  }

  async listSessions(cwd, settings) {
    const host = await this.ensureHost(cwd, settings);
    const params = { limit: 50 };
    if (cwd) params.workspaceRoot = cwd;
    const r = await host.connection.request('session/list', params);
    const arr = r && Array.isArray(r.sessions) ? r.sessions : [];
    return arr.map(slimSession).filter(Boolean);
  }

  async resumeThread(threadKey, mspSessionId, cwd, settings) {
    this.threads.delete(threadKey);
    const { t, history, mcpHealth } = await this._threadSession(threadKey, cwd, settings, mspSessionId);
    return { mspSessionId: t.mspSessionId, messages: historyToMessages(history), mcpHealth: mcpHealth || null };
  }

  async readUsage(cwd, settings) {
    const host = await this.ensureHost(cwd, settings);
    const r = await host.connection.request('usage/read', {});
    return slimUsage(r && r.usage);
  }

  async cancelTurn(threadKey) {
    const t = this.threads.get(threadKey);
    if (!t || t.host.dead) return false;
    const params = { sessionId: t.mspSessionId };
    if (t.turnId) params.turnId = t.turnId;
    await t.host.connection.command('turn/cancel', params);
    return true;
  }

  async setModel(threadKey, modelId) {
    const t = this.threads.get(threadKey);
    if (!t || t.host.dead) throw serveError('MSP_NO_THREAD');
    await t.host.connection.command('session/setModel', { sessionId: t.mspSessionId, model: { modelId } });
    return true;
  }

  async setApprovalMode(threadKey, mode) {
    const t = this.threads.get(threadKey);
    if (!t || t.host.dead) throw serveError('MSP_NO_THREAD');
    if (!APPROVAL_MODES.has(mode)) throw serveError('MSP_BAD_APPROVAL_MODE', String(mode));
    await t.host.connection.command('session/setApprovalMode', { sessionId: t.mspSessionId, mode });
    return true;
  }

  async setReasoningEffort(threadKey, effort) {
    const t = this.threads.get(threadKey);
    if (!t || t.host.dead) throw serveError('MSP_NO_THREAD');
    if (!REASONING_EFFORTS.has(effort)) throw serveError('MSP_BAD_REASONING', String(effort));
    await t.host.connection.command('session/setReasoningEffort', { sessionId: t.mspSessionId, reasoningEffort: effort });
    return true;
  }

  async listModels(cwd, settings) {
    const host = await this.ensureHost(cwd, settings);
    const r = await host.connection.request('model/list', {});
    const arr = r && Array.isArray(r.models) ? r.models : [];
    return arr.map((m) => ({
      modelId: m.modelId,
      displayLabel: m.displayLabel || m.modelId,
      isActive: !!m.isActive,
      isDefault: !!m.isDefault,
      contextLimit: m.contextLimit ?? null,
    }));
  }

  // Handshake-only probe: spawn, initialize, close. No persistent host.
  async test(settings) {
    const s = settings || {};
    const bin = this.museBin ? { path: this.museBin, source: 'test' } : findServeBinary(s.cliPath);
    if (bin.source === 'not-found') return { ok: false, error: 'CLI_NOT_FOUND' };
    if (!this.museBin && /\.(cmd|bat|ps1|sh)$/i.test(bin.path)) {
      return { ok: false, error: 'SERVE_NEEDS_EXE', resolvedPath: bin.path, source: bin.source };
    }
    let stderrTail = '';
    const onStderr = (c) => {
      stderrTail = `${stderrTail}${String(c)}`.slice(-2000);
    };
    let spawned;
    let sessionMcp = true;
    try {
      spawned = await this._handshake(bin, undefined, FULL_CAPS, onStderr);
    } catch (firstErr) {
      try {
        spawned = await this._handshake(bin, undefined, BASE_CAPS, onStderr);
        sessionMcp = false;
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err), stderrTail, resolvedPath: bin.path, source: bin.source };
      }
    }
    const info = spawned.initializeResult || {};
    const server = info.serverInfo || {};
    const warning = spawned.fingerprintWarning || null;
    await spawned.close().catch(() => {});
    return {
      ok: true,
      resolvedPath: bin.path,
      source: bin.source,
      server: { name: server.name || null, version: server.version || null },
      fingerprintWarning: warning ? String(warning.message || warning.kind || 'mismatch') : null,
      sessionMcp,
    };
  }

  async shutdown() {
    const hosts = [...this.hosts.values()];
    this.hosts.clear();
    this.threads.clear();
    for (const [, p] of this.pendingApprovals) {
      try {
        p.reject(new Error('SHUTDOWN'));
      } catch {
        /* ignore */
      }
    }
    this.pendingApprovals.clear();
    this.pendingUserInputs.clear();
    for (const h of hosts) {
      try {
        await h.spawned.close();
      } catch {
        /* best effort */
      }
    }
  }
}

module.exports = { MspEngine };
