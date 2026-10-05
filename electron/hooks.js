// Hook runner (main process): executes user shell commands for turn events.
// Bounded (timeout kill), output-capped, context env (MUSICIAN_*), never
// throws — results are data, failures never block the turn.
'use strict';

const { spawn } = require('node:child_process');

const HOOK_OUTPUT_MAX = 4096;

function tail(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(-n) : t;
}

function runHook({ command, cwd, timeoutSec, env }) {
  return new Promise((resolve) => {
    const cmd = String(command || '').trim();
    if (!cmd) {
      resolve({ ok: false, error: 'EMPTY_COMMAND' });
      return;
    }
    const timeoutMs = Math.min(120, Math.max(5, Math.floor(Number(timeoutSec) || 30))) * 1000;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    let child;
    try {
      child = spawn(cmd, {
        cwd: cwd || undefined,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(env || {}) },
      });
    } catch (err) {
      done({ ok: false, error: String((err && err.message) || err) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      done({ ok: false, error: 'TIMEOUT', timedOut: true, stdout: tail(stdout, HOOK_OUTPUT_MAX), stderr: tail(stderr, HOOK_OUTPUT_MAX) });
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ ok: false, error: String((err && err.message) || err) });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        done({ ok: true, code: 0, stdout: tail(stdout, HOOK_OUTPUT_MAX), stderr: tail(stderr, HOOK_OUTPUT_MAX) });
      } else {
        done({
          ok: false,
          code: code == null ? null : code,
          signal: signal || null,
          error: code == null ? `SIGNAL:${signal || '?'}` : `EXIT:${code}`,
          stdout: tail(stdout, HOOK_OUTPUT_MAX),
          stderr: tail(stderr, HOOK_OUTPUT_MAX),
        });
      }
    });
  });
}

// Sequential: hooks for one event run in list order so side effects compose.
async function runHooks(hooks, ctx) {
  const results = [];
  const list = Array.isArray(hooks) ? hooks : [];
  for (const h of list) {
    if (!h || h.enabled === false || !String(h.command || '').trim()) continue;
    const env = {
      MUSICIAN_EVENT: String((ctx && ctx.event) || ''),
      MUSICIAN_CWD: String((ctx && ctx.cwd) || ''),
      MUSICIAN_ENGINE: String((ctx && ctx.engine) || ''),
      MUSICIAN_REQ_ID: String((ctx && ctx.reqId) || ''),
    };
    try {
      const r = await runHook({ command: h.command, cwd: (ctx && ctx.cwd) || undefined, timeoutSec: h.timeoutSec, env });
      results.push({ command: String(h.command).slice(0, 120), ...r });
    } catch (err) {
      results.push({ command: String(h.command).slice(0, 120), ok: false, error: String((err && err.message) || err) });
    }
  }
  return results;
}

module.exports = { HOOK_OUTPUT_MAX, runHook, runHooks };
