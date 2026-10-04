'use strict';
// Pre-flight MCP health checks. Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { checkMcpServerHealth } = require('../electron/mcp-health');

const ROOT = path.join(__dirname, '..'); // has browser-mcp/server.js
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-mcp-health-'));
let serverPort = 0;

function startStub(body, status = 200) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
    srv.listen(0, '127.0.0.1', () => {
      serverPort = srv.address().port;
      resolve(srv);
    });
  });
}

(async () => {
  // 1. unknown servers pass through (the host decides).
  const passthrough = await checkMcpServerHealth([['other-server', { transport: 'stdio', command: 'x' }]], { root: ROOT });
  assert.deepEqual(passthrough, [{ name: 'other-server', ok: true, reason: null }]);

  // 2. missing server.js in the app root.
  const missingRoot = await checkMcpServerHealth(
    [['musician-browser', { transport: 'stdio', command: 'node', env: {} }]],
    { root: tmp, connectionPath: path.join(tmp, 'no-bridge.json') },
  );
  assert.equal(missingRoot[0].ok, false);
  assert.ok(missingRoot[0].reason.startsWith('MCP_SERVER_FILE_MISSING:'), missingRoot[0].reason);

  // 3. absolute command that does not exist.
  const badCmd = await checkMcpServerHealth(
    [['musician-browser', { transport: 'stdio', command: path.join(tmp, 'no-such.exe'), env: {} }]],
    { root: ROOT, connectionPath: path.join(tmp, 'no-bridge.json') },
  );
  assert.equal(badCmd[0].ok, false);
  assert.ok(badCmd[0].reason.startsWith('MCP_COMMAND_NOT_FOUND:'), badCmd[0].reason);

  // 4. bridge file missing.
  const noBridge = await checkMcpServerHealth(
    [['musician-browser', { transport: 'stdio', command: 'node', env: {} }]],
    { root: ROOT, connectionPath: path.join(tmp, 'no-bridge.json') },
  );
  assert.equal(noBridge[0].ok, false);
  assert.ok(noBridge[0].reason.startsWith('BRIDGE_FILE_MISSING:'), noBridge[0].reason);

  // 5. bridge file present but nothing listening.
  const deadBridge = path.join(tmp, 'dead-bridge.json');
  fs.writeFileSync(deadBridge, JSON.stringify({ port: 9, token: 't', pid: 1 }));
  const dead = await checkMcpServerHealth(
    [['musician-browser', { transport: 'stdio', command: 'node', env: { MUSICIAN_BRIDGE_FILE: deadBridge } }]],
    { root: ROOT, timeoutMs: 800 },
  );
  assert.equal(dead[0].ok, false);
  assert.ok(dead[0].reason.startsWith('BRIDGE_UNREACHABLE:'), dead[0].reason);

  // 6. bridge answers /health correctly.
  const goodBridge = path.join(tmp, 'good-bridge.json');
  const goodSrv = await startStub({ ok: true, app: 'musician-browser' });
  fs.writeFileSync(goodBridge, JSON.stringify({ port: serverPort, token: 't', pid: process.pid }));
  const good = await checkMcpServerHealth(
    [['musician-browser', { transport: 'stdio', command: 'node', env: { MUSICIAN_BRIDGE_FILE: goodBridge } }]],
    { root: ROOT },
  );
  assert.deepEqual(good, [{ name: 'musician-browser', ok: true, reason: null }]);
  await new Promise((r) => goodSrv.close(r));

  // 7. bridge answers with a wrong shape.
  const badBridge = path.join(tmp, 'bad-bridge.json');
  const badSrv = await startStub({ ok: true, app: 'something-else' });
  fs.writeFileSync(badBridge, JSON.stringify({ port: serverPort, token: 't', pid: process.pid }));
  const bad = await checkMcpServerHealth(
    [['musician-browser', { transport: 'stdio', command: 'node', env: { MUSICIAN_BRIDGE_FILE: badBridge } }]],
    { root: ROOT },
  );
  assert.equal(bad[0].ok, false);
  assert.ok(bad[0].reason.startsWith('BRIDGE_HEALTH_BAD_RESPONSE'), bad[0].reason);
  await new Promise((r) => badSrv.close(r));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('MCP health pre-flight checks passed.');
})().catch((e) => {
  console.error('MCP HEALTH TEST: FAIL', e);
  process.exitCode = 1;
});
