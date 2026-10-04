// Mudex main process (plain JS — no build step for electron/ sources).
//
// Architecture: Mudex UI -> spawn `muse exec` (Muse Code CLI, headless)
// -> stream stdout/stderr back to the UI over IPC.
// Chat therefore uses the CLI's own login/subscription. No API keys in Mudex.
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Notification, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const crypto = require('node:crypto');
const { MspEngine } = require('./msp');
const { checkMcpServerHealth } = require('./mcp-health');
const { musicianBrowserEntry, registerMcpServer, registrationStatus, resolveCliSettingsPath, settingsBlockText } = require('./mcp-register');
const { applyStateSet, loadRendererState, saveRendererState } = require('./renderer-state');
const { pickDialogResult } = require('./pick-dialog');
const { exportMarkdownFilename } = require('./export-markdown');
const { loadWindowState, saveWindowState, restoreBounds } = require('./window-state');
const { checkPreviousExit, markClean, markRunning } = require('./exit-marker');
const { needsShell, quoteArg, spawnCli } = require('./spawn-cli');
const { appendMainLog: appendLogFile } = require('./main-log');
const { BrowserEngine, resolveAddressInput } = require('./browser');
const { TerminalHost } = require('./terminal');
const { searchFiles, searchInFiles } = require('./workspace-search');
const { WorkspaceWatcher } = require('./workspace-watcher');
const { normalizeExternalLink } = require('./external-link');
const { isSafeCloneSource, isSafeRepoRelativePath, redactRemoteUrl } = require('./git-safety');
const { createProjectSessionCache } = require('./codex-session-cache');
const { createProjectPathMatcher } = require('./project-path');
const { showWindowsToastAsync } = require('../scripts/windows-toast');

let win = null;
const DEV_URL = 'http://127.0.0.1:5173';
const running = new Map(); // reqId -> ChildProcess
const promptFiles = new Map(); // reqId -> prompt tmp file (shell path only)
const msp = new MspEngine({ send, version: app.getVersion(), getSessionConfig: async () => {
  if (!browser.isAgentEnabled()) return undefined;
  await browser.startBridge();
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return { mcpServers: { 'musician-browser': {
    transport: 'stdio',
    command: process.execPath,
    args: [path.join(root, 'browser-mcp', 'server.js')],
    env: { ELECTRON_RUN_AS_NODE: '1', MUSICIAN_BRIDGE_FILE: browser.connectionPath() },
    framing: 'lineDelimitedJson',
    mode: 'optional',
  } } };
},
// Optional MCP servers fail silently on the host, so verify ours before the
// session opens. Unhealthy entries are logged here and published over
// msp:mcp-health; the session still starts (optional), and the UI badge (P2)
// consumes the same signal.
preflightSessionConfig: async (config) => {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const health = await checkMcpServerHealth(Object.entries((config && config.mcpServers) || {}), {
    root,
    connectionPath: browser.connectionPath(),
  });
  for (const h of health) {
    if (!h.ok) {
      console.error(`[musician] mcp pre-flight unhealthy: ${h.name} ${h.reason}`);
      appendMainLog('mcp-preflight', { name: h.name, reason: h.reason });
    }
  }
  return health;
} });
const browser = new BrowserEngine({
  getWindow: () => win,
  send,
  userDataDir: () => app.getPath('userData'),
  getSettings: () => loadSettings(),
});
const termHost = new TerminalHost({ send });
const workspaceWatcher = new WorkspaceWatcher({
  onChange: (event) => send('mudex:workspace-changed', event),
  onError: (event) => send('mudex:workspace-watch-error', event),
});
let reqSeq = 0;

// ---------------------------------------------------------------- settings
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
const DEFAULT_SETTINGS = {
  cliPath: '',
  model: '',
  extraArgs: '',
  workdir: '',
  timeoutMs: 0,
  theme: 'dark',
  codeTheme: 'auto',
  engine: 'auto',
  approvalMode: '',
  reasoningEffort: '',
  browserAgent: true,
  browserHome: '',
  backgroundNotifications: true,
  lang: 'ko',
};
function sanitizeTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}
function sanitizeLang(value) {
  return value === 'en' ? 'en' : 'ko';
}
function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    // Tolerate a BOM: Windows editors (e.g. Notepad) add one, and without the
    // strip the whole file is rejected and defaults silently take over.
    const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(raw.replace(/^\uFEFF/, '')) };
    merged.theme = sanitizeTheme(merged.theme);
    merged.lang = sanitizeLang(merged.lang);
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function persistSettings(next) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

// ---------------------------------------------------------------- window
async function waitForDevUrl(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(DEV_URL);
      if (res.ok) return true;
    } catch {
      /* dev server not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// `--dev` (npm run dev) loads the Vite server; otherwise the built dist/.
const isDev = process.argv.includes('--dev');

function isBundledFileUrl(url) {
  // Only the packaged renderer (dist/) may load in the privileged window.
  try {
    if (new URL(String(url)).protocol !== 'file:') return false;
    const distDir = path.resolve(__dirname, '..', 'dist');
    const target = path.resolve(fileURLToPath(String(url)));
    return target === distDir || target.startsWith(distDir + path.sep);
  } catch {
    return false;
  }
}

async function createWindow() {
  const fallbackBounds = { x: 100, y: 100, width: 1280, height: 860 };
  let restored = fallbackBounds;
  let startMaximized = false;
  try {
    const displays = screen.getAllDisplays().map((d) => d.workArea);
    const saved = loadWindowState(app.getPath('userData')).data;
    const restoredState = restoreBounds(saved, displays, fallbackBounds);
    restored = restoredState.bounds;
    startMaximized = restoredState.useSaved && restored.maximized === true;
  } catch {
    /* fall back to defaults */
  }
  win = new BrowserWindow({
    x: restored.x,
    y: restored.y,
    width: restored.width,
    height: restored.height,
    autoHideMenuBar: true,
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (startMaximized) win.maximize();
  // The app window carries the full IPC bridge: never let it navigate away
  // from the bundled UI (dropped files, remote URLs) or spawn windows.
  // A foreign page here would inherit window.mudex with file/shell access.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('will-navigate', (event, url) => {
    if (isDev && String(url).startsWith(DEV_URL)) return;
    if (isBundledFileUrl(url)) return;
    event.preventDefault();
  });
  const saveBounds = (reason) => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const isMax = win.isMaximized();
    const bounds = isMax ? win.getNormalBounds() : win.getBounds();
    const res = saveWindowState(app.getPath('userData'), { ...bounds, maximized: isMax });
    appendMainLog('window-state-save', { reason: reason || 'event', ok: res.ok, ...bounds });
  };
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveBounds('move/resize'); }, 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => saveBounds('close'));
  if (isDev) {
    if (await waitForDevUrl()) win.loadURL(DEV_URL);
    else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  win.webContents.on('did-fail-load', (_event, code, desc) => {
    console.error(`[musician] page load failed: ${code} ${desc}`);
  });
  win.on('closed', () => {
    win = null;
  });
}

ipcMain.handle('mudex:show-notification', async (event, payload = {}) => {
  if (!win || event.sender !== win.webContents) return { ok: false };
  const sessionTitle = typeof payload.sessionTitle === 'string' ? payload.sessionTitle.trim().slice(0, 48) : '';
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.slice(0, 160) : '';
  const status = ['success', 'failed', 'stopped', 'scheduled'].includes(payload.status) ? payload.status : 'success';
  if (!sessionId) return { ok: false };
  const notifyLang = loadSettings().lang;
  const body = notifyLang === 'en'
    ? status === 'success' ? 'Task completed.' : status === 'stopped' ? 'Task stopped.' : status === 'scheduled' ? 'Scheduled prompt ran.' : 'Task failed.'
    : status === 'success' ? '작업이 완료됐습니다.' : status === 'stopped' ? '작업이 중지됐습니다.' : status === 'scheduled' ? '예약된 프롬프트가 실행됐습니다.' : '작업이 실패했습니다.';
  if (process.platform === 'win32') {
    const toastIcon = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.ico')
      : path.join(app.getAppPath(), 'build', 'icon.ico');
    const sent = await showWindowsToastAsync(sessionTitle ? `Musician · ${sessionTitle}` : 'Musician', body, toastIcon);
    return { ok: sent === true };
  }
  if (!Notification.isSupported()) return { ok: false };
  const notification = new Notification({
    title: sessionTitle ? `Musician · ${sessionTitle}` : 'Musician',
    body,
  });
  notification.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('mudex:notification-click', { sessionId });
  });
  notification.show();
  return { ok: true };
});

// Keep the pre-rename data dir so settings/sessions survive the rebrand.
try {
  const base = app.getPath('appData');
  const legacy = ['Mudex', 'mudex']
    .map((n) => path.join(base, n))
    .find((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  app.setPath('userData', legacy || path.join(base, 'Mudex'));
} catch {
  /* use the default */
}
// Distributed builds run single-instance: a second launch focuses the
// running app instead of splitting userData between two writers.
// Dev keeps multi-instance (dev server + packaged app side by side).
let singleInstanceOk = true;
if (app.isPackaged) {
  singleInstanceOk = app.requestSingleInstanceLock();
  if (!singleInstanceOk) app.quit();
  else {
    app.on('second-instance', () => {
      try {
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      } catch {
        /* focusing is best effort */
      }
    });
  }
}
app.whenReady().then(() => {
  if (!singleInstanceOk) return;
  console.log('[musician] main ready');
  try {
    const prev = checkPreviousExit(app.getPath('userData'));
    if (prev.status === 'unclean') {
      appendMainLog('unclean-exit', { at: new Date().toISOString(), previous: prev.previous });
    }
    markRunning(app.getPath('userData'));
  } catch {
    /* diagnostics never block launch */
  }
  cleanupPastedImages();
  createWindow();
  prewarmMsp('', loadSettings(), 'startup');
  // Agent browser bridge: must never block launch.
  browser.startBridge().catch((err) => console.error('[musician] browser bridge failed:', err));
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  workspaceWatcher.closeAll();
  Promise.all([msp.shutdown().catch(() => {}), browser.shutdown().catch(() => {}), termHost.shutdown().catch(() => {})]).finally(() => app.quit());
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('will-quit', () => {
  // Synchronous: killed processes never reach here, so a missing clean
  // mark on next boot means the previous run did not quit gracefully.
  try {
    markClean(app.getPath('userData'));
  } catch {
    /* last breath */
  }
});

// ---------------------------------------------------------------- helpers
function splitArgs(s) {
  // Minimal shell-ish split honoring double quotes. Options only —
  // the prompt is always appended last by the caller.
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of String(s || '')) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function head(s, n = 4000) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Packaged apps have no visible console: MCP/bridge failures also land in
// <userData>/musician.log (JSON lines) so causes stay inspectable.
function appendMainLog(tag, obj) {
  appendLogFile(app.getPath('userData'), tag, obj);
}

// ---------------------------------------------------------------- msp prewarm
function prewarmMsp(cwd, settings, reason) {
  // Eager `muse serve` startup at launch so the first chat is already warm.
  // Must never block launch: failures are reported and lazy ensureHost retries.
  const s = settings || loadSettings();
  if ((s.engine || 'auto') === 'exec') return;
  const workdir = cwd || s.workdir || app.getPath('home');
  msp
    .ensureHost(workdir, s)
    .then((host) => send('msp:ready', { key: host.key, reason: reason || 'startup' }))
    .catch((err) => send('msp:prewarm-error', { error: String((err && err.message) || err), reason: reason || 'startup' }));
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

// ---------------------------------------------------------------- fs / dialog
ipcMain.handle('mudex:pick-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return pickDialogResult('folder', res);
});
ipcMain.handle('mudex:pick-files', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  return pickDialogResult('files', res);
});
ipcMain.handle('mudex:export-markdown', async (_e, { title: rawTitle, markdown }) => {
  try {
    if (typeof markdown !== 'string' || markdown.length > 25 * 1024 * 1024) return { ok: false, error: 'INVALID_CONTENT' };
    const exportLang = loadSettings().lang;
    const filename = exportMarkdownFilename(rawTitle, exportLang);
    const result = await dialog.showSaveDialog(win, {
      title: exportLang === 'en' ? 'Export conversation as Markdown' : '대화 Markdown으로 내보내기',
      buttonLabel: exportLang === 'en' ? 'Export' : '내보내기',
      defaultPath: path.join(app.getPath('downloads'), `${filename}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    fs.writeFileSync(result.filePath, markdown, 'utf8');
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
const FILE_PREVIEW_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
};
const PASTED_IMAGE_TYPES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};
function pastedImagesDir() {
  return path.join(app.getPath('temp'), 'Musician', 'pasted-images');
}
function cleanupPastedImages() {
  try {
    const dir = pastedImagesDir();
    const staleBefore = Date.now() - 48 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(dir, entry.name);
      if (fs.statSync(fullPath).mtimeMs < staleBefore) fs.unlinkSync(fullPath);
    }
  } catch {
    /* no temp images yet or cleanup unavailable */
  }
}
ipcMain.handle('mudex:save-pasted-image', (_e, { name, base64, mime }) => {
  try {
    const ext = PASTED_IMAGE_TYPES[String(mime || '').toLowerCase()];
    if (!ext || typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      return { ok: false, error: 'BAD_IMAGE' };
    }
    const data = Buffer.from(base64, 'base64');
    if (data.length === 0 || data.length > 8 * 1024 * 1024) return { ok: false, error: 'TOO_LARGE' };
    const stem = path.basename(String(name || 'pasted-image'), path.extname(String(name || '')))
      .replace(/[^\w.-]/g, '_').slice(0, 48) || 'pasted-image';
    const dir = pastedImagesDir();
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${Date.now()}-${crypto.randomUUID()}-${stem}${ext}`);
    fs.writeFileSync(target, data, { flag: 'wx' });
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('mudex:read-file-bytes', async (_e, { path: filePath }) => {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return { ok: false, error: 'NOT_A_FILE' };
    if (st.size > 8 * 1024 * 1024) return { ok: false, error: 'TOO_LARGE' };
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(String(filePath)).toLowerCase();
    return { ok: true, base64: buf.toString('base64'), ext, mime: FILE_PREVIEW_MIME[ext] || 'application/octet-stream' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('mudex:open-file-default', async (_e, { path: filePath }) => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { ok: false, error: 'NOT_A_FILE' };
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('mudex:open-external-link', async (_e, { url: rawUrl } = {}) => {
  const url = normalizeExternalLink(rawUrl);
  if (!url) return { ok: false, error: 'UNSUPPORTED_LINK' };
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('mudex:git-numstat', async (_e, { cwd }) => {
  if (!cwd) return { ok: false, error: 'NO_CWD' };
  try {
    const acc = new Map();
    const add = (file, a, d) => {
      const cur = acc.get(file) || { file, added: 0, deleted: 0 };
      cur.added += a;
      cur.deleted += d;
      acc.set(file, cur);
    };
    const parseNumstat = (stdout) => {
      for (const line of String(stdout || '').split('\n')) {
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const a = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const d = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        let file = parts.slice(2).join('\t');
        const arrow = file.lastIndexOf(' => ');
        if (arrow >= 0) file = file.slice(arrow + 4);
        file = file.replace(/"/g, '');
        if (file) add(file, a, d);
      }
    };
    const unstaged = await runGit(cwd, ['diff', '--numstat']);
    if (unstaged.ok) parseNumstat(unstaged.stdout);
    const staged = await runGit(cwd, ['diff', '--cached', '--numstat']);
    if (staged.ok) parseNumstat(staged.stdout);
    const status = await runGit(cwd, ['status', '--porcelain']);
    if (status.ok) {
      for (const line of String(status.stdout || '').split('\n')) {
        const m = line.match(/^\?\? (.+)$/);
        if (!m) continue;
        const file = m[1].replace(/"/g, '');
        if (acc.has(file)) continue;
        try {
          const full = path.join(cwd, file);
          const st = fs.statSync(full);
          if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
          const text = fs.readFileSync(full, 'utf8');
          add(file, text.split('\n').length - (text.endsWith('\n') ? 1 : 0), 0);
        } catch {
          /* ignore */
        }
      }
    }
    return { ok: true, files: [...acc.values()] };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
const VERIFY_SCRIPTS = ['typecheck', 'build', 'test', 'lint'];
ipcMain.handle('mudex:verify-scripts', async (_e, { cwd }) => {
  if (!cwd) return { ok: false, error: 'NO_CWD' };
  try {
    const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8');
    const scripts = JSON.parse(raw).scripts || {};
    return { ok: true, scripts: VERIFY_SCRIPTS.filter((n) => typeof scripts[n] === 'string') };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('mudex:verify-run', async (_e, { cwd, script }) => {
  if (!cwd || !VERIFY_SCRIPTS.includes(script)) return { ok: false, error: 'BAD_ARGS' };
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (code, extra) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: true, code, tail: out.slice(-8000), ...(extra || {}) });
    };
    let child;
    try {
      child = spawnCli(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script, '--silent'], {
        cwd,
        windowsHide: true,
        env: process.env,
      });
    } catch (err) {
      resolve({ ok: false, error: String((err && err.message) || err) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        killTree(child);
      } catch {
        /* ignore */
      }
      finish(null, { error: 'TIMEOUT' });
    }, 10 * 60 * 1000);
    if (timer.unref) timer.unref();
    child.stdout.on('data', (d) => {
      out += d.toString();
      if (out.length > 20000) out = out.slice(-20000);
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
      if (out.length > 20000) out = out.slice(-20000);
    });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: String((err && err.message) || err) });
    });
    child.on('close', (code) => finish(code, null));
  });
});
ipcMain.handle('mudex:revert-files', async (_e, { cwd, files }) => {
  if (!cwd || !Array.isArray(files)) return { ok: false, error: 'BAD_ARGS' };
  const results = [];
  for (const f of files.slice(0, 50)) {
    if (typeof f !== 'string' || !f || f.includes('..') || path.isAbsolute(f)) {
      results.push({ file: String(f), ok: false, error: 'BAD_PATH' });
      continue;
    }
    try {
      const tracked = await runGit(cwd, ['ls-files', '--error-unmatch', f]);
      if (tracked.ok) {
        const r = await runGit(cwd, ['checkout', '--', f]);
        results.push({ file: f, ok: r.ok, error: r.ok ? undefined : String(r.stderr || r.error || 'revert failed') });
      } else {
        await fs.promises.unlink(path.join(cwd, f));
        results.push({ file: f, ok: true, deleted: true });
      }
    } catch (err) {
      results.push({ file: f, ok: false, error: String((err && err.message) || err) });
    }
  }
  return { ok: true, results };
});

ipcMain.handle('mudex:list-dir', (_e, { path: dirPath }) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map((d) => ({
      name: d.name,
      path: path.join(dirPath, d.name),
      isDir: d.isDirectory(),
    }));
    entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('mudex:watch-directory', (_e, { root, directory }) => workspaceWatcher.watch(root, directory));
ipcMain.handle('mudex:unwatch-directory', (_e, { root, directory }) => workspaceWatcher.unwatch(root, directory));

ipcMain.handle('mudex:create-entry', (_e, { dir: dirPath, name: rawName, kind }) => {
  try {
    const name = String(rawName || '').trim();
    if (!dirPath || !name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
      return { ok: false, error: 'BAD_NAME' };
    }
    if (kind !== 'file' && kind !== 'folder') return { ok: false, error: 'BAD_KIND' };
    const root = path.resolve(String(dirPath));
    if (!fs.statSync(root).isDirectory()) return { ok: false, error: 'NOT_A_DIRECTORY' };
    const target = path.resolve(root, name);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return { ok: false, error: 'BAD_PATH' };
    if (fs.existsSync(target)) return { ok: false, error: 'ALREADY_EXISTS' };
    if (kind === 'folder') fs.mkdirSync(target);
    else fs.writeFileSync(target, '', { encoding: 'utf8', flag: 'wx' });
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

function isPathWithin(rootPath, targetPath, allowEqual = false) {
  const relative = path.relative(rootPath, targetPath);
  if (!relative) return allowEqual;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safeWorkspaceEntry(rootValue, entryValue) {
  const rootPath = fs.realpathSync(path.resolve(String(rootValue || '')));
  if (!fs.statSync(rootPath).isDirectory()) throw new Error('NOT_A_DIRECTORY');
  const entryPath = path.resolve(String(entryValue || ''));
  const info = fs.lstatSync(entryPath);
  if (info.isSymbolicLink()) throw new Error('SYMLINK_UNSUPPORTED');
  const realEntryPath = fs.realpathSync(entryPath);
  if (!isPathWithin(rootPath, realEntryPath)) throw new Error('OUTSIDE_WORKSPACE');
  return { rootPath, entryPath, realEntryPath, info };
}

function safeLeafName(rawName) {
  const name = String(rawName || '').trim();
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\0-\x1F]/.test(name) || /[. ]$/.test(name)) return '';
  return name;
}

ipcMain.handle('mudex:rename-entry', (_e, { root: rootPath, path: entryPath, name: rawName }) => {
  try {
    const name = safeLeafName(rawName);
    if (!name) return { ok: false, error: 'BAD_NAME' };
    const entry = safeWorkspaceEntry(rootPath, entryPath);
    const parentPath = fs.realpathSync(path.dirname(entry.entryPath));
    if (!isPathWithin(entry.rootPath, parentPath, true)) return { ok: false, error: 'OUTSIDE_WORKSPACE' };
    const targetPath = path.join(parentPath, name);
    if (targetPath === entry.entryPath) return { ok: true, path: entry.entryPath };
    if (fs.existsSync(targetPath)) return { ok: false, error: 'ALREADY_EXISTS' };
    fs.renameSync(entry.entryPath, targetPath);
    return { ok: true, path: targetPath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('mudex:delete-entry', async (_e, { root: rootPath, path: entryPath }) => {
  try {
    const entry = safeWorkspaceEntry(rootPath, entryPath);
    await shell.trashItem(entry.entryPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('mudex:reveal-entry', (_e, { root: rootPath, path: entryPath }) => {
  try {
    const entry = safeWorkspaceEntry(rootPath, entryPath);
    shell.showItemInFolder(entry.entryPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Workspace search single-flight per caller scope: a newer keystroke cancels
// the older scan so overlapping walks cannot starve the final one of its
// deadline budget. Scopes keep independent surfaces (explorer, QuickOpen,
// file-mention) from cancelling each other.
const workspaceSearchSeqByScope = new Map();
const cancelPriorWorkspaceSearch = (scope) => {
  const key = typeof scope === 'string' && scope ? scope : 'default';
  const seq = (workspaceSearchSeqByScope.get(key) || 0) + 1;
  workspaceSearchSeqByScope.set(key, seq);
  return () => workspaceSearchSeqByScope.get(key) !== seq;
};

ipcMain.handle('mudex:search-files', async (_e, { cwd, query, options }) => {
  return searchFiles(cwd, query, { ...options, isCancelled: cancelPriorWorkspaceSearch(options?.scope) });
});

ipcMain.handle('mudex:search-in-files', (_e, { cwd, query, options }) => {
  return searchInFiles(cwd, query, { ...options, isCancelled: cancelPriorWorkspaceSearch(options?.scope) });
});

ipcMain.handle('mudex:read-file', (_e, { path: filePath }) => {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) return { ok: false, error: `TOO_LARGE:${stat.size}` };
    return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('mudex:write-file', (_e, { path: filePath, content, expectedOriginal }) => {
  try {
    if (expectedOriginal !== undefined) {
      if (!fs.existsSync(filePath)) return { ok: false, error: 'FILE_MISSING' };
      if (!fs.statSync(filePath).isFile()) return { ok: false, error: 'NOT_A_FILE' };
      if (fs.readFileSync(filePath, 'utf8') !== expectedOriginal) return { ok: false, error: 'FILE_CHANGED' };
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(filePath, String(content), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---------------------------------------------------------------- settings
ipcMain.handle('mudex:get-settings', () => ({ ok: true, settings: loadSettings() }));
ipcMain.handle('mudex:save-settings', (_e, patch) => {
  const next = { ...loadSettings(), ...(patch || {}) };
  next.theme = sanitizeTheme(next.theme);
  next.lang = sanitizeLang(next.lang);
  return { ok: true, settings: persistSettings(next) };
});

// ---------------------------------------------------------------- sessions file backup
// localStorage alone can lose history (quota, crash before flush), so every
// session change is also written here. Load prefers this file when non-empty.
function sessionsPath() {
  return path.join(app.getPath('userData'), 'sessions.json');
}
ipcMain.handle('mudex:sessions-save', (_e, { sessions }) => {
  try {
    fs.writeFileSync(sessionsPath(), JSON.stringify(sessions), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('mudex:sessions-load', () => {
  try {
    const arr = JSON.parse(fs.readFileSync(sessionsPath(), 'utf8'));
    return { ok: true, sessions: Array.isArray(arr) ? arr : [] };
  } catch {
    return { ok: true, sessions: [] };
  }
});

// Durable mirror for high-value renderer state (editor drafts, navigation
// bookmarks). Same crash-before-flush problem as sessions: the renderer keeps
// its sync Web Storage API and mirrors every write here. Synchronous like
// sessions-save: renderer writes are already debounced, and only a sync write
// survives a kill -9 between calls.
ipcMain.handle('mudex:state-get', (_e, { key } = {}) => {
  try {
    const value = loadRendererState(app.getPath('userData')).data[String(key)];
    return { ok: true, value: typeof value === 'string' ? value : null };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('mudex:state-set', (_e, { key, value } = {}) => {
  try {
    const data = applyStateSet(
      loadRendererState(app.getPath('userData')).data,
      String(key),
      value == null ? null : String(value),
    );
    saveRendererState(app.getPath('userData'), data);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---------------------------------------------------------------- CLI resolve
function findOnPath(cmd) {
  // Manual PATH scan (no shell): returns absolute path or null.
  // Order matters: .exe first (direct spawn). Extensionless is LAST —
  // npm-style shims ship an extensionless shell script that Windows cannot
  // execute directly (spawn EINVAL). .ps1 is excluded: never spawnable.
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  for (const raw of dirs) {
    const dir = String(raw || '').trim().replace(/^"|"$/g, '');
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

function resolveCli(requested) {
  // Empty (or bare 'muse') => auto-detect on PATH.
  // Explicit path or other command name => use as-is.
  const name = String(requested || '').trim() || 'muse';
  if (name === 'muse') {
    const hit = findOnPath('muse');
    if (hit) return { path: hit, source: 'PATH' };
    return { path: 'muse', source: 'not-found' };
  }
  try {
    if (fs.statSync(name).isFile()) return { path: name, source: 'setting' };
  } catch {
    /* not a direct file path — try PATH lookup of the bare name */
  }
  const base = name.replace(/["']/g, '');
  if (!/[/\\]/.test(base)) {
    const hit = findOnPath(base);
    if (hit) return { path: hit, source: 'setting' };
  }
  return { path: name, source: 'setting' }; // let spawn report ENOENT
}

let promptSeq = 0;
function writePromptFile(text) {
  // .cmd/.bat run through cmd.exe, whose quoting would mangle arbitrary
  // prompt text — so pass the prompt via file instead of inline argv.
  promptSeq += 1;
  const dir = path.join(app.getPath('temp'), 'mudex-prompts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `p-${Date.now()}-${promptSeq}.txt`);
  fs.writeFileSync(file, String(text), 'utf8');
  return file;
}

function dropPromptFile(file) {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------- CLI bridge
ipcMain.handle('mudex:cli-test', async () => {
  const s = loadSettings();
  let mspRes = null;
  try {
    mspRes = await msp.test(s);
  } catch (err) {
    mspRes = { ok: false, error: String((err && err.message) || err) };
  }
  const resolved = resolveCli(s.cliPath);
  const cmd = `${quoteArg(resolved.path)} exec --help`;
  const execRes = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      // stdin 'ignore': CLI가 중간에 입력을 물어도 무한 대기하지 않게.
      child = spawnCli(resolved.path, ['exec', '--help'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        ok: false,
        error: String((err && err.message) || err),
        cmd,
        resolvedPath: resolved.path,
        source: resolved.source,
      });
      return;
    }
    const timer = setTimeout(() => {
      killTree(child);
      resolve({ ok: false, error: 'TIMEOUT', cmd });
    }, 15000);
    if (timer.unref) timer.unref();
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      const notFound = err && err.code === 'ENOENT';
      resolve({
        ok: false,
        error: notFound ? 'CLI_NOT_FOUND' : String(err.message || err),
        cmd,
        resolvedPath: resolved.path,
        source: resolved.source,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout: head(stdout),
        stderr: head(stderr),
        cmd,
        resolvedPath: resolved.path,
        source: resolved.source,
      });
    });
  });
  // Best-effort CLI version (never fails the test): used for update guidance.
  let version = null;
  if (resolved.source !== 'not-found') {
    version = await new Promise((resolve) => {
      let out = '';
      let child;
      try {
        child = spawnCli(resolved.path, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => {
        killTree(child);
        resolve(null);
      }, 10000);
      if (timer.unref) timer.unref();
      child.stdout.on('data', (d) => {
        out += d.toString();
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return resolve(null);
        const m = out.match(/(\d+\.\d+\.\d+[^\s]*)/);
        resolve(m ? m[1] : out.trim().split(/\s+/).slice(0, 3).join(' ') || null);
      });
    });
  }
  const engine = mspRes && mspRes.ok ? 'msp' : execRes.ok ? 'exec' : 'none';
  return {
    ok: engine !== 'none',
    engine,
    version,
    msp: mspRes,
    exec: execRes,
    cmd: execRes.cmd,
    code: execRes.code,
    stdout: execRes.stdout,
    stderr: execRes.stderr,
    error: execRes.error,
    resolvedPath: (mspRes && mspRes.resolvedPath) || execRes.resolvedPath,
    source: mspRes && mspRes.resolvedPath ? mspRes.source : execRes.source,
  };
});

ipcMain.handle('mudex:chat-start', async (_e, { prompt, cwd, threadKey, mspSessionId }) => {
  const s = loadSettings();
  const want = s.engine || 'auto';
  if (want === 'msp' || want === 'auto') {
    try {
      return await startMspChat(prompt, cwd, s, threadKey, mspSessionId);
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (want === 'msp' || !/CLI_NOT_FOUND|SERVE_NEEDS_EXE|SERVE_HANDSHAKE_FAIL|ENOENT/.test(msg)) {
        const workdir = cwd || s.workdir || app.getPath('home');
        return { ok: false, error: msg, engine: 'msp', cmd: '', cwd: workdir };
      }
      // auto + serve unavailable → fall through to exec below
    }
  }
  // Prompt is ALWAYS the last positional arg: `muse exec [options] <prompt>`.
  // A bare `muse "<prompt>"` would seed the interactive TUI and hang — never do that.
  const resolved = resolveCli(s.cliPath);
  const promptText = String(prompt);
  let promptFile = null;
  let argv = ['exec', ...splitArgs(s.extraArgs), ...(s.model ? ['--model', s.model] : []), promptText];
  if (needsShell(resolved.path)) {
    promptFile = writePromptFile(promptText);
    argv = ['exec', ...splitArgs(s.extraArgs), ...(s.model ? ['--model', s.model] : []), '--prompt-file', promptFile];
  }
  const workdir = cwd || s.workdir || app.getPath('home');
  const cmd = [quoteArg(resolved.path), ...argv.map(quoteArg)].join(' ');
  const reqId = `r${Date.now()}-${(reqSeq += 1)}`;

  let child;
  try {
    // stdin 'ignore': 승인 프롬프트 등에서 무한 대기 방지.
    child = spawnCli(resolved.path, argv, { cwd: workdir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return {
      ok: false,
      error: String((err && err.message) || err),
      engine: 'exec',
      cmd,
      cwd: workdir,
      resolvedPath: resolved.path,
      source: resolved.source,
      mcpHealth: null,
      diagnostics: { reason: 'EXEC_NO_SESSION_MCP', detail: s.lang === 'en' ? 'Browser tools are unavailable in exec mode' : 'exec 모드에서는 브라우저 도구를 쓸 수 없습니다' },
    };
  }
  running.set(reqId, { engine: 'exec', child });
  if (promptFile) promptFiles.set(reqId, promptFile);

  const execTimeoutMs = Number(s.timeoutMs) || 0;
  const timer =
    execTimeoutMs > 0
      ? setTimeout(() => {
          killTree(child);
          running.delete(reqId);
          dropPromptFile(promptFile);
          promptFiles.delete(reqId);
          send('mudex:chat-done', { reqId, code: null, error: `TIMEOUT:${execTimeoutMs}` });
        }, execTimeoutMs)
      : null;
  if (timer && timer.unref) timer.unref();

  child.stdout.on('data', (d) => send('mudex:chat-chunk', { reqId, text: d.toString() }));
  child.stderr.on('data', (d) => send('mudex:chat-stderr', { reqId, text: d.toString() }));
  child.on('error', (err) => {
    clearTimeout(timer);
    running.delete(reqId);
    dropPromptFile(promptFile);
    promptFiles.delete(reqId);
    const notFound = err && err.code === 'ENOENT';
    send('mudex:chat-done', {
      reqId,
      code: null,
      error: notFound ? 'CLI_NOT_FOUND' : String((err && err.message) || err),
    });
  });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    running.delete(reqId);
    dropPromptFile(promptFile);
    promptFiles.delete(reqId);
    send('mudex:chat-done', { reqId, code, signal: signal || null });
  });

  return { ok: true, reqId, engine: 'exec', cmd, cwd: workdir, resolvedPath: resolved.path, source: resolved.source, mcpHealth: null, diagnostics: { reason: 'EXEC_NO_SESSION_MCP', detail: s.lang === 'en' ? 'Browser tools are unavailable in exec mode' : 'exec 모드에서는 브라우저 도구를 쓸 수 없습니다' } };
});

// ---------------------------------------------------------------- git (diff chips)
function runGit(cwd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: String((err && err.message) || err) });
      return;
    }
    const timer = setTimeout(() => {
      killTree(child);
      resolve({ ok: false, error: 'TIMEOUT' });
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
      resolve({
        ok: false,
        error: err && err.code === 'ENOENT' ? 'GIT_NOT_FOUND' : String((err && err.message) || err),
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

ipcMain.handle('mudex:git-status', async (_e, { cwd }) => {
  if (!cwd) return { ok: false, error: 'NO_CWD' };
  const r = await runGit(cwd, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (!r.ok) return { ok: false, error: r.error || `exit ${r.code}` };
  // Keep raw porcelain lines: the leading X/Y columns carry staged state.
  const files = String(r.stdout || '')
    .split('\n')
    .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
    .filter((l) => l.length > 0);
  return { ok: true, files };
});

ipcMain.handle('mudex:git-show', async (_e, { cwd, file }) => {
  if (!cwd || !file) return { ok: false, error: 'NO_ARGS' };
  if (!isSafeRepoRelativePath(file)) return { ok: false, error: 'BAD_PATH' };
  const r = await runGit(cwd, ['show', `HEAD:${file}`]);
  if (!r.ok) return { ok: false, error: 'NO_HEAD' }; // untracked → empty original
  return { ok: true, content: String(r.stdout || '') };
});

ipcMain.handle('mudex:git-stage', async (_e, { cwd, files, staged }) => {
  if (!cwd || !Array.isArray(files) || files.length === 0) return { ok: false, error: 'NO_ARGS' };
  if (files.length > 200) return { ok: false, error: 'TOO_MANY_FILES' };
  let rootPath;
  try {
    rootPath = fs.realpathSync(path.resolve(String(cwd)));
    if (!fs.statSync(rootPath).isDirectory()) return { ok: false, error: 'NOT_A_DIRECTORY' };
  } catch {
    return { ok: false, error: 'NOT_A_DIRECTORY' };
  }
  const abs = [];
  for (const f of files) {
    const p = path.resolve(String(f || ''));
    if (!isPathWithin(rootPath, p)) return { ok: false, error: 'OUTSIDE_WORKSPACE' };
    abs.push(p);
  }
  // Deleted working-tree files may not exist on disk; only containment is checked.
  // NOTE: `git add` has no -q flag; `git reset` does.
  const r = staged
    ? await runGit(cwd, ['reset', '-q', '--', ...abs])
    : await runGit(cwd, ['add', '--', ...abs]);
  if (!r.ok) return { ok: false, error: String(r.stderr || r.error || `exit ${r.code}`).slice(0, 300) };
  return { ok: true };
});

ipcMain.handle('mudex:git-commit', async (_e, { cwd, message }) => {
  if (!cwd) return { ok: false, error: 'NO_CWD' };
  const text = String(message || '').trim();
  if (!text) return { ok: false, error: 'EMPTY_MESSAGE' };
  if (text.length > 2000) return { ok: false, error: 'MESSAGE_TOO_LONG' };
  const r = await runGit(cwd, ['commit', '-q', '-m', text]);
  if (!r.ok) {
    const errText = `${r.stderr || ''} ${r.error || ''}`;
    if (/nothing to commit/i.test(errText)) return { ok: false, error: 'NO_CHANGES' };
    return { ok: false, error: String(r.stderr || r.error || `exit ${r.code}`).slice(0, 300) };
  }
  const head = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
  return { ok: true, hash: head.ok ? String(head.stdout || '').trim() : undefined };
});

ipcMain.handle('mudex:git-branch', async (_e, { cwd }) => {
  if (!cwd) return { ok: false, error: 'NO_CWD' };
  const b = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!b.ok) return { ok: false, error: String(b.stderr || b.error || `exit ${b.code}`).slice(0, 200) };
  const counts = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  const remote = await runGit(cwd, ['remote', 'get-url', 'origin']);
  return {
    ok: true,
    branch: String(b.stdout || '').trim(),
    counts: counts.ok ? String(counts.stdout || '') : '',
    remote: remote.ok ? redactRemoteUrl(remote.stdout) : '',
  };
});

ipcMain.handle('mudex:git-pull', async (_e, { cwd }) => {
  if (!cwd) return { ok: false, error: 'NO_CWD' };
  const r = await runGit(cwd, ['pull', '--ff-only'], 120000);
  if (!r.ok) return { ok: false, error: String(r.stderr || r.error || `exit ${r.code}`).slice(0, 300) };
  return { ok: true, output: String(r.stdout || '').slice(0, 500) };
});

ipcMain.handle('mudex:git-push', async (_e, { cwd }) => {
  if (!cwd) return { ok: false, error: 'NO_CWD' };
  const r = await runGit(cwd, ['push'], 120000);
  if (!r.ok) return { ok: false, error: String(r.stderr || r.error || `exit ${r.code}`).slice(0, 300) };
  return { ok: true };
});

ipcMain.handle('mudex:git-clone', async (_e, { url, target }) => {
  const source = String(url || '').trim();
  const dest = String(target || '').trim();
  if (!source || !dest) return { ok: false, error: 'NO_ARGS' };
  if (!isSafeCloneSource(source)) return { ok: false, error: 'BAD_SOURCE' };
  if (dest.length > 1000) return { ok: false, error: 'ARG_TOO_LONG' };
  const absTarget = path.resolve(dest);
  let parent;
  try {
    parent = fs.realpathSync(path.dirname(absTarget));
    if (!fs.statSync(parent).isDirectory()) return { ok: false, error: 'NOT_A_DIRECTORY' };
  } catch {
    return { ok: false, error: 'NOT_A_DIRECTORY' };
  }
  try {
    fs.statSync(absTarget);
    return { ok: false, error: 'TARGET_EXISTS' };
  } catch { /* a missing target is the expected case */ }
  const r = await runGit(parent, ['clone', source, absTarget], 300000);
  if (!r.ok) return { ok: false, error: String(r.stderr || r.error || `exit ${r.code}`).slice(0, 300) };
  return { ok: true, path: absTarget };
});

async function startMspChat(prompt, cwd, s, threadKey, mspSessionId) {
  const key = threadKey || `t-${Date.now()}-${(reqSeq += 1)}`;
  const reqId = `m${Date.now()}-${(reqSeq += 1)}`;
  const workdir = cwd || s.workdir || app.getPath('home');
  const timeoutMs = Number(s.timeoutMs) || 0;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          running.delete(reqId);
          msp.cancelTurn(key).catch(() => {});
          send('mudex:chat-done', { reqId, code: null, error: `TIMEOUT:${timeoutMs}` });
        }, timeoutMs)
      : null;
  if (timer && timer.unref) timer.unref();
  running.set(reqId, { engine: 'msp', threadKey: key, timer });
  let turn;
  try {
    turn = await msp.sendTurn(key, String(prompt), {
      cwd: workdir,
      settings: s,
      mspSessionId,
      onItem: ({ turnId, item }) => send('msp:item', { reqId, threadKey: key, turnId, item }),
      onDone: ({ outcome, error }) => {
        clearTimeout(timer);
        running.delete(reqId);
        if (error) {
          send('mudex:chat-done', { reqId, code: null, error });
          return;
        }
        const terminal = (outcome && outcome.terminal) || 'completed';
        send('mudex:chat-done', {
          reqId,
          code: terminal === 'completed' ? 0 : 1,
          terminal,
          durationMs: (outcome && outcome.durationMs) ?? null,
          usage: (outcome && outcome.usage) || null,
          reason: (outcome && outcome.reason) || null,
          errorText: (outcome && outcome.errorText) || null,
        });
      },
    });
  } catch (err) {
    clearTimeout(timer);
    running.delete(reqId);
    throw err;
  }
  return { ok: true, reqId, engine: 'msp', mspSessionId: turn.mspSessionId, turnId: turn.turnId, cmd: `msp turn ${turn.turnId}`, cwd: workdir, mcpHealth: turn.mcpHealth || null };
}

ipcMain.handle('msp:prewarm', async (_e, { cwd }) => {
  const s = loadSettings();
  if ((s.engine || 'auto') === 'exec') return { ok: false, error: 'ENGINE_EXEC' };
  try {
    const host = await msp.ensureHost(cwd || s.workdir || '', s);
    return { ok: true, key: host.key };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('msp:decide', (_e, { key, choiceId, feedback }) => ({ ok: msp.decideApproval(key, choiceId, feedback) }));
ipcMain.handle('msp:user-input-answer', (_e, { key, answers }) => msp.answerUserInput(key, answers));
ipcMain.handle('msp:user-input-cancel', (_e, { key }) => msp.cancelUserInput(key));

ipcMain.handle('msp:sessions', async (_e, { cwd }) => {
  try {
    return { ok: true, sessions: await msp.listSessions(cwd || '', loadSettings()) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('msp:resume', async (_e, { threadKey, mspSessionId, cwd }) => {
  try {
    const r = await msp.resumeThread(threadKey, mspSessionId, cwd || '', loadSettings());
    return { ok: true, mspSessionId: r.mspSessionId, messages: r.messages, mcpHealth: r.mcpHealth || null };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('msp:usage', async (_e, { cwd }) => {
  try {
    return { ok: true, usage: await msp.readUsage(cwd || '', loadSettings()) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('msp:models', async (_e, { cwd }) => {
  try {
    return { ok: true, models: await msp.listModels(cwd || '', loadSettings()) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('msp:set-model', async (_e, { threadKey, modelId }) => {
  try {
    await msp.setModel(threadKey, modelId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('msp:set-approval-mode', async (_e, { threadKey, mode }) => {
  try {
    await msp.setApprovalMode(threadKey, mode);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('msp:set-reasoning', async (_e, { threadKey, effort }) => {
  try {
    await msp.setReasoningEffort(threadKey, effort);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('msp:warmup', async (_e, { cwd }) => {
  try {
    const s = loadSettings();
    await msp.ensureHost(cwd || '', s);
    const [sessions, usage] = await Promise.all([
      msp.listSessions(cwd || '', s).catch(() => []),
      msp.readUsage(cwd || '', s).catch(() => null),
    ]);
    return { ok: true, sessions, usage };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---------------------------------------------------------------- Codex project handoff
function codexHome() {
  return process.env.CODEX_HOME || path.join(app.getPath('home'), '.codex');
}

function codexTitles() {
  const out = new Map();
  try {
    for (const line of fs.readFileSync(path.join(codexHome(), 'session_index.jsonl'), 'utf8').split(/\r?\n/)) {
      if (!line) continue;
      try {
        const row = JSON.parse(line);
        if (row.id) out.set(row.id, { title: row.thread_name || row.id, updatedAt: row.updated_at || '' });
      } catch { /* skip a partial row */ }
    }
  } catch { /* index is optional */ }
  return out;
}

function codexRollouts(dir, out = []) {
  if (out.length >= 2500) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (out.length >= 2500) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) codexRollouts(full, out);
    else if (/^rollout-.*\.jsonl$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function codexMeta(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const count = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const line = buf.subarray(0, count).toString('utf8').split(/\r?\n/, 1)[0];
    const row = JSON.parse(line);
    const p = row && row.type === 'session_meta' ? row.payload : null;
    return p && p.id && p.cwd ? { id: p.id, cwd: p.cwd, roots: Array.isArray(p.runtime_workspace_roots) ? p.runtime_workspace_roots : [], file } : null;
  } catch { return null; }
}

function projectCodexSessions(cwd) {
  if (!cwd) return [];
  const titles = codexTitles();
  const projectPaths = createProjectPathMatcher();
  return codexRollouts(path.join(codexHome(), 'sessions'))
    .map(codexMeta)
    .filter((m) => m && (projectPaths.sameProjectPath(m.cwd, cwd) || m.roots.some((root) => projectPaths.sameProjectPath(root, cwd))))
    .map((m) => {
      const indexed = titles.get(m.id) || {};
      let updatedAt = indexed.updatedAt || '';
      if (!updatedAt) {
        try { updatedAt = fs.statSync(m.file).mtime.toISOString(); } catch { /* ignore */ }
      }
      return { id: m.id, title: indexed.title || m.id, updatedAt, file: m.file };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// Session selection may request several previews in quick succession. Cache
// the expensive rollout scan briefly, while list/queue operations refresh it.
const codexProjectSessionCache = createProjectSessionCache(projectCodexSessions);

function codexMessageText(payload) {
  if (!payload || payload.type !== 'message' || !['user', 'assistant'].includes(payload.role)) return '';
  const parts = Array.isArray(payload.content) ? payload.content : [];
  return parts
    .filter((p) => p && ['input_text', 'output_text', 'text'].includes(p.type))
    .map((p) => String(p.text || ''))
    .filter(Boolean)
    .join('\n');
}

function readCodexContext(file) {
  const stat = fs.statSync(file);
  const max = 6 * 1024 * 1024;
  const start = Math.max(0, stat.size - max);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  let raw = buf.toString('utf8');
  if (start > 0) raw = raw.slice(raw.indexOf('\n') + 1);
  const messages = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (row.type !== 'response_item') continue;
      const text = codexMessageText(row.payload).trim();
      if (text) messages.push({ role: row.payload.role, text: text.slice(0, 5000) });
    } catch { /* skip partial or unknown records */ }
  }
  return messages.slice(-12).map((m) => `${m.role === 'user' ? '사용자' : 'Codex'}: ${m.text}`).join('\n\n').slice(-24000);
}

function runCodex(args, cwd, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const bin = findOnPath('codex');
    if (!bin) return resolve({ ok: false, error: 'CODEX_NOT_FOUND' });
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawnCli(bin, args, { cwd: cwd || undefined, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ ok: false, error: String((err && err.message) || err) });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: String(err.message || err) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, error: code === 0 ? undefined : (stderr || stdout || `CODEX_EXIT_${code}`).slice(-2000) }); });
  });
}

ipcMain.handle('codex:sessions', (_e, { cwd } = {}) => {
  try {
    return { ok: true, sessions: codexProjectSessionCache.get(cwd, { refresh: true }).slice(0, 100).map(({ file: _file, ...s }) => s) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('codex:read', (_e, { sessionId, cwd } = {}) => {
  try {
    let hit = codexProjectSessionCache.get(cwd).find((s) => s.id === sessionId);
    if (!hit) hit = codexProjectSessionCache.get(cwd, { refresh: true }).find((s) => s.id === sessionId);
    if (!hit) return { ok: false, error: 'PROJECT_SESSION_NOT_FOUND' };
    return { ok: true, title: hit.title, context: readCodexContext(hit.file) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('codex:queue', async (_e, { sessionId, cwd, context } = {}) => {
  try {
    const hit = codexProjectSessionCache.get(cwd, { refresh: true }).find((s) => s.id === sessionId);
    if (!hit) return { ok: false, error: 'PROJECT_SESSION_NOT_FOUND' };
    const text = String(context || '').slice(0, 28000);
    if (!text) return { ok: false, error: 'EMPTY_HANDOFF' };
    const queued = await runCodex(['queue', '--thread', sessionId, '--message', text], cwd);
    if (!queued.ok) return queued;
    try {
      await shell.openExternal(`codex://threads/${encodeURIComponent(sessionId)}`);
    } catch {
      const bin = findOnPath('codex');
      if (bin) {
        const child = spawnCli(bin, ['app', cwd], { cwd, detached: true, windowsHide: true, stdio: 'ignore' });
        child.unref();
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---------------------------------------------------------------- browser tabs
ipcMain.handle('browser:show', (_e, { tabId, home, initialUrl } = {}) => browser.show(tabId, home, initialUrl));
ipcMain.handle('browser:hide', (_e, { tabId } = {}) => browser.hide(tabId));
ipcMain.handle('browser:close', (_e, { tabId } = {}) => browser.close(tabId));
ipcMain.handle('browser:bounds', (_e, bounds) => browser.setBounds(bounds || {}));
ipcMain.handle('browser:navigate', async (_e, { tabId, url } = {}) => {
  try {
    // User-typed address-bar path: plain words become a web search.
    // (Agent/MCP navigation bypasses this handler — strict URLs there.)
    return await browser.driverFor(tabId).navigate(resolveAddressInput(url));
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
ipcMain.handle('browser:find', async (_e, { tabId, text, forward, findNext } = {}) => {
  try {
    return await browser.driverFor(tabId).find(text, { forward, findNext });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
for (const m of ['back', 'forward', 'reload', 'stop', 'state', 'source']) {
  ipcMain.handle(`browser:${m}`, async (_e, p) => {
    try {
      return await browser.driverFor(p && p.tabId)[m](p && p.max);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
}
ipcMain.handle('browser:tabs', async () => {
  try {
    return await browser.driver().tabs();
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---------------------------------------------------------------- terminal tabs
ipcMain.handle('term:start', (_e, { tabId, shell, cwd, seq } = {}) => termHost.start({ tabId, shell, cwd, seq }));
ipcMain.handle('term:input', (_e, { tabId, text } = {}) => termHost.input({ tabId, text }));
ipcMain.handle('term:kill', (_e, { tabId } = {}) => termHost.kill({ tabId }));
function browserMcpEntry() {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return musicianBrowserEntry({
    command: process.execPath,
    serverFile: path.join(root, 'browser-mcp', 'server.js'),
    bridgeFile: browser.connectionPath(),
  });
}

ipcMain.handle('browser:mcp-cmd', () => {
  // Exact stdio registration for a CLI MCP config (`muse exec` and terminal
  // sessions read only the global settings file). The command is this app
  // executable with ELECTRON_RUN_AS_NODE — no separate Node install needed.
  try {
    const entry = browserMcpEntry();
    const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const settingsPath = resolveCliSettingsPath();
    let registration = 'unknown';
    try {
      registration = registrationStatus(settingsPath, entry);
    } catch {
      /* read-only probe must never break the dialog */
    }
    return {
      ok: true,
      command: entry.command,
      args: entry.args,
      server: path.join(root, 'browser-mcp', 'server.js'),
      settingsPath,
      settingsBlock: settingsBlockText(entry),
      registration,
    };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Explicit one-click registration into the CLI's global settings (Settings
// button only — never automatic). Surgical merge, see mcp-register.js.
ipcMain.handle('browser:mcp-register', () => {
  try {
    const entry = browserMcpEntry();
    const settingsPath = resolveCliSettingsPath();
    const r = registerMcpServer(settingsPath, entry);
    appendMainLog('mcp-register', { status: r.status, path: settingsPath });
    if (r.status === 'created' || r.status === 'added' || r.status === 'updated' || r.status === 'already-registered') {
      return { ok: true, status: r.status, path: settingsPath };
    }
    return { ok: false, status: r.status, path: settingsPath };
  } catch (err) {
    return { ok: false, status: 'failed', error: String((err && err.message) || err) };
  }
});

// Badge/health source of truth: same pre-flight the engine runs before
// sessions, on demand (mount, setting flip, badge click). Starts the bridge
// first so "다시 연결" actually retries it.
ipcMain.handle('browser:health', async () => {
  try {
    if (!browser.isAgentEnabled()) return { ok: false, reason: 'AGENT_DISABLED', checkedAt: Date.now() };
    await browser.startBridge();
    const repair = browser.repairBridgeFile();
    const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const [entry] = await checkMcpServerHealth(
      [['musician-browser', { command: process.execPath, env: { MUSICIAN_BRIDGE_FILE: browser.connectionPath() } }]],
      { root, connectionPath: browser.connectionPath() },
    );
    if (entry && entry.ok) return { ok: true, reason: null, repaired: repair.repaired === true, checkedAt: Date.now() };
    return { ok: false, reason: (entry && entry.reason) || 'UNKNOWN', repaired: repair.repaired === true, checkedAt: Date.now() };
  } catch (err) {
    return { ok: false, reason: 'HEALTH_CHECK_FAILED', checkedAt: Date.now(), error: String((err && err.message) || err) };
  }
});

ipcMain.handle('mudex:chat-cancel', async (_e, { reqId }) => {
  const h = running.get(reqId);
  if (!h) return { ok: false };
  running.delete(reqId);
  if (h.engine === 'msp') {
    if (h.timer) clearTimeout(h.timer);
    try {
      await msp.cancelTurn(h.threadKey);
    } catch {
      /* turn completion still reports */
    }
    send('mudex:chat-done', { reqId, code: null, error: 'CANCELLED' });
    return { ok: true };
  }
  killTree(h.child || h);
  dropPromptFile(promptFiles.get(reqId));
  promptFiles.delete(reqId);
  send('mudex:chat-done', { reqId, code: null, error: 'CANCELLED' });
  return { ok: true };
});
