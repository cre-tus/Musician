'use strict';
// Register musician-browser in the Muse CLI's global settings file.
//
// Why: `muse exec` (chat fallback) and a user terminal accept no per-run MCP
// flags — session/start config only exists on the MSP wire. The settings file
// is the only channel, so registration must be explicit (a Settings button,
// never automatic) and surgical: preserve every other key, refuse foreign
// same-name entries, and never silently overwrite corrupt JSON.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER_NAME = 'musician-browser';

function resolveCliSettingsPath(env, homedir) {
  const e = env || process.env;
  const home = homedir || os.homedir();
  const root = (e.XDG_CONFIG_HOME && String(e.XDG_CONFIG_HOME).trim()) || path.join(home, '.config');
  return path.join(root, 'muse', 'settings.json');
}

// CLI stdio entry. The command is the app executable itself with
// ELECTRON_RUN_AS_NODE so no separate Node install is required.
function musicianBrowserEntry({ command, serverFile, bridgeFile }) {
  return {
    type: 'stdio',
    command: String(command),
    args: [String(serverFile)],
    env: { ELECTRON_RUN_AS_NODE: '1', MUSICIAN_BRIDGE_FILE: String(bridgeFile) },
    mode: 'optional',
  };
}

// Paste-ready `"musician-browser": {...}` block for manual registration.
function settingsBlockText(entry) {
  return `${JSON.stringify(SERVER_NAME)}: ${JSON.stringify(entry || {}, null, 2)}`;
}

function isOwnEntry(v) {
  if (!v || typeof v !== 'object' || v.type !== 'stdio') return false;
  const args = Array.isArray(v.args) ? v.args : [];
  const env = v.env && typeof v.env === 'object' ? v.env : {};
  return (
    args.some((a) => String(a).replace(/\\/g, '/').endsWith('browser-mcp/server.js')) &&
    env.ELECTRON_RUN_AS_NODE === '1' &&
    typeof env.MUSICIAN_BRIDGE_FILE === 'string'
  );
}

function deepEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function readSettingsDoc(file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, status: 'invalid-json' };
    return { ok: true, doc, existed: true };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, doc: { schema_version: 1 }, existed: false };
    if (err instanceof SyntaxError) return { ok: false, status: 'invalid-json' };
    return { ok: false, status: 'unreadable' };
  }
}

// Legacy key: the CLI loader drops the whole MCP member when both keys are
// present, so fold legacy entries into mcpServers and remove the old key.
function foldLegacyServers(doc) {
  if (doc.mcp_servers && typeof doc.mcp_servers === 'object' && !Array.isArray(doc.mcp_servers)) {
    if (!doc.mcpServers || typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers)) doc.mcpServers = {};
    for (const [k, v] of Object.entries(doc.mcp_servers)) {
      if (!(k in doc.mcpServers)) doc.mcpServers[k] = v;
    }
    delete doc.mcp_servers;
  }
  if (!doc.mcpServers || typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers)) doc.mcpServers = {};
  return doc.mcpServers;
}

function classifyRegistration(current, entry) {
  if (current === undefined) return 'missing';
  if (deepEqual(current, entry)) return 'current';
  if (isOwnEntry(current)) return 'stale-update'; // own install, moved path
  return 'name-taken';
}

// Read-only: how does the settings file compare to this install's entry?
// Never writes. Returns current|stale-update|missing|name-taken|invalid-json|unreadable.
function registrationStatus(settingsPath, entry) {
  const read = readSettingsDoc(String(settingsPath));
  if (!read.ok) return read.status;
  return classifyRegistration(foldLegacyServers(read.doc)[SERVER_NAME], entry);
}

// Merge entry into settingsPath. Returns { status, path } where status is
// created|added|already-registered|updated|name-taken|invalid-json|write-failed.
function registerMcpServer(settingsPath, entry) {
  const file = String(settingsPath);
  const read = readSettingsDoc(file);
  if (!read.ok) return { status: 'invalid-json', path: file };
  const servers = foldLegacyServers(read.doc);
  const verdict = classifyRegistration(servers[SERVER_NAME], entry);
  if (verdict === 'current') return { status: 'already-registered', path: file };
  if (verdict === 'name-taken') return { status: 'name-taken', path: file };
  servers[SERVER_NAME] = entry;
  const status = verdict === 'missing' ? (read.existed ? 'added' : 'created') : 'updated';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmpFile = `${file}.musician-tmp-${process.pid}`;
    fs.writeFileSync(tmpFile, JSON.stringify(read.doc, null, 2));
    JSON.parse(fs.readFileSync(tmpFile, 'utf8')); // reread before replacing
    fs.renameSync(tmpFile, file);
  } catch {
    try {
      fs.unlinkSync(`${file}.musician-tmp-${process.pid}`);
    } catch {
      /* best effort */
    }
    return { status: 'write-failed', path: file };
  }
  return { status, path: file };
}

module.exports = { SERVER_NAME, resolveCliSettingsPath, musicianBrowserEntry, settingsBlockText, registerMcpServer, registrationStatus };
