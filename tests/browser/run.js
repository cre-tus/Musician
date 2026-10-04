'use strict';
// Browser bridge + MCP verification with a fake driver (no Electron).
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { createBridgeServer, BrowserEngine, staleRefError, shouldReportLoadFailure, handleFoundInPage } = require('../../electron/browser');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function fakeDriver() {
  const tabs = new Map([
    ['tab-1', { url: 'about:blank' }],
    ['tab-2', { url: 'about:blank' }],
  ]);
  let active = 'tab-1';
  const cur = () => tabs.get(active);
  const rec = { clicked: null, typed: null };
  return {
    __rec: rec,
    async navigate(url) {
      cur().url = String(url);
      return { ok: true, url: cur().url, title: 'Fake', timedOut: false };
    },
    async back() {
      return { ok: true, url: cur().url };
    },
    async forward() {
      return { ok: true, url: cur().url };
    },
    async reload() {
      return { ok: true };
    },
    async stop() {
      return { ok: true };
    },
    async state() {
      return { ok: true, tabId: active, hasView: true, attached: true, url: cur().url, title: 'Fake', loading: false, canGoBack: false, canGoForward: false, agentEnabled: true };
    },
    async snapshot() {
      return { ok: true, url: cur().url, title: 'Fake', count: 1, elements: [{ ref: 1, role: 'button', name: '확인', x: 10, y: 20, w: 60, h: 24 }] };
    },
    async text() {
      return { ok: true, url: cur().url, title: 'Fake', length: 6, text: '가짜 본문' };
    },
    async source() {
      const html = '<html><body>가짜 본문</body></html>';
      return { ok: true, url: cur().url, length: html.length, truncated: false, html };
    },
    async screenshot() {
      return { ok: true, mime: 'image/png', base64: PNG_1PX, bytes: 70 };
    },
    async click(p) {
      rec.clicked = { ...p };
      if (p.ref !== 1 && p.x == null) throw new Error('NOT_FOUND');
      return { ok: true, x: 40, y: 32 };
    },
    async type(p) {
      rec.typed = { ...p };
      if (p.ref !== 1) throw new Error(p.ref == null ? 'NOT_FOUND' : 'NOT_EDITABLE');
      return { ok: true, valueLength: String(p.text).length };
    },
    async press(p) {
      return { ok: true, key: p.key || 'Enter' };
    },
    async wait(p) {
      if (p.urlContains && !cur().url.includes(p.urlContains)) return { ok: false, error: 'WAIT_TIMEOUT', url: cur().url, waitedMs: 1 };
      return { ok: true, url: cur().url, waitedMs: 1 };
    },
    async tabs() {
      return { ok: true, tabs: [...tabs.entries()].map(([tabId, t]) => ({ tabId, active: tabId === active, attached: tabId === active, url: t.url, loading: false })) };
    },
    async switchTab(id) {
      if (!tabs.has(id)) throw new Error('NO_SUCH_TAB');
      active = id;
      return { ok: true, tabId: id };
    },
  };
}

function postRpc(port, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT:${what}`)), ms))]);

(async () => {
  const engine = new BrowserEngine({ getWindow: () => null, send: () => {}, userDataDir: os.tmpdir() });
  const wc = new (require('node:events').EventEmitter)();
  Object.assign(wc, {
    isDestroyed: () => false, getURL: () => 'https://example.org', getTitle: () => 'Existing tab',
    isLoading: () => false, navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    loadURL: async () => { wc.emit('did-finish-load'); },
  });
  engine.views.set('existing', { view: { webContents: wc } });
  engine.activeTabId = 'existing';
  assert.equal((await engine.driver().state()).title, 'Existing tab');
  assert.equal((await engine.driver().navigate('https://example.org')).title, 'Existing tab');
  assert.equal(engine.views.size, 1, 'navigation reuses the existing view');
  console.log('ok - real driver reuses tab and accepts synchronous Electron title');

  // 1b. driverFor pins one call to a tab without switching the active tab.
  const wc2 = new (require('node:events').EventEmitter)();
  Object.assign(wc2, {
    isDestroyed: () => false, getURL: () => 'https://second.example', getTitle: () => 'Second tab',
    isLoading: () => false, navigationHistory: { canGoBack: () => true, canGoForward: () => false },
  });
  engine.views.set('second', { view: { webContents: wc2 } });
  assert.equal((await engine.driverFor('second').state()).tabId, 'second');
  assert.equal((await engine.driverFor('second').state()).title, 'Second tab');
  assert.equal(engine.activeTabId, 'existing', 'pinned call does not switch tabs');
  assert.equal((await engine.driver().state()).tabId, 'existing');
  await assert.rejects(engine.driverFor('tab-nope').back(), /NO_SUCH_TAB:tab-nope/);
  assert.equal(engine.views.size, 2, 'unknown pinned tab creates no view');
  const ghost = await engine.driverFor('tab-nope').state();
  assert.equal(ghost.hasView, false, 'pinned state query stays lenient');
  assert.equal(engine.views.size, 2);
  console.log('ok - real driverFor pins one call without switching');

  // 1c. stale refs fail with a fix, not a bare code.
  assert.equal(staleRefError('CLICK_FAILED', { ok: false, error: 'NOT_FOUND' }, 3), 'AX_REF_STALE:3 — take a fresh browser_snapshot and use a new ref');
  assert.equal(staleRefError('TYPE_FAILED', { ok: false, error: 'NOT_EDITABLE' }, 7), 'NOT_EDITABLE:7 — the element is not editable');
  assert.equal(staleRefError('CLICK_FAILED', { ok: false, error: 'BOOM' }, 1), 'BOOM');
  assert.equal(staleRefError('CLICK_FAILED', null, null), 'CLICK_FAILED');
  console.log('ok - stale ref errors point at snapshot');

  // 1d. agent switchTab re-attaching the visible view emits a renderer sync event.
  const syncEvents = [];
  const fakeWin = { isDestroyed: () => false, contentView: { addChildView() {}, removeChildView() {} } };
  const engine2 = new BrowserEngine({ getWindow: () => fakeWin, send: (ch, ev) => syncEvents.push({ ch, ev }), userDataDir: os.tmpdir() });
  const mkView = () => ({ setBounds() {}, webContents: { isDestroyed: () => false } });
  engine2.views.set('a', { view: mkView() });
  engine2.views.set('b', { view: mkView() });
  engine2.attachedTabId = 'a';
  engine2.activeTabId = 'a';
  assert.equal(engine2.switchTab('b').ok, true);
  assert.equal(engine2.attachedTabId, 'b');
  assert.deepEqual(syncEvents, [{ ch: 'browser:event', ev: { type: 'agent-switch', tabId: 'b' } }]);
  assert.equal(engine2.switchTab('b').ok, true);
  assert.equal(syncEvents.length, 1, 'switching to the shown tab emits nothing');
  engine2.attachedTabId = null; // user is in the editor: no visible change
  assert.equal(engine2.switchTab('a').ok, true);
  assert.equal(engine2.activeTabId, 'a');
  assert.equal(syncEvents.length, 1, 'hidden switch emits nothing');
  console.log('ok - agent switchTab syncs the renderer');

  // 1e. click/type/press use trusted OS-level input when available.
  const inputEvents = [];
  const jsCalls = [];
  const stubWc = {
    isDestroyed: () => false,
    executeJavaScript: async (src) => {
      jsCalls.push(src);
      if (src.includes('MX-POINT')) {
        if (src.includes('"ref":7')) return { ok: false, error: 'NOT_FOUND' };
        return { ok: true, x: 100, y: 50 };
      }
      if (src.includes('MX-FOCUS')) {
        if (src.includes('"ref":9')) return { ok: false, error: 'NOT_EDITABLE' };
        return { ok: true };
      }
      return { ok: true, x: 40, y: 32 }; // legacy scripts
    },
    sendInputEvent: (ev) => inputEvents.push(ev),
  };
  const engine3 = new BrowserEngine({ getWindow: () => null, send: () => {}, userDataDir: os.tmpdir() });
  engine3.views.set('in', { view: { webContents: stubWc } });
  engine3.activeTabId = 'in';
  const ind = engine3.driver();
  const rc = await ind.click({ x: 10, y: 20 });
  assert.equal(rc.ok, true);
  assert.deepEqual(inputEvents.map((e) => e.type), ['mouseMove', 'mouseDown', 'mouseUp']);
  assert.equal(inputEvents[1].button, 'left');
  await assert.rejects(ind.click({ ref: 7 }), /AX_REF_STALE:7/);
  inputEvents.length = 0;
  const rt = await ind.type({ ref: 1, text: 'hi', submit: true });
  assert.equal(rt.valueLength, 2);
  assert.deepEqual(inputEvents.map((e) => e.type), ['char', 'char', 'keyDown', 'keyUp']);
  assert.equal(inputEvents[0].keyCode, 'h');
  assert.equal(inputEvents[2].keyCode, 'Enter');
  await assert.rejects(ind.type({ ref: 9, text: 'x' }), /NOT_EDITABLE:9/);
  inputEvents.length = 0;
  const rp = await ind.press({ key: 'Escape' });
  assert.equal(rp.key, 'Escape');
  assert.deepEqual(inputEvents, [{ type: 'keyDown', keyCode: 'Escape' }, { type: 'keyUp', keyCode: 'Escape' }]);
  inputEvents.length = 0;
  jsCalls.length = 0;
  await ind.press({ key: 'Frobnicator' });
  assert.equal(inputEvents.length, 0, 'unknown keys skip trusted input');
  assert.ok(jsCalls.some((s) => !s.includes('MX-')), 'legacy press script used');
  inputEvents.length = 0;
  await ind.type({ ref: 1, text: 'z'.repeat(20001) });
  assert.equal(inputEvents.length, 0, 'huge text uses the fast legacy path');
  const legacyWc = { isDestroyed: () => false, executeJavaScript: stubWc.executeJavaScript };
  engine3.views.set('legacy', { view: { webContents: legacyWc } });
  const rl2 = await engine3.driverFor('legacy').click({ ref: 1 });
  assert.equal(rl2.ok, true);
  console.log('ok - trusted input with legacy fallback');

  // 1f. load-failure filter: subframe errors and ERR_ABORTED stay silent,
  // real main-frame errors still surface (kills the phantom -3 toast).
  assert.equal(typeof shouldReportLoadFailure, 'function');
  assert.equal(shouldReportLoadFailure(-3, true), false, 'aborted main frame is benign');
  assert.equal(shouldReportLoadFailure(-3, false), false);
  assert.equal(shouldReportLoadFailure(-6, false), false, 'subframe failure is page-internal');
  assert.equal(shouldReportLoadFailure(-105, false), false);
  assert.equal(shouldReportLoadFailure(-6, true), true, 'real main-frame error surfaces');
  assert.equal(shouldReportLoadFailure(-105, true), true);
  assert.equal(shouldReportLoadFailure(-6, undefined), true, 'missing frame flag keeps legacy behavior');
  console.log('ok - load-failure filter silences phantom toasts');

  // 1g. navigate() waits past subframe failures and aborts; only a real
  // main-frame failure rejects the navigation.
  const { EventEmitter } = require('node:events');
  const navWc = new EventEmitter();
  let navScript = [];
  navWc.isDestroyed = () => false;
  navWc.getURL = () => 'https://example.com/';
  navWc.getTitle = () => 'Example';
  navWc.loadURL = async () => {
    for (const [ev, ...args] of navScript) process.nextTick(() => navWc.emit(ev, {}, ...args));
  };
  const engine4 = new BrowserEngine({ getWindow: () => null, send: () => {}, userDataDir: os.tmpdir() });
  engine4.views.set('nav', { view: { webContents: navWc } });
  navScript = [['did-fail-load', -6, 'ERR_FILE_NOT_FOUND', 'http://127.0.0.1:9/x', false], ['did-finish-load']];
  assert.equal((await engine4.driverFor('nav').navigate('https://example.com/', 5000)).ok, true, 'subframe failure ignored');
  navScript = [['did-fail-load', -3, 'ERR_ABORTED', 'https://example.com/', true], ['did-finish-load']];
  assert.equal((await engine4.driverFor('nav').navigate('https://example.com/', 5000)).ok, true, 'abort ignored');
  navScript = [['did-fail-load', -105, 'ERR_NAME_NOT_RESOLVED', 'https://nope.invalid/', true]];
  const badNav = await engine4.driverFor('nav').navigate('https://nope.invalid/', 5000);
  assert.equal(badNav.ok, false, 'main-frame failure rejects');
  assert.equal(badNav.code, -105);
  console.log('ok - navigate rides out phantom failures');

  // 1h. loadURL itself rejecting with ERR_ABORTED (superseded/stopped
  // navigation) soft-fails with aborted:true instead of throwing — the
  // UI stays silent, agents still see ok:false. Other rejections throw.
  const abortWc = new EventEmitter();
  abortWc.isDestroyed = () => false;
  abortWc.getURL = () => 'https://example.com/';
  abortWc.getTitle = () => 'Example';
  abortWc.loadURL = async () => { throw new Error('ERR_ABORTED (-3) loading \'https://example.com/\''); };
  const engine5 = new BrowserEngine({ getWindow: () => null, send: () => {}, userDataDir: os.tmpdir() });
  engine5.views.set('abort', { view: { webContents: abortWc } });
  const soft = await engine5.driverFor('abort').navigate('https://example.com/', 1000);
  assert.equal(soft.ok, false, 'aborted load is not ok');
  assert.equal(soft.aborted, true, 'aborted flag set');
  assert.equal(soft.code, -3);
  const failWc = new EventEmitter();
  failWc.isDestroyed = () => false;
  failWc.getURL = () => 'https://example.com/';
  failWc.getTitle = () => 'Example';
  failWc.loadURL = async () => { throw new Error('ERR_CONNECTION_REFUSED'); };
  const engine6 = new BrowserEngine({ getWindow: () => null, send: () => {}, userDataDir: os.tmpdir() });
  engine6.views.set('fail', { view: { webContents: failWc } });
  await assert.rejects(() => engine6.driverFor('fail').navigate('https://example.com/', 1000), /ERR_CONNECTION_REFUSED/);
  console.log('ok - aborted loadURL soft-fails, real errors throw');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-browser-test-'));
  const connPath = path.join(tmp, 'browser-bridge.json');
  const agentCalls = [];
  let enabled = true;

  // 1. bridge lifecycle + connection file
  const bridge = createBridgeServer({
    driver: fakeDriver(),
    isEnabled: () => enabled,
    onAgentAction: (method, params) => agentCalls.push({ method, params }),
    connectionPath: connPath,
  });
  const { port, token } = await withTimeout(bridge.start(), 10000, 'bridge-start');
  assert.ok(port > 0, 'ephemeral port');
  assert.ok(token && token.length >= 32, 'random token');
  const conn = JSON.parse(fs.readFileSync(connPath, 'utf8'));
  assert.equal(conn.port, port);
  assert.equal(conn.token, token);
  assert.equal(conn.pid, process.pid);
  console.log('ok - bridge start + connection file');

  // 2. auth: bad token rejected, unknown path/method handled
  const bad = await withTimeout(postRpc(port, { token: 'nope', method: 'state', params: {} }), 10000, 'bad-token');
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'BAD_TOKEN');
  const unknown = await withTimeout(postRpc(port, { token, method: 'nope', params: {} }), 10000, 'unknown-method');
  assert.equal(unknown.body.ok, false);
  assert.match(unknown.body.error, /^UNKNOWN_METHOD:/);
  console.log('ok - bridge auth + unknown method');

  // 3. full driver round trip through the bridge
  const call = async (method, params) => {
    const r = await withTimeout(postRpc(port, { token, method, params: params || {} }), 10000, method);
    assert.equal(r.body.ok, true, `${method}: ${JSON.stringify(r.body)}`);
    return r.body.result;
  };
  const nav = await call('navigate', { url: 'example.com' });
  assert.equal(nav.url, 'https://example.com', 'scheme defaulted to https');
  const st = await call('state', {});
  assert.equal(st.url, 'https://example.com');
  const snap = await call('snapshot', { max: 50 });
  assert.equal(snap.elements.length, 1);
  assert.equal(snap.elements[0].name, '확인');
  const txt = await call('text', {});
  assert.match(txt.text, /가짜 본문/);
  const src = await call('source', {});
  assert.match(src.html, /<html>/);
  assert.equal(src.truncated, false);
  const shot = await call('screenshot', {});
  assert.equal(shot.mime, 'image/png');
  assert.equal(shot.base64, PNG_1PX);
  const clicked = await call('click', { ref: 1 });
  assert.equal(clicked.ok, true);
  const typed = await call('type', { ref: 1, text: '안녕', submit: true });
  assert.equal(typed.valueLength, 2);
  const pressed = await call('press', { key: 'Escape' });
  assert.equal(pressed.key, 'Escape');
  const waited = await call('wait', { urlContains: 'example' });
  assert.equal(waited.ok, true);
  const back = await call('back', {});
  assert.equal(back.ok, true);
  const tabList = await call('tabs', {});
  assert.equal(tabList.tabs.length, 2);
  assert.equal(tabList.tabs[0].active, true);
  const sw = await call('switchTab', { tabId: 'tab-2' });
  assert.equal(sw.tabId, 'tab-2');
  const st2 = await call('state', {});
  assert.equal(st2.tabId, 'tab-2');
  assert.equal(st2.url, 'about:blank', 'tabs keep separate pages');
  const bad2 = await withTimeout(postRpc(port, { token, method: 'switchTab', params: { tabId: 'tab-9' } }), 10000, 'switch-missing');
  assert.equal(bad2.body.ok, false);
  assert.equal(bad2.body.error, 'NO_SUCH_TAB');
  assert.ok(agentCalls.length >= 10, `agent actions reported: ${agentCalls.length}`);
  assert.equal(agentCalls[0].method, 'navigate');
  console.log('ok - bridge driver round trip + agent events');

  // 3b. bridge forwards per-call tabId; the active tab never moves implicitly.
  const connPath3 = path.join(tmp, 'bridge3.json');
  const scopedIds = [];
  const fake3 = fakeDriver();
  const bridge3 = createBridgeServer({
    driver: fake3,
    driverFor: (id) => {
      scopedIds.push(id);
      return fake3;
    },
    isEnabled: () => true,
    connectionPath: connPath3,
  });
  const started3 = await withTimeout(bridge3.start(), 10000, 'bridge3-start');
  const call3 = async (method, params) => {
    const r = await withTimeout(postRpc(started3.port, { token: started3.token, method, params: params || {} }), 10000, method);
    assert.equal(r.body.ok, true, `${method}: ${JSON.stringify(r.body)}`);
    return r.body.result;
  };
  await call3('state', { tabId: 'tab-2' });
  await call3('click', { ref: 1, tabId: 'tab-2' });
  assert.deepEqual(scopedIds, ['tab-2', 'tab-2']);
  await call3('state', {});
  assert.deepEqual(scopedIds, ['tab-2', 'tab-2'], 'omitted tabId uses the default driver');
  const tabs3 = await call3('tabs', {});
  assert.equal(tabs3.tabs.find((t) => t.active).tabId, 'tab-1', 'pinned calls do not switch tabs');
  await withTimeout(bridge3.stop(), 10000, 'bridge3-stop');
  console.log('ok - bridge forwards per-call tabId');

  // 4. disabled mode + driver errors surface as ok:false
  enabled = false;
  const dis = await withTimeout(postRpc(port, { token, method: 'state', params: {} }), 10000, 'disabled');
  assert.equal(dis.body.ok, false);
  assert.equal(dis.body.error, 'AGENT_DISABLED');
  enabled = true;
  const missing = await withTimeout(postRpc(port, { token, method: 'click', params: { ref: 999 } }), 10000, 'click-missing');
  assert.equal(missing.body.ok, false);
  assert.equal(missing.body.error, 'NOT_FOUND');
  console.log('ok - disabled mode + driver error surface');

  await withTimeout(bridge.stop(), 10000, 'bridge-stop');
  assert.equal(fs.existsSync(connPath), false, 'connection file removed on stop');
  console.log('ok - bridge stop cleans up');

  // 5. MCP server end to end over stdio
  const fake2 = fakeDriver();
  const mcpScopedIds = [];
  const bridge2 = createBridgeServer({
    driver: fake2,
    driverFor: (id) => {
      mcpScopedIds.push(id);
      return fake2;
    },
    isEnabled: () => true,
    connectionPath: connPath,
  });
  await withTimeout(bridge2.start(), 10000, 'bridge2-start');
  const server = path.join(__dirname, '..', '..', 'browser-mcp', 'server.js');
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, MUSICIAN_BRIDGE_FILE: connPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rl = readline.createInterface({ input: child.stdout, terminal: false });
  const pending = new Map();
  let seq = 0;
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      seq += 1;
      pending.set(seq, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: seq, method, params: params || {} })}\n`);
    });
  const callTool = async (name, args) => {
    const r = await withTimeout(send('tools/call', { name, arguments: args || {} }), 15000, `mcp-${name}`);
    assert.equal(r.isError, undefined, `${name}: ${JSON.stringify(r)}`);
    return r.content;
  };
  try {
    const init = await withTimeout(send('initialize', { protocolVersion: '2024-11-05' }), 10000, 'mcp-init');
    assert.equal(init.serverInfo.name, 'musician-browser');
    const listed = await withTimeout(send('tools/list', {}), 10000, 'mcp-list');
    const names = listed.tools.map((t) => t.name);
    for (const n of ['browser_navigate', 'browser_snapshot', 'browser_text', 'browser_source', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_press', 'browser_state', 'browser_wait', 'browser_tabs', 'browser_switch_tab']) {
      assert.ok(names.includes(n), `tool listed: ${n}`);
    }
    console.log('ok - mcp initialize + tools/list');
    assert.ok(!names.some((n) => /create|new-tab|close-tab/i.test(n)), 'no tab-creating tools');
    const navTool = listed.tools.find((t) => t.name === 'browser_navigate');
    assert.ok(navTool.inputSchema.properties.tabId, 'navigate accepts tabId');
    const tabsTool = listed.tools.find((t) => t.name === 'browser_tabs');
    assert.ok(!tabsTool.inputSchema.properties.tabId, 'tabs takes no tabId');
    assert.match(tabsTool.description, /reuse/i, 'reuse-first guidance present');
    assert.match(init.instructions || '', /tabId/, 'pin guidance in instructions');
    console.log('ok - mcp tab pinning surface, no tab creation');

    const navContent = await callTool('browser_navigate', { url: 'example.org' });
    assert.match(navContent[0].text, /example\.org/);
    const snapContent = await callTool('browser_snapshot', {});
    assert.match(snapContent[0].text, /확인/);
    const srcContent = await callTool('browser_source', {});
    assert.match(srcContent[0].text, /가짜 본문/);
    const tabsContent = await callTool('browser_tabs', {});
    assert.match(tabsContent[0].text, /tab-1/);
    const swContent = await callTool('browser_switch_tab', { tabId: 'tab-2' });
    assert.match(swContent[0].text, /tab-2/);
    const badSw = await withTimeout(send('tools/call', { name: 'browser_switch_tab', arguments: { tabId: 'tab-9' } }), 10000, 'mcp-switch-missing');
    assert.equal(badSw.isError, true);
    assert.match(badSw.content[0].text, /NO_SUCH_TAB/);
    const shotContent = await callTool('browser_screenshot', {});
    assert.equal(shotContent[0].type, 'image');
    assert.equal(shotContent[0].data, PNG_1PX);
    await callTool('browser_click', { ref: 1 });
    const typeContent = await callTool('browser_type', { ref: 1, text: 'hi' });
    assert.match(typeContent[0].text, /valueLength/);
    const unk = await withTimeout(send('tools/call', { name: 'browser_nope', arguments: {} }), 10000, 'mcp-unknown');
    assert.equal(unk.isError, true);
    console.log('ok - mcp tools/call round trip');

    // 5b. pinned calls reach the bridge; model-boundary coercion; garbage rejected.
    await callTool('browser_state', { tabId: 'tab-1' });
    assert.ok(mcpScopedIds.includes('tab-1'), 'tabId reaches the bridge');
    const stillActive = await callTool('browser_tabs', {});
    assert.match(stillActive[0].text, /"tabId":"tab-2","active":true/, 'pinned call does not switch tabs');
    await callTool('browser_type', { ref: '1', text: 'hi', submit: 'false' });
    assert.equal(fake2.__rec.typed.submit, false, "string 'false' coerces to false");
    assert.equal(fake2.__rec.typed.ref, 1, 'string ref coerces to number');
    await callTool('browser_click', { ref: '1' });
    assert.equal(fake2.__rec.clicked.ref, 1);
    const badSubmit = await withTimeout(send('tools/call', { name: 'browser_type', arguments: { ref: 1, text: 'x', submit: 'maybe' } }), 10000, 'mcp-bad-submit');
    assert.equal(badSubmit.isError, true);
    assert.match(badSubmit.content[0].text, /INVALID_PARAMS:browser_type\.submit/);
    const badRef = await withTimeout(send('tools/call', { name: 'browser_click', arguments: { ref: 'abc' } }), 10000, 'mcp-bad-ref');
    assert.equal(badRef.isError, true);
    assert.match(badRef.content[0].text, /INVALID_PARAMS:browser_click\.ref/);
    const noUrl = await withTimeout(send('tools/call', { name: 'browser_navigate', arguments: {} }), 10000, 'mcp-no-url');
    assert.equal(noUrl.isError, true);
    assert.match(noUrl.content[0].text, /INVALID_PARAMS:browser_navigate\.url/);
    console.log('ok - mcp params coerced + invalid rejected');

    // 6. app not running → honest error, not a hang
    await withTimeout(bridge2.stop(), 10000, 'bridge2-stop');
    assert.equal(fs.existsSync(connPath), false);
    const dead = await withTimeout(send('tools/call', { name: 'browser_state', arguments: {} }), 15000, 'mcp-dead');
    assert.equal(dead.isError, true);
    assert.match(dead.content[0].text, /APP_NOT_RUNNING/);
    console.log('ok - mcp app-not-running error');
  } finally {
    child.kill();
    await withTimeout(bridge2.stop().catch(() => {}), 10000, 'bridge2-stop-2');
  }

  // 7. find fallback: landed-position verification + native state sync.
  {
    const events = [];
    const engine = new BrowserEngine({ getWindow: () => null, send: (_ch, ev) => { events.push(ev); }, userDataDir: tmp, getSettings: () => ({}) });
    const opOf = (code) => {
      const m = String(code).match(/\("([a-z]+)",/);
      return m ? m[1] : '';
    };
    const fakeRec = (script, staleOrdinal) => ({
      view: { webContents: { isDestroyed: () => false, executeJavaScript: (code) => script(opOf(code)) } },
      findQueries: new Map([[7, 'xylophone']]),
      findSettled: new Set(),
      findFallback: { query: 'xylophone', matches: 3, ordinal: staleOrdinal, at: 1000 },
    });
    // 7a. step landing is verified: stale ordinal 2 + cleared selection
    // restarts at match 1, and the answer reports 1 (not arithmetic 3).
    {
      const rec = fakeRec(async (op) => {
        if (op === 'count') return { matches: 3 };
        if (op === 'step') return { found: true };
        if (op === 'where') return { index: 1 };
        return {};
      }, 2);
      await engine.findFallback(rec, 'tab-1', 7, 'xylophone', { forward: true, findNext: true, bornAt: 2000 });
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'find-result');
      assert.equal(events[0].matches, 3);
      assert.equal(events[0].activeMatchOrdinal, 1);
      assert.equal(rec.findFallback.ordinal, 1);
      console.log('ok - find fallback reports the verified landing');
    }
    // 7b. insane landing falls back to arithmetic.
    {
      events.length = 0;
      const rec = fakeRec(async (op) => {
        if (op === 'count') return { matches: 3 };
        if (op === 'step') return { found: true };
        if (op === 'where') return { index: 0 };
        return {};
      }, 2);
      await engine.findFallback(rec, 'tab-1', 7, 'xylophone', { forward: true, findNext: true, bornAt: 2000 });
      assert.equal(events.length, 1);
      assert.equal(events[0].activeMatchOrdinal, 3); // (2 % 3) + 1
      console.log('ok - find fallback keeps arithmetic for insane landings');
    }
    // 7c. native answers refresh fallback state (mixed sequences stay sane).
    {
      events.length = 0;
      const rec = { findQueries: new Map([[9, 'xylophone']]), findSettled: new Set(), findFallback: { query: 'xylophone', matches: 3, ordinal: 1, at: 1000 } };
      handleFoundInPage(rec, (ev) => events.push(ev), { requestId: 9, matches: 3, activeMatchOrdinal: 2, finalUpdate: true });
      assert.equal(events.length, 1);
      assert.equal(events[0].activeMatchOrdinal, 2);
      assert.equal(rec.findFallback.ordinal, 2);
      assert.equal(rec.findFallback.matches, 3);
      rec.findSettled.add(9);
      handleFoundInPage(rec, (ev) => events.push(ev), { requestId: 9, matches: 3, activeMatchOrdinal: 3, finalUpdate: true });
      assert.equal(events.length, 1, 'late native event ignored');
      assert.equal(rec.findFallback.ordinal, 2, 'late native event keeps state');
      console.log('ok - native find answers refresh fallback state');
    }
    // 7d. native selectionArea rides along (null-safe when the engine omits it).
    {
      events.length = 0;
      const area = { x: 11, y: 22, width: 33, height: 44 };
      const rec = { findQueries: new Map([[11, 'xylophone']]), findSettled: new Set(), findFallback: null };
      handleFoundInPage(rec, (ev) => events.push(ev), { requestId: 11, matches: 3, activeMatchOrdinal: 2, finalUpdate: true, selectionArea: area });
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].selectionArea, area);
      const rec2 = { findQueries: new Map([[12, 'xylophone']]), findSettled: new Set(), findFallback: null };
      handleFoundInPage(rec2, (ev) => events.push(ev), { requestId: 12, matches: 3, activeMatchOrdinal: 1, finalUpdate: true });
      assert.equal(events.length, 2);
      assert.equal(events[1].selectionArea, null);
      console.log('ok - native selectionArea rides the find-result event');
    }
    // 7e. fallback answers carry the verified landing rect (null when unknown).
    {
      events.length = 0;
      const area = { x: 5, y: 6, width: 70, height: 18 };
      const rec = fakeRec(async (op) => {
        if (op === 'count') return { matches: 3 };
        if (op === 'first') return { found: true };
        if (op === 'where') return { index: 1, rect: area };
        return {};
      }, 0);
      rec.findFallback = null;
      rec.findQueries = new Map([[7, 'xylophone']]);
      await engine.findFallback(rec, 'tab-1', 7, 'xylophone', { forward: true, findNext: false, bornAt: 2000 });
      assert.equal(events.length, 1);
      assert.equal(events[0].activeMatchOrdinal, 1);
      assert.deepEqual(events[0].selectionArea, area);
      events.length = 0;
      const recB = fakeRec(async (op) => {
        if (op === 'count') return { matches: 3 };
        if (op === 'first') return { found: true };
        if (op === 'where') return { index: 0 };
        return {};
      }, 0);
      recB.findFallback = null;
      recB.findQueries = new Map([[7, 'xylophone']]);
      await engine.findFallback(recB, 'tab-1', 7, 'xylophone', { forward: true, findNext: false, bornAt: 2000 });
      assert.equal(events.length, 1);
      assert.equal(events[0].selectionArea, null);
      console.log('ok - fallback answers carry the verified landing rect');
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('BROWSER MOCK TEST: ALL PASS');
})().catch((e) => {
  console.error('BROWSER MOCK TEST: FAIL', e);
  process.exitCode = 1;
});
