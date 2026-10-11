'use strict';
// resolveWindowIcon: explicit BrowserWindow icon so the Windows taskbar
// (and title bar / Alt-Tab) shows the Musician logo. Packaged builds read
// the icon from extraResources; dev reads build/. Yields undefined when
// the file is missing so Electron falls back to its default. Never throws.
const path = require('node:path');

const DEFAULT_APP_ID = 'com.musician.app';

// resolveAppUserModelId: the Windows identity for toasts and the taskbar.
// Packaged builds use build.appId; dev builds take a suffixed identity so
// dev toasts never register (and claim the taskbar slot of) the production
// app. Never throws.
function resolveAppUserModelId(options) {
  try {
    const opts = options && typeof options === 'object' ? options : {};
    const base = typeof opts.appId === 'string' && opts.appId.length > 0 ? opts.appId : DEFAULT_APP_ID;
    return opts.isPackaged === true ? base : `${base}.dev`;
  } catch {
    return DEFAULT_APP_ID;
  }
}

function resolveWindowIcon(options) {
  try {
    const opts = options && typeof options === 'object' ? options : {};
    const platform = typeof opts.platform === 'string' ? opts.platform : process.platform;
    const file = platform === 'win32' ? 'icon.ico' : 'icon.png';
    const packaged = opts.isPackaged === true;
    const base = packaged ? opts.resourcesPath : opts.appPath;
    if (typeof base !== 'string' || base.length === 0) return undefined;
    const candidate = packaged ? path.join(base, file) : path.join(base, 'build', file);
    const exists = typeof opts.exists === 'function' ? opts.exists : null;
    if (!exists) return undefined;
    return exists(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

module.exports = { resolveWindowIcon, resolveAppUserModelId };
