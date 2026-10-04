// Musician shared browser: one WebContentsView per browser tab.
// The user sees the attached tab; CLI agents (via browser-mcp/) drive the
// active tab. Plain JS — no build step.
//
// Security: the bridge binds 127.0.0.1 only, requires a random token
// minted per launch, and can be disabled in settings (browserAgent).
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { browserTabShortcut } = require('./browser-shortcuts');
const { normalizeUrl, resolveAddressInput } = require('./browser-url');
const { resolveBrowserStartUrl } = require('./browser-start-url');

const BRIDGE_FILE = 'browser-bridge.json';
const NAV_TIMEOUT_MS = 30000;

// Navigation allowlist for browser tabs (address bar, agent bridge,
// popups): http(s) pages, local files, and blank pages only. Anything
// else (javascript:, data:, custom protocols) is refused before loadURL.
const NAVIGABLE_BROWSER_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'about:']);
function isNavigableBrowserUrl(target) {
  try {
    return NAVIGABLE_BROWSER_PROTOCOLS.has(new URL(String(target)).protocol);
  } catch {
    return false;
  }
}
function assertNavigableBrowserUrl(target) {
  if (!isNavigableBrowserUrl(target)) throw new Error(`BLOCKED_SCHEME:${String(target).slice(0, 64)}`);
  return target;
}

// ---------------------------------------------------------------- driver API
// A driver implements: navigate, back, forward, reload, stop, state,
// snapshot, text, source, screenshot, click, type, press, wait, tabs,
// switchTab. BrowserEngine wires the real Electron driver; tests inject
// a fake.

// ---------------------------------------------------------------- bridge HTTP
function readJsonBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Pure-node bridge server. No Electron here so tests can drive it
// with a fake driver. Tab-scoped calls carry an optional per-call tabId
// (pinned call); without it the active tab is used. Nothing here switches
// tabs implicitly — only switchTab does.
function createBridgeServer({ driver, driverFor, isEnabled, onAgentAction, connectionPath }) {
  const token = crypto.randomBytes(24).toString('hex');
  const scoped = (p) => {
    const id = p && p.tabId != null && String(p.tabId) !== '' ? String(p.tabId) : null;
    return { tabId: id, drv: id && driverFor ? driverFor(id) : driver };
  };
  const methods = {
    navigate: (p) => scoped(p).drv.navigate(normalizeUrl(p && p.url), p && p.timeoutMs),
    back: (p) => scoped(p).drv.back(),
    forward: (p) => scoped(p).drv.forward(),
    reload: (p) => scoped(p).drv.reload(),
    stop: (p) => scoped(p).drv.stop(),
    state: (p) => scoped(p).drv.state(),
    snapshot: (p) => scoped(p).drv.snapshot(p && p.max),
    text: (p) => scoped(p).drv.text(p && p.max),
    source: (p) => scoped(p).drv.source(p && p.max),
    screenshot: (p) => scoped(p).drv.screenshot(),
    click: (p) => scoped(p).drv.click(p || {}),
    type: (p) => scoped(p).drv.type(p || {}),
    press: (p) => scoped(p).drv.press(p || {}),
    wait: (p) => scoped(p).drv.wait(p || {}),
    tabs: () => driver.tabs(),
    switchTab: (p) => driver.switchTab(p && p.tabId),
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, app: 'musician-browser' }));
        return;
      }
      if (req.method !== 'POST' || req.url !== '/rpc') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
        return;
      }
      const body = await readJsonBody(req);
      if (!body || body.token !== token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'BAD_TOKEN' }));
        return;
      }
      if (isEnabled && !isEnabled()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'AGENT_DISABLED' }));
        return;
      }
      const fn = methods[body.method];
      if (!fn) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `UNKNOWN_METHOD:${body.method}` }));
        return;
      }
      if (onAgentAction) {
        try {
          const pinned = body.params && body.params.tabId != null && String(body.params.tabId) !== '' ? String(body.params.tabId) : null;
          onAgentAction(body.method, body.params || {}, pinned);
        } catch {
          /* reporting must not break the call */
        }
      }
      const result = await fn(body.params || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: result === undefined ? null : result }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
    }
  });
  return {
    token,
    start: () =>
      new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          const port = addr && addr.port ? addr.port : 0;
          try {
            if (connectionPath) {
              fs.mkdirSync(path.dirname(connectionPath), { recursive: true });
              fs.writeFileSync(connectionPath, JSON.stringify({ port, token, pid: process.pid }));
            }
          } catch (err) {
            reject(err);
            return;
          }
          resolve({ port, token });
        });
        server.on('error', reject);
      }),
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        try {
          if (connectionPath && fs.existsSync(connectionPath)) {
            const cur = JSON.parse(fs.readFileSync(connectionPath, 'utf8'));
            if (cur && cur.pid === process.pid) fs.unlinkSync(connectionPath);
          }
        } catch {
          /* best effort */
        }
      }),
  };
}

// ---------------------------------------------------------------- page scripts
const SNAPSHOT_JS = `(max) => {
  const els = document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[onclick],[tabindex]');
  const out = [];
  let n = 0;
  const limit = Math.min(Math.max(Number(max) || 100, 1), 300);
  for (const el of els) {
    if (out.length >= limit) break;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    n += 1;
    el.dataset.mxRef = String(n);
    const tag = el.tagName.toLowerCase();
    let role = tag;
    if (tag === 'input') role = 'input:' + (el.type || 'text');
    else if (el.getAttribute('role')) role = el.getAttribute('role');
    const name = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    out.push({ ref: n, role, name, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return { url: location.href, title: document.title, count: out.length, elements: out };
}`;

const CLICK_JS = `({ ref, x, y }) => {
  let el = null;
  if (ref != null) el = document.querySelector('[data-mx-ref="' + Number(ref) + '"]');
  else if (typeof x === 'number' && typeof y === 'number') el = document.elementFromPoint(x, y);
  if (!el) return { ok: false, error: 'NOT_FOUND' };
  if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  const r = el.getBoundingClientRect();
  el.click();
  return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}`;

const TYPE_JS = `({ ref, text, submit }) => {
  const el = ref != null ? document.querySelector('[data-mx-ref="' + Number(ref) + '"]') : document.activeElement;
  if (!el) return { ok: false, error: 'NOT_FOUND' };
  if (!/^(input|textarea|select)$/i.test(el.tagName) && el.contentEditable !== 'true') {
    return { ok: false, error: 'NOT_EDITABLE' };
  }
  el.focus();
  const value = String(text == null ? '' : text);
  let typed = false;
  try {
    if (/^(input|textarea)$/i.test(el.tagName)) {
      const proto = el.tagName.toLowerCase() === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      typed = true;
    }
  } catch { /* fall through to execCommand */ }
  if (!typed) {
    try {
      if (el.contentEditable === 'true') el.innerHTML = '';
      else el.value = '';
    } catch { /* ignore */ }
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, value);
  }
  if (submit) {
    const form = el.closest ? el.closest('form') : null;
    if (form && form.requestSubmit) form.requestSubmit();
    else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }
  return { ok: true, valueLength: value.length };
}`;

const PRESS_JS = `({ key }) => {
  const el = document.activeElement || document.body;
  const k = String(key || 'Enter');
  const code = k === ' ' ? 'Space' : k.length === 1 ? 'Key' + k.toUpperCase() : k;
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true }));
  }
  return { ok: true, key: k };
}`;

// Trusted-input helpers: scripts only locate/focus; the actual click and
// keystrokes go through webContents.sendInputEvent so pages see real,
// trusted input (hover/focus/active states, key handlers). Markers let the
// mock tests route each script.
const POINT_JS = `/*MX-POINT*/({ ref, x, y }) => {
  if (ref == null && typeof x === 'number' && typeof y === 'number') {
    const hit = document.elementFromPoint(x, y);
    if (hit && hit.scrollIntoView) hit.scrollIntoView({ block: 'nearest' });
    return { ok: true, x, y };
  }
  const el = ref != null ? document.querySelector('[data-mx-ref="' + Number(ref) + '"]') : null;
  if (!el) return { ok: false, error: 'NOT_FOUND' };
  if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  const r = el.getBoundingClientRect();
  return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}`;

const FOCUS_JS = `/*MX-FOCUS*/({ ref }) => {
  const el = ref != null ? document.querySelector('[data-mx-ref="' + Number(ref) + '"]') : document.activeElement;
  if (!el) return { ok: false, error: 'NOT_FOUND' };
  if (!/^(input|textarea|select)$/i.test(el.tagName) && el.contentEditable !== 'true') {
    return { ok: false, error: 'NOT_EDITABLE' };
  }
  el.focus();
  return { ok: true };
}`;

// Char-by-char typing past this length would serialize thousands of input
// events; huge pastes take the fast setter path instead.
const REAL_TYPE_CHAR_CAP = 20000;
const PRESSABLE_KEYS = new Set([
  'Enter', 'Escape', 'Esc', 'Tab', 'Backspace', 'Delete',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown', ' ',
]);
// Normalize to an Electron sendInputEvent keyCode, or null when the key is
// unknown (caller falls back to DOM events rather than sending garbage).
function normalizePressKey(key) {
  const k = String(key == null || key === '' ? 'Enter' : key);
  if (k.length === 1) return k;
  if (PRESSABLE_KEYS.has(k)) return k === 'Esc' ? 'Escape' : k;
  if (/^F([1-9]|1\d|2[0-4])$/i.test(k)) return k.toUpperCase();
  return null;
}

const TEXT_JS = `(max) => {
  const t = (document.body ? document.body.innerText : '') || '';
  const limit = Math.min(Math.max(Number(max) || 8000, 1), 60000);
  return { url: location.href, title: document.title, length: t.length, text: t.slice(0, limit) };
}`;
// Engine-gap fallback for find-in-page: some builds never emit found-in-page,
// so an unanswered request is completed with equivalent window.find semantics.
const FIND_FALLBACK_MS = 1200;
const FIND_FALLBACK_JS = `(op, query, backward) => {
  const q = String(query || '');
  if (!q) return { matches: 0 };
  if (op === 'count') {
    const t = ((document.body ? document.body.innerText : '') || '').toLowerCase();
    const needle = q.toLowerCase();
    let n = 0, i = 0;
    for (;;) { i = t.indexOf(needle, i); if (i < 0) break; n += 1; i += needle.length; if (n >= 5000) break; }
    return { matches: n };
  }
  if (op === 'first') {
    try { window.getSelection().collapse(document.body, 0); } catch {}
    return { found: window.find(q, false, false, true) };
  }
  if (op === 'step') {
    return { found: window.find(q, false, !!backward, true) };
  }
  if (op === 'clear') {
    try { window.getSelection().removeAllRanges(); } catch {}
    return { cleared: true };
  }
  if (op === 'where') {
    if (!document.body) return { index: 0, rect: null };
    const needle = q.toLowerCase();
    const sel = window.getSelection();
    const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (!r) return { index: 0, rect: null };
    const box = r.getClientRects && r.getClientRects().length > 0 ? r.getClientRects()[0] : null;
    const rect = box ? { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } : null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0, idx = 0, node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.toLowerCase();
      let i = 0;
      for (;;) {
        i = t.indexOf(needle, i);
        if (i < 0) break;
        n += 1;
        if (idx === 0 && node === r.startContainer && r.startOffset >= i && r.startOffset <= i + needle.length) idx = n;
        i += needle.length;
        if (n >= 5000) break;
      }
      if (n >= 5000) break;
    }
    return { index: idx, rect: idx > 0 ? rect : null };
  }
  return {};
}`;

// One native found-in-page event: mirror it to the renderer and keep the
// fallback state on the same answer, so a later fallback step continues
// from truth instead of a stale ordinal (native drives clear the DOM
// selection the fallback arithmetic assumes).
function handleFoundInPage(rec, emit, result) {
  if (!rec || !rec.findSettled) return false;
  if (rec.findSettled.has(result.requestId)) return false; // fallback already answered
  const query = rec.findQueries ? rec.findQueries.get(result.requestId) || '' : '';
  emit({ type: 'find-result', requestId: result.requestId, query, matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal, finalUpdate: result.finalUpdate, selectionArea: result.selectionArea || null });
  if (query) rec.findFallback = { query, matches: result.matches, ordinal: result.activeMatchOrdinal, at: Date.now() };
  if (result.finalUpdate) {
    rec.findQueries?.delete(result.requestId);
    rec.findSettled.add(result.requestId);
    if (rec.findSettled.size > 48) rec.findSettled.delete(rec.findSettled.values().next().value);
  }
  return true;
}

// ---------------------------------------------------------------- engine
class BrowserEngine {
  constructor({ getWindow, send, userDataDir, getSettings }) {
    this.getWindow = getWindow;
    this.send = send;
    this.userDataDir = userDataDir;
    this.getSettings = getSettings;
    this.views = new Map(); // tabId -> { view, home }
    this.attachedTabId = null; // the tab currently shown in the window
    this.activeTabId = null; // the tab agents drive (follows attach/switch)
    this.bounds = { x: 0, y: 0, width: 800, height: 600 };
    this.bridge = null;
    this.bridgeInfo = null;
  }

  connectionPath() {
    const dir = typeof this.userDataDir === 'function' ? this.userDataDir() : this.userDataDir;
    return path.join(dir, BRIDGE_FILE);
  }

  isAgentEnabled() {
    try {
      const s = this.getSettings ? this.getSettings() : null;
      return !s || s.browserAgent !== false;
    } catch {
      return true;
    }
  }

  ensureView(tabId) {
    const id = String(tabId || '');
    if (!id) throw new Error('NO_TAB');
    const hit = this.views.get(id);
    if (hit && !hit.view.webContents.isDestroyed()) return hit.view;
    const { WebContentsView } = require('electron');
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    const wc = view.webContents;
    // Least privilege for arbitrary web content: pages in these views get no
    // device/data permissions (mic, camera, geo, clipboard...). The main app
    // window keeps its own behavior (voice input, terminal copy). One guard
    // per session — views share the default session with the app window.
    try {
      const sess = wc.session;
      if (sess && !sess.__musicianViewPermGuard) {
        sess.__musicianViewPermGuard = true;
        const allowMainWindowOnly = (requesting) => {
          try {
            const win = this.getWindow ? this.getWindow() : null;
            return !!(win && !win.isDestroyed() && requesting === win.webContents);
          } catch {
            return false;
          }
        };
        sess.setPermissionRequestHandler((requesting, _permission, callback) => {
          callback(allowMainWindowOnly(requesting));
        });
        if (typeof sess.setPermissionCheckHandler === 'function') {
          sess.setPermissionCheckHandler((requesting) => allowMainWindowOnly(requesting));
        }
      }
    } catch {
      /* permissions stay at Chromium defaults */
    }
    const findQueries = new Map();
    const findSettled = new Set();
    const emit = (ev) => this.emit({ tabId: id, ...ev });
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = String(input.key || '').toLowerCase();
      const command = !!(input.control || input.meta);
      const shortcut = browserTabShortcut(input);
      if (shortcut) {
        event.preventDefault();
        emit({ type: 'shortcut', shortcut });
      } else if (input.alt && (key === 'arrowleft' || key === 'left')) {
        event.preventDefault();
        if (wc.navigationHistory.canGoBack()) void wc.navigationHistory.goBack().catch(() => {});
      } else if (input.alt && (key === 'arrowright' || key === 'right')) {
        event.preventDefault();
        if (wc.navigationHistory.canGoForward()) void wc.navigationHistory.goForward().catch(() => {});
      } else if ((command && key === 'r') || key === 'f5') {
        event.preventDefault();
        wc.reload();
      } else if (key === 'escape' && wc.isLoading()) {
        event.preventDefault();
        wc.stop();
      }
    });
    // Keep popups inside the shared tab instead of spawning windows.
    wc.setWindowOpenHandler(({ url }) => {
      try {
        if (isNavigableBrowserUrl(url)) {
          wc.loadURL(url);
          emit({ type: 'url', url });
        }
      } catch {
        /* ignore */
      }
      return { action: 'deny' };
    });
    wc.on('did-start-loading', () => emit({ type: 'loading', loading: true, url: wc.getURL() }));
    wc.on('did-stop-loading', () => emit({ type: 'loading', loading: false, url: wc.getURL() }));
    wc.on('did-navigate', (_e, url) => emit({ type: 'url', url }));
    wc.on('did-navigate-in-page', (_e, url) => emit({ type: 'url', url }));
    wc.on('page-title-updated', (_e, title) => emit({ type: 'title', title, url: wc.getURL() }));
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (shouldReportLoadFailure(code, isMainFrame)) emit({ type: 'failed', code, desc, url });
    });
    wc.on('found-in-page', (_event, result) => {
      handleFoundInPage(this.views.get(id), emit, result);
    });
    view.setBounds(this.bounds);
    this.views.set(id, { view, home: '', findQueries, findSettled, findFallback: null });
    return view;
  }

  emit(ev) {
    try {
      this.send('browser:event', ev);
    } catch {
      /* renderer gone */
    }
  }

  detachCurrent() {
    try {
      const win = this.getWindow();
      const cur = this.attachedTabId ? this.views.get(this.attachedTabId) : null;
      if (win && !win.isDestroyed() && cur) win.contentView.removeChildView(cur.view);
    } catch {
      /* ignore */
    }
    this.attachedTabId = null;
  }

  // Renderer: show tabId in the window (hides the previous one).
  show(tabId, home, initialUrl) {
    const id = String(tabId || '');
    if (!id) return { ok: false, error: 'NO_TAB' };
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'NO_WINDOW' };
    let view;
    try {
      view = this.ensureView(id);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
    if (typeof home === 'string' && home) {
      const rec = this.views.get(id);
      if (rec) rec.home = home;
    }
    if (typeof initialUrl === 'string' && initialUrl) {
      const rec = this.views.get(id);
      if (rec) rec.initialUrl = initialUrl;
    }
    if (this.attachedTabId !== id) {
      this.detachCurrent();
      win.contentView.addChildView(view);
      this.attachedTabId = id;
    }
    this.activeTabId = id;
    view.setBounds(this.bounds);
    const url = view.webContents.getURL();
    if (!url || url === 'about:blank') {
      const rec = this.views.get(id);
      const start = resolveBrowserStartUrl(rec?.initialUrl, rec?.home);
      if (rec) rec.initialUrl = '';
      view.webContents.loadURL(start).catch(() => {});
    }
    return { ok: true, tabId: id };
  }

  // Renderer: park tabId (or the attached one). The view survives hidden.
  hide(tabId) {
    const id = tabId ? String(tabId) : this.attachedTabId;
    if (!id) return { ok: true };
    if (this.attachedTabId === id) this.detachCurrent();
    return { ok: true };
  }

  close(tabId) {
    const id = String(tabId || '');
    if (!id) return { ok: false, error: 'NO_TAB' };
    if (this.attachedTabId === id) this.detachCurrent();
    if (this.activeTabId === id) this.activeTabId = null;
    const rec = this.views.get(id);
    this.views.delete(id);
    try {
      if (rec && rec.view.webContents && !rec.view.webContents.isDestroyed()) rec.view.webContents.close();
    } catch {
      /* ignore */
    }
    return { ok: true };
  }

  setBounds(b) {
    if (!b) return { ok: false, error: 'BAD_BOUNDS' };
    this.bounds = {
      x: Math.max(0, Math.round(b.x || 0)),
      y: Math.max(0, Math.round(b.y || 0)),
      width: Math.max(0, Math.round(b.width || 0)),
      height: Math.max(0, Math.round(b.height || 0)),
    };
    const cur = this.attachedTabId ? this.views.get(this.attachedTabId) : null;
    if (cur) cur.view.setBounds(this.bounds);
    return { ok: true };
  }

  tabList() {
    const out = [];
    for (const [id, rec] of this.views) {
      const wc = rec.view.webContents;
      const dead = !wc || wc.isDestroyed();
      out.push({
        tabId: id,
        active: id === this.activeTabId,
        attached: id === this.attachedTabId,
        url: dead ? '' : wc.getURL(),
        loading: dead ? false : wc.isLoading(),
      });
    }
    return out;
  }

  // Agent: switch the driven tab. Only re-attaches when the user is
  // already looking at a browser tab (never overlays the editor).
  switchTab(tabId) {
    const id = String(tabId || '');
    if (!id || !this.views.has(id)) return { ok: false, error: 'NO_SUCH_TAB' };
    this.activeTabId = id;
    if (this.attachedTabId && this.attachedTabId !== id) {
      try {
        const win = this.getWindow();
        if (win && !win.isDestroyed()) {
          this.detachCurrent();
          const rec = this.views.get(id);
          rec.view.setBounds(this.bounds);
          win.contentView.addChildView(rec.view);
          this.attachedTabId = id;
          // The visible page changed under React: the pane header must follow.
          this.emit({ type: 'agent-switch', tabId: id });
        }
      } catch {
        /* agent target still switched */
      }
    }
    return { ok: true, tabId: id };
  }

  // The driver shared by the UI (via IPC) and agents (via the bridge).
  // tabId null → the active tab. An explicit tabId must already exist:
  // Engine-gap fallback for find(): completes one request that Chromium never
  // answered, with equivalent window.find semantics and the same event shape.
  async findFallback(rec, tabId, requestId, query, { forward, findNext, bornAt }) {
    if (!rec || !rec.findSettled) return;
    if (rec.findSettled.has(requestId)) return; // native answered
    const cur = rec.findFallback;
    if (cur && cur.at > bornAt) return; // superseded by a newer fallback
    const wc = rec.view && !rec.view.webContents.isDestroyed() ? rec.view.webContents : null;
    if (!wc) return;
    const run = (op, backward) => wc.executeJavaScript(
      `(${FIND_FALLBACK_JS})(${JSON.stringify(op)},${JSON.stringify(query)},${backward ? 'true' : 'false'})`);
    try {
      const counted = await run('count', false);
      const matches = Math.max(0, Number(counted?.matches) || 0);
      let ordinal = 0;
      if (matches > 0 && cur && cur.query === query && findNext) {
        const step = await run('step', forward === false);
        ordinal = step?.found === false ? cur.ordinal
          : forward === false ? ((cur.ordinal - 2 + matches) % matches) + 1 : (cur.ordinal % matches) + 1;
      } else if (matches > 0) {
        await run('first', false);
        ordinal = 1;
      }
      let selectionArea = null;
      if (matches > 0) {
        // A native drive between fallback answers clears the DOM selection
        // the arithmetic assumes, so verify where the highlight landed and
        // report that when sane; arithmetic stays as the fallback.
        const where = await run('where', false).catch(() => null);
        const landed = Math.floor(Number(where?.index) || 0);
        if (landed >= 1 && landed <= matches) {
          ordinal = landed;
          if (where && where.rect && typeof where.rect === 'object') selectionArea = where.rect;
        }
      }
      rec.findFallback = { query, matches, ordinal, at: Date.now() };
      rec.findSettled.add(requestId);
      if (rec.findSettled.size > 48) rec.findSettled.delete(rec.findSettled.values().next().value);
      rec.findQueries?.delete(requestId);
      this.emit({ tabId, type: 'find-result', requestId, query, matches, activeMatchOrdinal: ordinal, finalUpdate: true, selectionArea });
    } catch {
      // View died mid-flight; the renderer is gone, nothing to answer.
    }
  }

  // never conjure a hidden view out of a typo (queries like state() stay
  // lenient and report hasView:false instead).
  driverFor(tabId) {
    const self = this;
    const needView = () => {
      const id = tabId ? String(tabId) : self.activeTabId;
      if (!id) throw new Error('NO_TAB');
      if (tabId && !self.views.has(id)) throw new Error(`NO_SUCH_TAB:${id} — list tabs with browser_tabs and use an existing tabId`);
      const v = self.ensureView(id);
      if (!v || v.webContents.isDestroyed()) throw new Error('NO_VIEW');
      return { id, view: v, record: self.views.get(id) };
    };
    return {
      async navigate(url, timeoutMs) {
        const { view: v } = needView();
        const target = assertNavigableBrowserUrl(normalizeUrl(url));
        const timeout = Math.min(Math.max(Number(timeoutMs) || NAV_TIMEOUT_MS, 1000), 120000);
        const wc = v.webContents;
        const done = new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ timedOut: true }), timeout);
          const finish = (ok, extra) => {
            clearTimeout(timer);
            wc.removeListener('did-finish-load', onOk);
            wc.removeListener('did-fail-load', onFail);
            resolve({ timedOut: false, ok, ...(extra || {}) });
          };
          const onOk = () => finish(true);
          const onFail = (_e, code, desc, _url, isMainFrame) => {
            if (!shouldReportLoadFailure(code, isMainFrame)) return; // keep waiting
            finish(false, { code, desc });
          };
          wc.once('did-finish-load', onOk);
          wc.on('did-fail-load', onFail);
        });
        try {
          await wc.loadURL(target);
        } catch (err) {
          if (!isAbortedLoadError(err)) throw err;
          // Superseded/stopped load: the newer navigation (or stop) owns
          // the outcome. Soft-fail so the UI stays silent; `done`
          // settles on the next finish event or the timeout.
          return { ok: false, aborted: true, url: safeGet(wc, 'getURL'), title: safeGet(wc, 'getTitle'), timedOut: false, code: -3, desc: 'ERR_ABORTED' };
        }
        const r = await done;
        return { ok: !r.timedOut && r.ok !== false, url: wc.getURL(), title: wc.getTitle(), timedOut: !!r.timedOut, ...(r.code ? { code: r.code, desc: r.desc } : {}) };
      },
      async back() {
        const wc = needView().view.webContents;
        if (wc.navigationHistory.canGoBack()) await wc.navigationHistory.goBack();
        return { ok: true, url: wc.getURL() };
      },
      async forward() {
        const wc = needView().view.webContents;
        if (wc.navigationHistory.canGoForward()) await wc.navigationHistory.goForward();
        return { ok: true, url: wc.getURL() };
      },
      async reload() {
        needView().view.webContents.reload();
        return { ok: true };
      },
      async stop() {
        needView().view.webContents.stop();
        return { ok: true };
      },
      async find(text, options = {}) {
        const { id, view: v, record } = needView();
        const query = String(text || '');
        if (!query) {
          v.webContents.stopFindInPage('clearSelection');
          record?.findQueries?.clear();
          if (record) {
            record.findSettled?.clear();
            record.findFallback = null;
            v.webContents.executeJavaScript(`(${FIND_FALLBACK_JS})('clear','',false)`).catch(() => {});
          }
          return { ok: true, requestId: null };
        }
        const requestId = v.webContents.findInPage(query, {
          forward: options.forward !== false,
          findNext: !!options.findNext,
          matchCase: false,
        });
        record?.findQueries?.set(requestId, query);
        if (record?.findQueries?.size > 24) record.findQueries.delete(record.findQueries.keys().next().value);
        if (record) {
          const rec = record;
          const bornAt = Date.now();
          const forward = options.forward !== false;
          const findNext = !!options.findNext;
          setTimeout(() => {
            void self.findFallback(rec, id, requestId, query, { forward, findNext, bornAt }).catch(() => {});
          }, FIND_FALLBACK_MS);
        }
        return { ok: true, requestId, tabId: id };
      },
      async state() {
        const id = tabId ? String(tabId) : self.activeTabId;
        const rec = id ? self.views.get(id) : null;
        const wc = rec && !rec.view.webContents.isDestroyed() ? rec.view.webContents : null;
        if (!wc) return { ok: true, tabId: id || null, hasView: false, attached: false, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, agentEnabled: self.isAgentEnabled() };
        return {
          ok: true,
          tabId: id,
          hasView: true,
          attached: self.attachedTabId === id,
          url: wc.getURL(),
          title: wc.getTitle(),
          loading: wc.isLoading(),
          canGoBack: wc.navigationHistory.canGoBack(),
          canGoForward: wc.navigationHistory.canGoForward(),
          agentEnabled: self.isAgentEnabled(),
        };
      },
      async snapshot(max) {
        const r = await needView().view.webContents.executeJavaScript(`(${SNAPSHOT_JS})(${JSON.stringify(max || 100)})`);
        return { ok: true, ...r };
      },
      async text(max) {
        const r = await needView().view.webContents.executeJavaScript(`(${TEXT_JS})(${JSON.stringify(max || 8000)})`);
        return { ok: true, ...r };
      },
      async source(max) {
        const v = needView().view;
        const html = await v.webContents.executeJavaScript('(document.documentElement ? document.documentElement.outerHTML : "")');
        const full = String(html || '');
        const limit = Math.min(Math.max(Number(max) || 200000, 1000), 1048576);
        return { ok: true, url: v.webContents.getURL(), length: full.length, truncated: full.length > limit, html: full.slice(0, limit) };
      },
      async screenshot() {
        const img = await needView().view.webContents.capturePage();
        const png = img.toPNG();
        if (!png || png.length === 0) throw new Error('EMPTY_CAPTURE');
        if (png.length > 6 * 1024 * 1024) throw new Error('CAPTURE_TOO_LARGE');
        return { ok: true, mime: 'image/png', base64: png.toString('base64'), bytes: png.length };
      },
      async click(p) {
        const wc = needView().view.webContents;
        if (typeof wc.sendInputEvent === 'function') {
          const r = await wc.executeJavaScript(`(${POINT_JS})(${JSON.stringify({ ref: p.ref ?? null, x: p.x ?? null, y: p.y ?? null })})`);
          if (!r || r.ok === false) throw new Error(staleRefError('CLICK_FAILED', r, p.ref));
          const x = Math.round(Number(r.x));
          const y = Math.round(Number(r.y));
          if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('CLICK_FAILED');
          wc.sendInputEvent({ type: 'mouseMove', x, y });
          wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
          wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
          return { ok: true, x, y };
        }
        const r = await wc.executeJavaScript(`(${CLICK_JS})(${JSON.stringify({ ref: p.ref ?? null, x: p.x ?? null, y: p.y ?? null })})`);
        if (!r || r.ok === false) throw new Error(staleRefError('CLICK_FAILED', r, p.ref));
        return { ok: true, ...r };
      },
      async type(p) {
        if (p.text == null) throw new Error('EMPTY_TEXT');
        const wc = needView().view.webContents;
        const value = String(p.text);
        if (typeof wc.sendInputEvent === 'function' && value.length <= REAL_TYPE_CHAR_CAP) {
          const r = await wc.executeJavaScript(`(${FOCUS_JS})(${JSON.stringify({ ref: p.ref ?? null })})`);
          if (!r || r.ok === false) throw new Error(staleRefError('TYPE_FAILED', r, p.ref));
          for (const ch of value) wc.sendInputEvent({ type: 'char', keyCode: ch });
          if (p.submit) {
            wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
            wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
          }
          return { ok: true, valueLength: value.length };
        }
        const r = await wc.executeJavaScript(`(${TYPE_JS})(${JSON.stringify({ ref: p.ref ?? null, text: value, submit: !!p.submit })})`);
        if (!r || r.ok === false) throw new Error(staleRefError('TYPE_FAILED', r, p.ref));
        return { ok: true, ...r };
      },
      async press(p) {
        const wc = needView().view.webContents;
        const k = normalizePressKey(p.key);
        if (k && typeof wc.sendInputEvent === 'function') {
          wc.sendInputEvent({ type: 'keyDown', keyCode: k });
          if (k.length === 1) wc.sendInputEvent({ type: 'char', keyCode: k });
          wc.sendInputEvent({ type: 'keyUp', keyCode: k });
          return { ok: true, key: k };
        }
        const r = await wc.executeJavaScript(`(${PRESS_JS})(${JSON.stringify({ key: p.key || 'Enter' })})`);
        return { ok: true, ...r };
      },
      async wait(p) {
        const total = Math.min(Math.max(Number((p && p.timeoutMs) || (p && p.ms) || 5000), 100), 60000);
        const want = p && p.urlContains ? String(p.urlContains) : '';
        const t0 = Date.now();
        for (;;) {
          const id = tabId ? String(tabId) : self.activeTabId;
          const rec = id ? self.views.get(id) : null;
          const wc = rec && !rec.view.webContents.isDestroyed() ? rec.view.webContents : null;
          const url = wc ? wc.getURL() : '';
          if (want && url.includes(want)) return { ok: true, url, waitedMs: Date.now() - t0 };
          if (!want && Date.now() - t0 >= total) return { ok: true, url, waitedMs: Date.now() - t0 };
          if (Date.now() - t0 >= total) return { ok: false, error: 'WAIT_TIMEOUT', url, waitedMs: Date.now() - t0 };
          await new Promise((r) => setTimeout(r, 250));
        }
      },
      async tabs() {
        return { ok: true, tabs: self.tabList() };
      },
      async switchTab(id) {
        const r = self.switchTab(id);
        if (!r.ok) throw new Error(r.error);
        return r;
      },
    };
  }

  driver() {
    return this.driverFor(null);
  }

  async startBridge() {
    if (this.bridge) return this.bridgeInfo;
    this.bridge = createBridgeServer({
      driver: this.driver(),
      driverFor: (id) => this.driverFor(id),
      isEnabled: () => this.isAgentEnabled(),
      onAgentAction: (method, params, pinnedTabId) => this.emit({ type: 'agent', tabId: pinnedTabId || this.activeTabId, method, params: headParams(params) }),
      connectionPath: this.connectionPath(),
    });
    this.bridgeInfo = await this.bridge.start();
    return this.bridgeInfo;
  }

  // Another instance (or a stale run) may have overwritten the shared bridge
  // file after this bridge started. When the file no longer points at this
  // live bridge, rewrite it so newly spawned MCP servers connect here.
  // Never touches the running bridge itself.
  repairBridgeFile() {
    if (!this.bridge || !this.bridgeInfo) return { repaired: false, reason: 'NO_BRIDGE' };
    let current = null;
    try {
      current = JSON.parse(fs.readFileSync(this.connectionPath(), 'utf8'));
    } catch {
      current = null;
    }
    if (current && current.port === this.bridgeInfo.port && current.token === this.bridgeInfo.token) {
      return { repaired: false, reason: null };
    }
    try {
      fs.mkdirSync(path.dirname(this.connectionPath()), { recursive: true });
      fs.writeFileSync(this.connectionPath(), JSON.stringify({
        port: this.bridgeInfo.port,
        token: this.bridgeInfo.token,
        pid: process.pid,
      }));
      return { repaired: true, reason: null };
    } catch {
      return { repaired: false, reason: 'WRITE_FAILED' };
    }
  }

  async shutdown() {
    try {
      this.detachCurrent();
    } catch {
      /* ignore */
    }
    for (const id of [...this.views.keys()]) {
      try {
        this.close(id);
      } catch {
        /* ignore */
      }
    }
    if (this.bridge) {
      try {
        await this.bridge.stop();
      } catch {
        /* ignore */
      }
      this.bridge = null;
      this.bridgeInfo = null;
    }
  }
}

// Refs come from the latest snapshot and die with the next DOM change, so a
// NOT_FOUND on a ref call is almost always staleness: say so and point at
// the fix instead of a bare code.
function staleRefError(fallback, r, ref) {
  const code = (r && r.error) || fallback;
  if (code === 'NOT_FOUND' && ref != null) {
    return `AX_REF_STALE:${ref} — take a fresh browser_snapshot and use a new ref`;
  }
  if (code === 'NOT_EDITABLE' && ref != null) {
    return `NOT_EDITABLE:${ref} — the element is not editable`;
  }
  return code;
}

function headParams(p) {
  // Keep the UI badge small; never ship full page text through events.
  try {
    const s = JSON.stringify(p || {});
    return s.length > 300 ? `${s.slice(0, 300)}…` : s;
  } catch {
    return '';
  }
}

// did-fail-load fires for subframes and for benign aborts (superseded
// navigation, stop, restore races) — those must not toast. Only real
// main-frame errors surface. A missing frame flag keeps legacy behavior.
function shouldReportLoadFailure(code, isMainFrame) {
  if (isMainFrame === false) return false;
  if (code === -3) return false; // ERR_ABORTED
  return true;
}

// loadURL itself rejects with ERR_ABORTED when the navigation is
// superseded or stopped — same benign class as the did-fail-load -3.
function isAbortedLoadError(err) {
  return /ERR_ABORTED/.test(String((err && err.message) || err));
}

function safeGet(wc, method) {
  try {
    return wc[method]();
  } catch {
    return '';
  }
}

module.exports = { BrowserEngine, createBridgeServer, normalizeUrl, resolveAddressInput, resolveBrowserStartUrl, isNavigableBrowserUrl, BRIDGE_FILE, staleRefError, shouldReportLoadFailure, handleFoundInPage };
