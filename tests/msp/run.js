'use strict';
// MspEngine verification against the mock host. Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MspEngine } = require('../../electron/msp');

const mockHost = path.join(__dirname, 'mock-host.js');
const capsFile = path.join(os.tmpdir(), `musician-test-caps-${process.pid}.json`);
process.env.MUSICIAN_TEST_CAPS_FILE = capsFile;
const events = [];
process.env.MUSICIAN_TEST_BROWSER_CONFIG = '1';
const engine = new MspEngine({
  send: (ch, p) => events.push({ ch, p }),
  version: '0.3.0-test',
  museBin: process.execPath,
  serveArgs: [mockHost],
  getSessionConfig: async () => ({ mcpServers: { 'musician-browser': { transport: 'stdio', command: 'node', args: ['browser-mcp/server.js'] } } }),
});

const withTimeout = (p, ms, what) => {
  let timer;
  return Promise.race([p, new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`TIMEOUT:${what}`)), ms);
  })]).finally(() => clearTimeout(timer));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. handshake-only probe
  const t = await withTimeout(engine.test({}), 15000, 'test');
  assert.equal(t.ok, true, `test ok: ${JSON.stringify(t)}`);
  assert.equal(t.server.name, 'mock-muse');
  assert.equal(t.fingerprintWarning, null);
  assert.equal(t.sessionMcp, true, `probe sessionMcp: ${JSON.stringify(t)}`);
  console.log('ok - handshake probe');

  // 2. session list
  const sessions = await withTimeout(engine.listSessions(process.cwd(), {}), 15000, 'listSessions');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, 'sess-mock-1');
  assert.equal(sessions[0].title, 'Mock 세션');
  console.log('ok - session/list');

  // 3. subscription usage
  const usage = await withTimeout(engine.readUsage(process.cwd(), {}), 15000, 'readUsage');
  assert.equal(usage.tier, 'mock-pro');
  assert.equal(usage.window.usedPercent, 12.5);
  assert.equal(usage.weekly.usedPercent, 3.1);
  console.log('ok - usage/read');

  // 4. models
  const models = await withTimeout(engine.listModels(process.cwd(), {}), 15000, 'listModels');
  assert.equal(models.length, 1);
  assert.equal(models[0].modelId, 'mock-model');
  console.log('ok - model/list');

  // 5. turn with approval round trip
  const items = [];
  let doneRes = null;
  let doneResolve;
  const doneP = new Promise((r) => {
    doneResolve = r;
  });
  const ack = await withTimeout(
    engine.sendTurn('thread-1', '안녕', {
      cwd: process.cwd(),
      settings: {},
      onItem: (e) => items.push(e),
      onDone: (r) => {
        doneRes = r;
        doneResolve();
      },
    }),
    15000,
    'sendTurn-ack',
  );
  assert.equal(ack.mspSessionId, 'sess-mock-1');
  assert.ok(ack.turnId, 'turnId present');

  let apprEv = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    apprEv = events.find((ev) => ev.ch === 'msp:approval');
    if (apprEv) break;
    await sleep(50);
  }
  assert.ok(apprEv, 'approval requested');
  assert.equal(apprEv.p.threadKey, 'thread-1');
  assert.equal(apprEv.p.approval.toolName, 'shell');
  assert.equal(apprEv.p.approval.subject.command, 'dir');
  assert.equal(apprEv.p.approval.choices.length, 2);
  assert.equal(engine.decideApproval(apprEv.p.key, 'allow-once'), true);
  assert.equal(engine.decideApproval(apprEv.p.key, 'allow-once'), false);
  await withTimeout(doneP, 10000, 'turn-done');
  assert.equal(doneRes.outcome.kind, 'completed');
  assert.equal(doneRes.outcome.terminal, 'completed');
  assert.equal(doneRes.outcome.usage.outputTokens, 22);
  assert.ok(items.length >= 2, `items streamed: ${items.length}`);
  assert.ok(
    items.some((e) => e.item.kind === 'agentMessage' && String(e.item.text || '').includes('mock 응답')),
    'final text streamed',
  );
  const tokEv = events.find((ev) => ev.ch === 'msp:tokens');
  assert.ok(tokEv && tokEv.p.usage.inputTokens === 11, 'tokenUsage event');
  const useEv = events.find((ev) => ev.ch === 'msp:usage');
  assert.ok(useEv && useEv.p.usage.tier === 'mock-pro', 'usage event');
  const resEv = events.find((ev) => ev.ch === 'msp:approval-resolved');
  assert.ok(resEv && resEv.p.approvalId === 'appr-1', 'approval-resolved event');
  console.log('ok - turn + approval + tokens + usage events');

  // 6. resume thread from host session
  const resumed = await withTimeout(engine.resumeThread('thread-2', 'sess-mock-1', process.cwd(), {}), 15000, 'resume');
  assert.equal(resumed.mspSessionId, 'sess-mock-1');
  assert.deepEqual(resumed.messages, [
    { role: 'user', text: '이전 질문' },
    { role: 'assistant', text: '이전 답변' },
  ]);
  console.log('ok - session/resume');

  // 7. server-requested structured user input round trip.
  const liveHost = engine.threads.get('thread-2').host;
  await engine._onServerRequest(liveHost, {
    method: 'userInput/request',
    params: {
      sessionId: 'sess-mock-1',
      userInputId: 'input-mock-1',
      toolName: 'ask_user',
      questions: [{
        id: 'language',
        header: '언어',
        question: '어떤 언어로 작성할까요?',
        options: [{ label: '한국어' }, { label: '영어' }],
        selection: { mode: 'single' },
      }],
    },
  });
  const inputEv = events.find((ev) => ev.ch === 'msp:user-input');
  assert.ok(inputEv, 'user input prompt delivered to renderer');
  assert.equal(inputEv.p.threadKey, 'thread-2');
  assert.equal(inputEv.p.questions[0].selection.mode, 'single');
  const answerResult = await withTimeout(engine.answerUserInput(inputEv.p.key, [{ questionId: 'language', selectedLabel: '한국어' }]), 15000, 'userInput-answer');
  assert.equal(answerResult.ok, true);
  assert.equal(answerResult.status, 'accepted');
  assert.ok(events.some((ev) => ev.ch === 'msp:user-input-settled' && ev.p.userInputId === 'input-mock-1'));
  console.log('ok - userInput/request + answer');

  await engine._onServerRequest(liveHost, {
    method: 'userInput/request',
    params: {
      sessionId: 'sess-mock-1',
      userInputId: 'input-mock-2',
      toolName: 'ask_user',
      questions: [{ id: 'confirm', header: '확인', question: '계속 진행할까요?', options: [{ label: '네' }], selection: { mode: 'single' } }],
    },
  });
  const cancelPrompt = events.find((ev) => ev.ch === 'msp:user-input' && ev.p.userInputId === 'input-mock-2');
  assert.ok(cancelPrompt, 'second user input prompt delivered');
  const cancelResult = await withTimeout(engine.cancelUserInput(cancelPrompt.p.key), 15000, 'userInput-cancel');
  assert.equal(cancelResult.ok, true);
  assert.equal(cancelResult.status, 'accepted');
  console.log('ok - userInput/cancel');

  // 8. cancel + setters on live thread
  assert.equal(await withTimeout(engine.cancelTurn('thread-2'), 15000, 'cancel'), true);
  assert.equal(await withTimeout(engine.setModel('thread-2', 'mock-model'), 15000, 'setModel'), true);
  assert.equal(await withTimeout(engine.setApprovalMode('thread-2', 'promptUnmatched'), 15000, 'setApprovalMode'), true);
  assert.equal(await withTimeout(engine.setReasoningEffort('thread-2', 'high'), 15000, 'setReasoningEffort'), true);
  console.log('ok - cancel/setModel/setApprovalMode');

  // 9. sessionMcp capability requested at handshake.
  const caps = JSON.parse(fs.readFileSync(capsFile, 'utf8'));
  assert.ok(caps.includes('sessionMcp'), `handshake caps: ${JSON.stringify(caps)}`);
  console.log('ok - sessionMcp capability requested');

  // 10. legacy host without session MCP: chat works, browser config fails loudly.
  const legacyEvents = [];
  const legacyEngine = new MspEngine({
    send: (ch, p) => legacyEvents.push({ ch, p }),
    version: '0.3.0-test',
    museBin: process.execPath,
    serveArgs: [mockHost, '--legacy'],
    getSessionConfig: async () => ({ mcpServers: { 'musician-browser': { transport: 'stdio', command: 'node', args: ['browser-mcp/server.js'] } } }),
  });
  const legacyProbe = await withTimeout(legacyEngine.test({}), 15000, 'legacy-test');
  assert.equal(legacyProbe.ok, true, `legacy probe ok: ${JSON.stringify(legacyProbe)}`);
  assert.equal(legacyProbe.sessionMcp, false);
  await assert.rejects(
    withTimeout(legacyEngine.sendTurn('legacy-1', 'hi', {
      cwd: process.cwd(),
      settings: {},
      onItem: () => {},
      onDone: () => {},
    }), 15000, 'legacy-turn-config'),
    /CLI_NO_SESSION_MCP/,
  );
  assert.ok(legacyEvents.some((ev) => ev.ch === 'msp:mcp-unavailable'), 'mcp-unavailable event');
  // Plain chat on the same degraded host still works (separate engine without
  // the browser-config assertion env so the mock accepts config-less start).
  delete process.env.MUSICIAN_TEST_BROWSER_CONFIG;
  const plainEvents = [];
  const plainEngine = new MspEngine({
    send: (ch, p) => plainEvents.push({ ch, p }),
    version: '0.3.0-test',
    museBin: process.execPath,
    serveArgs: [mockHost, '--legacy'],
    getSessionConfig: async () => undefined,
  });
  let plainDone;
  const plainDoneP = new Promise((r) => {
    plainDone = r;
  });
  const plainAck = await withTimeout(
    plainEngine.sendTurn('legacy-2', 'hi', {
      cwd: process.cwd(),
      settings: {},
      onItem: () => {},
      onDone: (r) => plainDone(r),
    }),
    15000,
    'legacy-turn-plain',
  );
  assert.equal(plainAck.mspSessionId, 'sess-mock-1');
  const lt0 = Date.now();
  let legacyAppr = null;
  while (Date.now() - lt0 < 10000) {
    legacyAppr = plainEvents.find((ev) => ev.ch === 'msp:approval');
    if (legacyAppr) break;
    await sleep(50);
  }
  assert.ok(legacyAppr, 'legacy plain-turn approval requested');
  assert.equal(plainEngine.decideApproval(legacyAppr.p.key, 'allow-once'), true);
  const plainRes = await withTimeout(plainDoneP, 10000, 'legacy-turn-done');
  assert.equal(plainRes.outcome.kind, 'completed');
  console.log('ok - legacy host fallback + CLI_NO_SESSION_MCP');
  await withTimeout(legacyEngine.shutdown(), 30000, 'legacy-shutdown');
  await withTimeout(plainEngine.shutdown(), 30000, 'plain-shutdown');

  // 11. same-host MCP config conflict: idle host bounces and retries once,
  // busy host fails loud without bouncing.
  process.env.MUSICIAN_TEST_BROWSER_CONFIG = '1';
  const bounceEvents = [];
  const cfgA = () => ({ mcpServers: { 'musician-browser': { transport: 'stdio', command: 'node', args: ['browser-mcp/server.js'] } } });
  const cfgB = () => ({ mcpServers: { 'musician-browser': { transport: 'stdio', command: 'node', args: ['browser-mcp/server.js', '--v2'] } } });
  const bounceEngine = new MspEngine({
    send: (ch, p) => bounceEvents.push({ ch, p }),
    version: '0.3.0-test',
    museBin: process.execPath,
    serveArgs: [mockHost],
    getSessionConfig: cfgA,
  });
  const decideFirstApproval = async (arr, eng) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const ev = arr.find((e) => e.ch === 'msp:approval' && !e.used);
      if (ev) {
        ev.used = true;
        assert.equal(eng.decideApproval(ev.p.key, 'allow-once'), true);
        return;
      }
      await sleep(50);
    }
    assert.fail('approval not requested');
  };
  let b1Done;
  const b1P = new Promise((r) => {
    b1Done = r;
  });
  const b1Ack = await withTimeout(bounceEngine.sendTurn('bounce-1', 'hi', {
    cwd: process.cwd(), settings: {}, onItem: () => {}, onDone: (r) => b1Done(r),
  }), 15000, 'bounce-turn1');
  assert.equal(b1Ack.mspSessionId, 'sess-mock-1');
  await decideFirstApproval(bounceEvents, bounceEngine);
  const b1Res = await withTimeout(b1P, 10000, 'bounce-turn1-done');
  assert.equal(b1Res.outcome.kind, 'completed');
  bounceEngine.getSessionConfig = cfgB;
  const bounced = await withTimeout(bounceEngine.resumeThread('bounce-1', b1Ack.mspSessionId, process.cwd(), {}), 30000, 'bounce-resume');
  assert.equal(bounced.mspSessionId, 'sess-mock-1');
  assert.equal(bounceEvents.filter((e) => e.ch === 'msp:host-bounced').length, 1);
  assert.deepEqual(bounced.messages, [
    { role: 'user', text: '이전 질문' },
    { role: 'assistant', text: '이전 답변' },
  ]);
  let b2Done;
  const b2P = new Promise((r) => {
    b2Done = r;
  });
  const b2Ack = await withTimeout(bounceEngine.sendTurn('bounce-2', 'hi', {
    cwd: process.cwd(), settings: {}, onItem: () => {}, onDone: (r) => b2Done(r),
  }), 15000, 'bounce-turn2');
  assert.equal(b2Ack.mspSessionId, 'sess-mock-1');
  bounceEngine.getSessionConfig = cfgA;
  await assert.rejects(
    withTimeout(bounceEngine.resumeThread('bounce-1', b1Ack.mspSessionId, process.cwd(), {}), 15000, 'bounce-resume-busy'),
    /CLI_MCP_CONFIG_CONFLICT/,
  );
  assert.equal(bounceEvents.filter((e) => e.ch === 'msp:host-bounced').length, 1, 'no second bounce');
  await decideFirstApproval(bounceEvents, bounceEngine);
  const b2Res = await withTimeout(b2P, 10000, 'bounce-turn2-done');
  assert.equal(b2Res.outcome.kind, 'completed');
  console.log('ok - MCP config conflict bounce + busy error');
  await withTimeout(bounceEngine.shutdown(), 30000, 'bounce-shutdown');

  // 12. pre-flight runs before session construction: unhealthy servers emit
  // msp:mcp-health and ride the ack, but the (optional) session still starts.
  const healthEvents = [];
  const seenConfigs = [];
  const healthEngine = new MspEngine({
    send: (ch, p) => healthEvents.push({ ch, p }),
    version: '0.3.0-test',
    museBin: process.execPath,
    serveArgs: [mockHost],
    getSessionConfig: async () => ({ mcpServers: { 'musician-browser': { transport: 'stdio', command: 'node', args: ['browser-mcp/server.js'] } } }),
    preflightSessionConfig: async (config) => {
      seenConfigs.push(config);
      return [{ name: 'musician-browser', ok: false, reason: 'BRIDGE_FILE_MISSING:test' }];
    },
  });
  let hDone;
  const hP = new Promise((r) => {
    hDone = r;
  });
  const healthAck = await withTimeout(healthEngine.sendTurn('health-1', 'hi', {
    cwd: process.cwd(), settings: {}, onItem: () => {}, onDone: (r) => hDone(r),
  }), 15000, 'health-turn');
  assert.equal(healthAck.mspSessionId, 'sess-mock-1');
  assert.deepEqual(healthAck.mcpHealth, [{ name: 'musician-browser', ok: false, reason: 'BRIDGE_FILE_MISSING:test' }]);
  assert.equal(seenConfigs.length, 1);
  const healthEv = healthEvents.find((e) => e.ch === 'msp:mcp-health');
  assert.ok(healthEv, 'msp:mcp-health event');
  assert.deepEqual(healthEv.p.health, healthAck.mcpHealth);
  await decideFirstApproval(healthEvents, healthEngine);
  const hRes = await withTimeout(hP, 10000, 'health-turn-done');
  assert.equal(hRes.outcome.kind, 'completed');
  console.log('ok - MCP pre-flight health event + ack');
  await withTimeout(healthEngine.shutdown(), 30000, 'health-shutdown');

  await withTimeout(engine.shutdown(), 30000, 'shutdown');
  try {
    fs.unlinkSync(capsFile);
  } catch {
    /* best effort */
  }
  console.log('MSP MOCK TEST: ALL PASS');
})().catch((e) => {
  console.error('MSP MOCK TEST: FAIL', e);
  engine.shutdown().catch(() => {});
  process.exitCode = 1;
});
