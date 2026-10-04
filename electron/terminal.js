// Terminal tabs: one interactive-ish shell per tab, spawned with pipes
// (no PTY — full-screen TUI apps won't work, plain commands stream fine).
// Plain JS — no build step. The spawn function is injectable for tests.
'use strict';

const { spawn } = require('node:child_process');

const SHELLS = {
  powershell: { file: 'powershell.exe', args: ['-NoLogo'] },
  cmd: { file: 'cmd.exe', args: ['/q'] },
};

class TerminalHost {
  constructor({ send, spawnFn }) {
    this.send = send;
    this.spawnFn = spawnFn || spawn;
    this.terms = new Map(); // tabId -> { child, shell, cwd }
  }

  start({ tabId, shell, cwd, seq }) {
    const id = String(tabId || '');
    if (!id) return { ok: false, error: 'NO_TAB' };
    const live = this.terms.get(id);
    if (live) return { ok: true, restarted: false, shell: live.shell, seq: live.seq };
    const name = shell === 'cmd' ? 'cmd' : 'powershell';
    const gen = Number.isFinite(seq) ? seq : 0;
    const spec = SHELLS[name];
    let child;
    try {
      child = this.spawnFn(spec.file, spec.args, {
        cwd: cwd || undefined,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
    this.terms.set(id, { child, shell: name, cwd: cwd || '', seq: gen });
    child.stdout.on('data', (d) => this.emit({ type: 'output', tabId: id, text: d.toString(), seq: gen }));
    child.stderr.on('data', (d) => this.emit({ type: 'output', tabId: id, text: d.toString(), seq: gen }));
    child.on('error', (err) => {
      if (this.terms.get(id)?.child === child) this.terms.delete(id);
      this.emit({ type: 'exit', tabId: id, code: null, error: String((err && err.message) || err), seq: gen });
    });
    child.on('close', (code) => {
      if (this.terms.get(id)?.child === child) this.terms.delete(id);
      this.emit({ type: 'exit', tabId: id, code, seq: gen });
    });
    return { ok: true, restarted: false, shell: name, seq: gen };
  }

  input({ tabId, text }) {
    const t = this.terms.get(String(tabId || ''));
    if (!t || !t.child.stdin || t.child.exitCode !== null) return { ok: false, error: 'NOT_RUNNING' };
    try {
      t.child.stdin.write(String(text == null ? '' : text));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  kill({ tabId }) {
    const id = String(tabId || '');
    const t = this.terms.get(id);
    if (!t) return { ok: false, error: 'NOT_RUNNING' };
    this.terms.delete(id);
    killTree(t.child);
    return { ok: true };
  }

  running(tabId) {
    return this.terms.has(String(tabId || ''));
  }

  emit(ev) {
    try {
      this.send('term:event', ev);
    } catch {
      /* renderer gone */
    }
  }

  async shutdown() {
    for (const [, t] of this.terms) {
      try {
        killTree(t.child);
      } catch {
        /* ignore */
      }
    }
    this.terms.clear();
  }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } catch {
      /* best effort */
    }
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      /* best effort */
    }
  }
}

module.exports = { TerminalHost };
