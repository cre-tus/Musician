'use strict';
// Project diagnostics: CLI, Git, auth token, MCP bridge file, and per-project
// verify commands in one pass. Fact gathering takes injected dependencies so
// unit tests never spawn processes; summarizeDiagnose is pure and renders
// the DiagItem list the renderer shows. Tested in tests/diagnose-test.mjs.
const PROBE_TIMEOUT_MS = 12000;
const VERSION_LINE_MAX = 120;

function probeVersion(spawnFn, file, args, cwd) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try {
        clearTimeout(timer);
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    let child;
    try {
      child = spawnFn(file, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: String((err && err.message) || err) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (child && child.exitCode === null) child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish({ ok: false, error: 'TIMEOUT' });
    }, PROBE_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    if (!child || !child.stdout || typeof child.stdout.on !== 'function') {
      finish({ ok: false, error: 'SPAWN_FAILED' });
      return;
    }
    child.stdout.on('data', (d) => {
      out += String(d);
      if (out.length > 2000) out = out.slice(-2000);
    });
    child.on('error', (err) => finish({ ok: false, error: String((err && err.message) || err) }));
    child.on('close', (code) => {
      const line = out.split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
      if (code === 0 && line) finish({ ok: true, version: line.slice(0, VERSION_LINE_MAX) });
      else finish({ ok: false, error: `exit ${code}` });
    });
  });
}

async function gatherDiagnose(deps) {
  const d = deps || {};
  const facts = { cli: { ok: false }, git: { ok: false }, token: false, mcp: { ok: false }, verify: null };
  try {
    if (typeof d.resolveCli === 'function' && typeof d.spawnFn === 'function') {
      const resolved = d.resolveCli((d.settings && d.settings.cliPath) || '');
      const path = resolved && resolved.path ? String(resolved.path) : 'muse';
      const r = await probeVersion(d.spawnFn, path, ['--version'], undefined);
      facts.cli = r.ok ? { ok: true, path, version: r.version } : { ok: false, path, error: r.error };
    }
  } catch (err) {
    facts.cli = { ok: false, error: String((err && err.message) || err) };
  }
  try {
    if (typeof d.spawnFn === 'function') {
      const r = await probeVersion(d.spawnFn, 'git', ['--version'], undefined);
      facts.git = r.ok ? { ok: true, version: r.version } : { ok: false, error: r.error };
    }
  } catch (err) {
    facts.git = { ok: false, error: String((err && err.message) || err) };
  }
  try {
    facts.token = !!(d.settings && String(d.settings.githubToken || '').trim());
  } catch {
    facts.token = false;
  }
  try {
    const root = String((d && d.root) || '');
    const serverFile = root ? require('node:path').join(root, 'browser-mcp', 'server.js') : '';
    let fileOk = false;
    try {
      fileOk = !!serverFile && typeof d.isFile === 'function' ? d.isFile(serverFile) : false;
    } catch {
      fileOk = false;
    }
    facts.mcp = { ok: fileOk, servers: (d.settings && d.settings.browserAgent) ? 1 : 0, file: serverFile };
  } catch (err) {
    facts.mcp = { ok: false, error: String((err && err.message) || err) };
  }
  try {
    if (d.cwd && typeof d.readPackageScripts === 'function') {
      const scripts = await d.readPackageScripts(d.cwd);
      facts.verify = { scripts: Array.isArray(scripts) ? scripts : [] };
    } else {
      facts.verify = null;
    }
  } catch (err) {
    facts.verify = { scripts: [], error: String((err && err.message) || err) };
  }
  return facts;
}

function summarizeDiagnose(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const items = [];
  if (f.cli && f.cli.ok) items.push({ id: 'cli', ok: true, detail: `${f.cli.path} · ${f.cli.version || ''}`.trim() });
  else items.push({ id: 'cli', ok: false, detail: String((f.cli && (f.cli.error || f.cli.path)) || 'CLI_NOT_FOUND') });
  if (f.git && f.git.ok) items.push({ id: 'git', ok: true, detail: String(f.git.version || 'git') });
  else items.push({ id: 'git', ok: false, detail: String((f.git && f.git.error) || 'GIT_NOT_FOUND') });
  items.push({ id: 'auth', ok: !!f.token, detail: f.token ? 'TOKEN_SET' : 'TOKEN_MISSING' });
  if (f.mcp && f.mcp.ok) items.push({ id: 'mcp', ok: true, detail: `BROWSER_MCP_OK${f.mcp.servers ? '' : ' · AGENT_OFF'}` });
  else items.push({ id: 'mcp', ok: false, detail: String((f.mcp && (f.mcp.error || f.mcp.file)) || 'MCP_FILE_MISSING') });
  if (!f.verify) items.push({ id: 'verify', ok: true, detail: 'NO_PROJECT' });
  else if (Array.isArray(f.verify.scripts) && f.verify.scripts.length > 0) {
    items.push({ id: 'verify', ok: true, detail: f.verify.scripts.slice(0, 8).join(', ') });
  } else {
    items.push({ id: 'verify', ok: false, detail: String(f.verify.error || 'NO_SCRIPTS') });
  }
  return items;
}

module.exports = { gatherDiagnose, probeVersion, summarizeDiagnose };
