'use strict';
// TerminalHost verification with a real shell (echo round trip).
// Exit 0 = ALL PASS.
const assert = require('node:assert/strict');
const os = require('node:os');
const { TerminalHost } = require('../../electron/terminal');

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT:${what}`)), ms))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const events = [];
  const host = new TerminalHost({ send: (ch, p) => events.push({ ch, p }) });

  // 1. start + echo round trip
  const started = host.start({ tabId: 'term-1', shell: 'cmd', cwd: os.tmpdir() });
  assert.equal(started.ok, true, `start ok: ${JSON.stringify(started)}`);
  assert.equal(host.running('term-1'), true);
  assert.equal(host.start({ tabId: 'term-1', shell: 'cmd' }).restarted, false);
  const w = host.input({ tabId: 'term-1', text: 'echo term-ok-123\r\n' });
  assert.equal(w.ok, true);

  let seen = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    seen = events
      .filter((e) => e.ch === 'term:event' && e.p.tabId === 'term-1' && e.p.type === 'output')
      .map((e) => e.p.text)
      .join('');
    if (seen.includes('term-ok-123')) break;
    await sleep(100);
  }
  assert.ok(seen.includes('term-ok-123'), `echoed output, got: ${JSON.stringify(seen.slice(-300))}`);
  console.log('ok - start + echo round trip');

  // 2. unknown tab errors
  assert.equal(host.input({ tabId: 'term-9', text: 'x' }).error, 'NOT_RUNNING');
  assert.equal(host.kill({ tabId: 'term-9' }).error, 'NOT_RUNNING');
  console.log('ok - unknown tab errors');

  // 3. kill → exit event
  assert.equal(host.kill({ tabId: 'term-1' }).ok, true);
  assert.equal(host.running('term-1'), false);
  let exited = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 10000) {
    exited = events.find((e) => e.ch === 'term:event' && e.p.tabId === 'term-1' && e.p.type === 'exit');
    if (exited) break;
    await sleep(100);
  }
  assert.ok(exited, 'exit event after kill');
  console.log('ok - kill + exit event');

  // 4. shell-generation seq: kill -> start tags the late old exit stale,
  // new events carry the new seq (renderer ignores mismatched seq).
  const { EventEmitter } = require('node:events');
  const kids = [];
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => true };
    child.exitCode = null;
    child.pid = 424242 + kids.length;
    kids.push(child);
    return child;
  };
  const ev2 = [];
  const host2 = new TerminalHost({ send: (_ch, p) => ev2.push(p), spawnFn: fakeSpawn });
  const r1 = host2.start({ tabId: 'seq-1', shell: 'cmd', cwd: os.tmpdir(), seq: 5 });
  assert.equal(r1.seq, 5, `start echoes seq: ${JSON.stringify(r1)}`);
  const rDup = host2.start({ tabId: 'seq-1', shell: 'cmd', seq: 6 });
  assert.equal(rDup.seq, 5, `existing entry returns live seq: ${JSON.stringify(rDup)}`);
  assert.equal(host2.kill({ tabId: 'seq-1' }).ok, true);
  const r2 = host2.start({ tabId: 'seq-1', shell: 'cmd', seq: 6 });
  assert.equal(r2.seq, 6, `restarted entry takes new seq: ${JSON.stringify(r2)}`);
  kids[0].emit('close', 1); // old shell's late exit
  kids[1].stdout.emit('data', Buffer.from('new-shell-out'));
  const exits = ev2.filter((e) => e.type === 'exit');
  assert.equal(exits.length, 1, `one exit event: ${JSON.stringify(ev2)}`);
  assert.equal(exits[0].seq, 5, 'late old exit keeps old seq (stale)');
  assert.ok(ev2.filter((e) => e.type === 'output').every((e) => e.seq === 6), 'new output carries new seq');
  assert.equal(exits.filter((e) => e.seq === 6).length, 0, 'renderer rule: current gen ignores stale exit');
  const r3 = host2.start({ tabId: 'seq-2', shell: 'cmd' });
  assert.equal(r3.seq, 0, 'missing seq defaults to 0');
  console.log('ok - shell-generation seq tags stale exits');

  await withTimeout(host.shutdown(), 10000, 'shutdown');
  console.log('TERM MOCK TEST: ALL PASS');
})().catch((e) => {
  console.error('TERM MOCK TEST: FAIL', e);
  process.exit(1); // live child pipes would keep the loop alive forever
});
