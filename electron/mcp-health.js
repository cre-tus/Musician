'use strict';
// Pre-flight health for session MCP servers.
//
// Real hosts stay silent when an OPTIONAL MCP server fails to start: the
// session opens and turns complete, but the model never sees the tools.
// This check runs before session construction so failures surface in the
// UI/logs (msp:mcp-health) instead of vanishing. It never edits the config:
// removing a server here could desync the loaded session runtime.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function fetchBridgeHealth(port, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      req.destroy();
      resolve({ ok: false, reason: 'BRIDGE_HEALTH_TIMEOUT' });
    }, timeoutMs);
    if (timer.unref) timer.unref();
    const req = http.get(
      { host: '127.0.0.1', port, path: '/health', timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (body && body.ok === true && body.app === 'musician-browser') return resolve({ ok: true });
            return resolve({ ok: false, reason: 'BRIDGE_HEALTH_BAD_RESPONSE' });
          } catch {
            return resolve({ ok: false, reason: 'BRIDGE_HEALTH_BAD_RESPONSE' });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, reason: 'BRIDGE_HEALTH_TIMEOUT' });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: err && err.code === 'ECONNREFUSED' ? 'BRIDGE_UNREACHABLE' : `BRIDGE_ERROR:${(err && err.code) || err}` });
    });
  });
}

// servers: Object.entries(config.mcpServers). opts: { root, connectionPath, timeoutMs? }.
// Returns [{ name, ok, reason|null }]. Unknown servers pass: the host decides.
async function checkMcpServerHealth(servers, opts) {
  const o = opts || {};
  const out = [];
  for (const [name, s] of servers || []) {
    if (name !== 'musician-browser') {
      out.push({ name, ok: true, reason: null });
      continue;
    }
    const serverFile = path.join(o.root || '', 'browser-mcp', 'server.js');
    if (!isFile(serverFile)) {
      out.push({ name, ok: false, reason: `MCP_SERVER_FILE_MISSING:${serverFile}` });
      continue;
    }
    const cmd = s && s.command;
    if (cmd && path.isAbsolute(cmd) && !isFile(cmd)) {
      out.push({ name, ok: false, reason: `MCP_COMMAND_NOT_FOUND:${cmd}` });
      continue;
    }
    const bridgeFile = (s && s.env && s.env.MUSICIAN_BRIDGE_FILE) || o.connectionPath;
    let info = null;
    try {
      info = JSON.parse(fs.readFileSync(bridgeFile, 'utf8'));
    } catch {
      info = null;
    }
    if (!info || !info.port || !info.token) {
      out.push({ name, ok: false, reason: `BRIDGE_FILE_MISSING:${bridgeFile}` });
      continue;
    }
    const live = await fetchBridgeHealth(info.port, o.timeoutMs || 1500);
    if (!live.ok) {
      out.push({ name, ok: false, reason: `${live.reason}:127.0.0.1:${info.port}` });
      continue;
    }
    out.push({ name, ok: true, reason: null });
  }
  return out;
}

module.exports = { checkMcpServerHealth };
