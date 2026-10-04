'use strict';
// CLI global settings registration for the exec/terminal path.
// `muse exec` takes no per-run MCP flags: the only way its model sees the
// browser tools is an mcpServers entry in the CLI settings file. Registration
// is explicit (Settings button) and surgical — never a blind overwrite.
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SERVER_NAME,
  resolveCliSettingsPath,
  musicianBrowserEntry,
  settingsBlockText,
  registerMcpServer,
  registrationStatus,
} = require('../electron/mcp-register');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-mcp-register-'));
const ENTRY = { command: 'C:\\app\\Musician.exe', serverFile: 'C:\\app\\resources\\browser-mcp\\server.js', bridgeFile: 'C:\\data\\browser-bridge.json' };

(async () => {
  // 1. settings path resolution: XDG wins, else ~/.config.
  assert.equal(
    resolveCliSettingsPath({ XDG_CONFIG_HOME: 'X:\\cfg' }, 'H:\\home'),
    path.join('X:\\cfg', 'muse', 'settings.json'),
  );
  assert.equal(
    resolveCliSettingsPath({}, 'H:\\home'),
    path.join('H:\\home', '.config', 'muse', 'settings.json'),
  );

  // 2. entry shape: CLI stdio schema, Electron-as-node, optional mode.
  const entry = musicianBrowserEntry(ENTRY);
  assert.deepEqual(entry, {
    type: 'stdio',
    command: ENTRY.command,
    args: [ENTRY.serverFile],
    env: { ELECTRON_RUN_AS_NODE: '1', MUSICIAN_BRIDGE_FILE: ENTRY.bridgeFile },
    mode: 'optional',
  });

  // 3. paste-ready block parses back to the same entry.
  const block = settingsBlockText(entry);
  assert.deepEqual(JSON.parse(`{${block}}`)[SERVER_NAME], entry);

  // 4. missing file is created; other keys preserved on later merges.
  const p1 = path.join(tmp, 'fresh', 'settings.json');
  const created = registerMcpServer(p1, entry);
  assert.equal(created.status, 'created');
  assert.equal(created.path, p1);
  const doc1 = JSON.parse(fs.readFileSync(p1, 'utf8'));
  assert.equal(doc1.schema_version, 1);
  assert.deepEqual(doc1.mcpServers[SERVER_NAME], entry);

  // 5. identical entry is a no-op (no rewrite).
  const before = fs.readFileSync(p1, 'utf8');
  const again = registerMcpServer(p1, entry);
  assert.equal(again.status, 'already-registered');
  assert.equal(fs.readFileSync(p1, 'utf8'), before);

  // 6. other servers and settings survive the merge.
  const p2 = path.join(tmp, 'merge', 'settings.json');
  fs.mkdirSync(path.dirname(p2), { recursive: true });
  fs.writeFileSync(p2, JSON.stringify({ schema_version: 1, provider: 'meta', mcpServers: { other: { type: 'stdio', command: 'x' } } }));
  const merged = registerMcpServer(p2, entry);
  assert.equal(merged.status, 'added');
  const doc2 = JSON.parse(fs.readFileSync(p2, 'utf8'));
  assert.equal(doc2.provider, 'meta');
  assert.deepEqual(doc2.mcpServers.other, { type: 'stdio', command: 'x' });
  assert.deepEqual(doc2.mcpServers[SERVER_NAME], entry);

  // 7. legacy mcp_servers key is renamed, keeping its entries.
  const p3 = path.join(tmp, 'legacy', 'settings.json');
  fs.mkdirSync(path.dirname(p3), { recursive: true });
  fs.writeFileSync(p3, JSON.stringify({ schema_version: 1, mcp_servers: { legacy: { type: 'stdio', command: 'y' } } }));
  const renamed = registerMcpServer(p3, entry);
  assert.equal(renamed.status, 'added');
  const doc3 = JSON.parse(fs.readFileSync(p3, 'utf8'));
  assert.equal('mcp_servers' in doc3, false);
  assert.deepEqual(doc3.mcpServers.legacy, { type: 'stdio', command: 'y' });
  assert.deepEqual(doc3.mcpServers[SERVER_NAME], entry);

  // 8. stale own entry (moved install) is updated; foreign same-name is refused.
  const p4 = path.join(tmp, 'stale', 'settings.json');
  fs.mkdirSync(path.dirname(p4), { recursive: true });
  const stale = musicianBrowserEntry({ command: 'D:\\old\\Musician.exe', serverFile: 'D:\\old\\resources\\browser-mcp\\server.js', bridgeFile: 'D:\\old\\bridge.json' });
  fs.writeFileSync(p4, JSON.stringify({ schema_version: 1, mcpServers: { [SERVER_NAME]: stale } }));
  const updated = registerMcpServer(p4, entry);
  assert.equal(updated.status, 'updated');
  assert.deepEqual(JSON.parse(fs.readFileSync(p4, 'utf8')).mcpServers[SERVER_NAME], entry);

  const p5 = path.join(tmp, 'taken', 'settings.json');
  fs.mkdirSync(path.dirname(p5), { recursive: true });
  fs.writeFileSync(p5, JSON.stringify({ schema_version: 1, mcpServers: { [SERVER_NAME]: { type: 'streamable-http', url: 'https://x/y' } } }));
  const refused = registerMcpServer(p5, entry);
  assert.equal(refused.status, 'name-taken');
  assert.deepEqual(JSON.parse(fs.readFileSync(p5, 'utf8')).mcpServers[SERVER_NAME], { type: 'streamable-http', url: 'https://x/y' });

  // 9. corrupt JSON is an error, never a silent overwrite.
  const p6 = path.join(tmp, 'corrupt', 'settings.json');
  fs.mkdirSync(path.dirname(p6), { recursive: true });
  fs.writeFileSync(p6, '{not json');
  const bad = registerMcpServer(p6, entry);
  assert.equal(bad.status, 'invalid-json');
  assert.equal(fs.readFileSync(p6, 'utf8'), '{not json');

  // 10. read-only status: current after registering, missing on fresh files.
  const q1 = path.join(tmp, 'status-current', 'settings.json');
  assert.equal(registrationStatus(q1, entry), 'missing');
  assert.equal(registerMcpServer(q1, entry).status, 'created');
  assert.equal(registrationStatus(q1, entry), 'current');

  // 11. moved installs report stale-update; foreign same-name reports name-taken.
  const q2 = path.join(tmp, 'status-stale', 'settings.json');
  fs.mkdirSync(path.dirname(q2), { recursive: true });
  fs.writeFileSync(q2, JSON.stringify({ schema_version: 1, mcpServers: { [SERVER_NAME]: stale } }));
  assert.equal(registrationStatus(q2, entry), 'stale-update');
  assert.equal(registrationStatus(p5, entry), 'name-taken');

  // 12. status never writes: corrupt files stay corrupt, bytes untouched.
  assert.equal(registrationStatus(p6, entry), 'invalid-json');
  const beforeQ2 = fs.readFileSync(q2, 'utf8');
  registrationStatus(q2, entry);
  assert.equal(fs.readFileSync(q2, 'utf8'), beforeQ2);

  console.log('ok - mcp-register (12 cases)');
})();
