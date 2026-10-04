// Musician browser MCP server (stdio, zero dependencies).
//
// Lets a CLI agent drive the same browser tab the user sees in the
// Musician app. Talks to the app's localhost bridge; the app must be
// running and Settings → 브라우저 → 에이전트 조종 must be on.
//
// Register as an MCP stdio server:
//   command: node
//   args: ["<resources>/browser-mcp/server.js"]
// (Settings → 브라우저 shows the exact args for your install.)
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const SERVER_INFO = { name: 'musician-browser', version: '0.8.1' };

// Per-call tab pin: every tab-scoped tool accepts it, the active tab is used
// when omitted, and nothing switches tabs implicitly (only browser_switch_tab).
const TAB_ID_PROP = { type: 'string', description: 'Pin this one call to a tab; omit to use the active tab.' };

function bridgeFilePath() {
  if (process.env.MUSICIAN_BRIDGE_FILE) return process.env.MUSICIAN_BRIDGE_FILE;
  // Mirror electron/main.js: the pre-rename data dir survives the rebrand.
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  for (const n of ['Mudex', 'mudex']) {
    const dir = path.join(base, n);
    try {
      if (fs.statSync(dir).isDirectory()) return path.join(dir, 'browser-bridge.json');
    } catch {
      /* try next */
    }
  }
  return path.join(base, 'Mudex', 'browser-bridge.json');
}

function readBridge() {
  const file = bridgeFilePath();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const info = JSON.parse(raw);
    if (!info || !info.port || !info.token) throw new Error('BAD_BRIDGE_FILE');
    return info;
  } catch {
    return null;
  }
}

function rpc(method, params, timeoutMs = 90000) {
  const info = readBridge();
  if (!info) {
    throw new Error(
      'APP_NOT_RUNNING: the Musician app is not running (no browser bridge). Ask the user to launch Musician.exe first.',
    );
  }
  const body = JSON.stringify({ token: info.token, method, params: params || {} });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: info.port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const out = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!out || out.ok !== true) {
              const code = (out && out.error) || `HTTP_${res.statusCode}`;
              if (code === 'AGENT_DISABLED') {
                reject(new Error('AGENT_DISABLED: browser agent control is off in Musician settings (설정 → 브라우저).'));
                return;
              }
              reject(new Error(String(code)));
              return;
            }
            resolve(out.result);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('BRIDGE_TIMEOUT')));
    req.on('error', (err) => {
      if (err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET')) {
        reject(new Error('APP_NOT_RUNNING: cannot reach the Musician browser bridge. Is the app running?'));
        return;
      }
      reject(err);
    });
    req.end(body);
  });
}

const TOOLS = [
  {
    name: 'browser_tabs',
    description: 'FIRST browser action: list existing Musician in-app tabs and reuse a matching tab with browser_switch_tab. These tabs share the user login session. Do not launch a separate browser or create duplicate tabs for this task.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_switch_tab',
    description: 'Switch the driven browser tab. Other tools act on the active tab.',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'string' } },
      required: ['tabId'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the selected existing Musician tab. First list tabs and select the intended tab; if it is already at the requested URL, use snapshot instead. Scheme optional (https assumed).',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' }, timeoutMs: { type: 'number' }, tabId: TAB_ID_PROP },
      required: ['url'],
    },
  },
  {
    name: 'browser_back',
    description: 'Go back in the shared browser tab history.',
    inputSchema: { type: 'object', properties: { tabId: TAB_ID_PROP } },
  },
  {
    name: 'browser_forward',
    description: 'Go forward in the shared browser tab history.',
    inputSchema: { type: 'object', properties: { tabId: TAB_ID_PROP } },
  },
  {
    name: 'browser_reload',
    description: 'Reload the current page in the shared browser tab.',
    inputSchema: { type: 'object', properties: { tabId: TAB_ID_PROP } },
  },
  {
    name: 'browser_state',
    description: 'Current tab state: URL, title, loading flag, back/forward availability.',
    inputSchema: { type: 'object', properties: { tabId: TAB_ID_PROP } },
  },
  {
    name: 'browser_snapshot',
    description: 'List interactable elements (links, buttons, inputs) with refs for click/type. Call again after the page changes; refs expire on navigation.',
    inputSchema: {
      type: 'object',
      properties: { max: { type: 'number', description: 'Max elements (default 100, cap 300).' }, tabId: TAB_ID_PROP },
    },
  },
  {
    name: 'browser_text',
    description: 'Visible text of the current page.',
    inputSchema: {
      type: 'object',
      properties: { max: { type: 'number', description: 'Max chars (default 8000, cap 60000).' }, tabId: TAB_ID_PROP },
    },
  },
  {
    name: 'browser_source',
    description: 'Raw HTML source of the current page (outerHTML).',
    inputSchema: {
      type: 'object',
      properties: { max: { type: 'number', description: 'Max chars (default 200000, cap 1048576).' }, tabId: TAB_ID_PROP },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Screenshot of the current tab viewport as PNG.',
    inputSchema: { type: 'object', properties: { tabId: TAB_ID_PROP } },
  },
  {
    name: 'browser_click',
    description: 'Click an element by snapshot ref, or at viewport x/y coordinates.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, tabId: TAB_ID_PROP },
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input/textarea (snapshot ref) or the focused element. Set submit=true to press Enter / submit the enclosing form.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' }, tabId: TAB_ID_PROP },
      required: ['text'],
    },
  },
  {
    name: 'browser_press',
    description: 'Press a key (Enter, Escape, Tab, ArrowDown, …) on the focused element.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' }, tabId: TAB_ID_PROP },
      required: ['key'],
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for the URL to contain a string, or just wait ms. Default 5000ms, cap 60000ms.',
    inputSchema: {
      type: 'object',
      properties: { ms: { type: 'number' }, timeoutMs: { type: 'number' }, urlContains: { type: 'string' }, tabId: TAB_ID_PROP },
    },
  },
];

const METHOD_OF = {
  browser_tabs: 'tabs',
  browser_switch_tab: 'switchTab',
  browser_navigate: 'navigate',
  browser_back: 'back',
  browser_forward: 'forward',
  browser_reload: 'reload',
  browser_state: 'state',
  browser_snapshot: 'snapshot',
  browser_text: 'text',
  browser_source: 'source',
  browser_screenshot: 'screenshot',
  browser_click: 'click',
  browser_type: 'type',
  browser_press: 'press',
  browser_wait: 'wait',
};

function textResult(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}
function errorResult(text) {
  return { content: [{ type: 'text', text: String(text) }], isError: true };
}

// Model-facing boundary: coerce the loose JSON models send ('false', '3')
// and reject garbage with a message that names the argument. Unknown extras
// pass through untouched for forward compatibility.
function paramError(tool, arg, why, received) {
  return new Error(`INVALID_PARAMS:${tool}.${arg}: ${why} (received ${JSON.stringify(received) ?? 'nothing'})`);
}
function asBool(tool, arg, v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && (v === 1 || v === 0)) return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
  }
  throw paramError(tool, arg, 'expected a boolean', v);
}
function asInt(tool, arg, v, min = null) {
  let n = null;
  if (typeof v === 'number' && Number.isFinite(v)) n = Math.trunc(v);
  else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) n = parseInt(v.trim(), 10);
  else throw paramError(tool, arg, 'expected an integer', v);
  if (min != null && n < min) throw paramError(tool, arg, `expected an integer >= ${min}`, v);
  return n;
}
function asNonEmptyString(tool, arg, v) {
  if (typeof v !== 'string' || !v.trim()) throw paramError(tool, arg, 'expected a non-empty string', v);
  return v;
}
const TAB_SCOPED = new Set([
  'browser_navigate', 'browser_back', 'browser_forward', 'browser_reload',
  'browser_state', 'browser_snapshot', 'browser_text', 'browser_source',
  'browser_screenshot', 'browser_click', 'browser_type', 'browser_press', 'browser_wait',
]);
function normalizeToolArgs(name, args) {
  const a = { ...(args || {}) };
  if (a.tabId != null && a.tabId !== '') {
    if (!TAB_SCOPED.has(name) && name !== 'browser_switch_tab') throw paramError(name, 'tabId', 'this tool takes no tabId', a.tabId);
    a.tabId = asNonEmptyString(name, 'tabId', a.tabId);
  } else {
    delete a.tabId;
  }
  switch (name) {
    case 'browser_switch_tab':
      a.tabId = asNonEmptyString(name, 'tabId', a.tabId);
      break;
    case 'browser_navigate':
      a.url = asNonEmptyString(name, 'url', a.url);
      if (a.timeoutMs != null) a.timeoutMs = asInt(name, 'timeoutMs', a.timeoutMs, 1);
      break;
    case 'browser_snapshot':
    case 'browser_text':
    case 'browser_source':
      if (a.max != null) a.max = asInt(name, 'max', a.max, 1);
      break;
    case 'browser_click':
      if (a.ref != null) a.ref = asInt(name, 'ref', a.ref, 0);
      if (a.x != null) a.x = asInt(name, 'x', a.x);
      if (a.y != null) a.y = asInt(name, 'y', a.y);
      break;
    case 'browser_type':
      if (a.ref != null) a.ref = asInt(name, 'ref', a.ref, 0);
      if (a.text == null) throw paramError(name, 'text', 'expected text to type', a.text);
      a.text = String(a.text);
      if (a.submit != null) a.submit = asBool(name, 'submit', a.submit);
      break;
    case 'browser_press':
      if (a.key != null) a.key = asNonEmptyString(name, 'key', a.key);
      break;
    case 'browser_wait':
      if (a.ms != null) a.ms = asInt(name, 'ms', a.ms, 1);
      if (a.timeoutMs != null) a.timeoutMs = asInt(name, 'timeoutMs', a.timeoutMs, 1);
      if (a.urlContains != null && typeof a.urlContains !== 'string') {
        throw paramError(name, 'urlContains', 'expected a string', a.urlContains);
      }
      break;
  }
  return a;
}

async function callTool(name, args) {
  const method = METHOD_OF[name];
  if (!method) return errorResult(`UNKNOWN_TOOL:${name}`);
  try {
    const r = await rpc(method, normalizeToolArgs(name, args || {}));
    if (method === 'screenshot' && r && r.base64) {
      return {
        content: [
          { type: 'image', data: r.base64, mimeType: r.mime || 'image/png' },
          { type: 'text', text: `screenshot ok (${r.bytes} bytes)` },
        ],
      };
    }
    return textResult(typeof r === 'string' ? r : JSON.stringify(r));
  } catch (err) {
    return errorResult(String((err && err.message) || err));
  }
}

// ---------------------------------------------------------------- stdio loop
const rl = readline.createInterface({ input: process.stdin, terminal: false });

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore malformed input
  }
  if (msg.method && msg.id == null) return; // notification — nothing to answer
  const id = msg.id;
  try {
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: 'Use the existing Musician browser: browser_tabs, browser_switch_tab, then browser_snapshot. Reuse the matching open tab and its login session; do not launch a separate browser. Most tools accept an optional tabId to pin one call; otherwise they use the active tab. If there is no tab, ask the user to open one in Musician. If a CAPTCHA or verification challenge appears, let the user complete it in that tab before continuing.',
        },
      });
    } else if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (msg.method === 'tools/call') {
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      send({ jsonrpc: '2.0', id, result: await callTool(name, args) });
    } else if (msg.method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  } catch (err) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: String((err && err.message) || err) } });
  }
});
