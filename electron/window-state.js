'use strict';
// Persisted main-window bounds so the app reopens where the user left it
// (e.g. fullscreen on the second monitor while gaming on the primary).
// Saved state is validated against the current displays on every launch:
// an unplugged monitor (off-screen bounds) falls back to defaults instead
// of stranding the window. Never throws.
const fs = require('node:fs');
const path = require('node:path');

const MIN_VISIBLE_W = 200;
const MIN_VISIBLE_H = 120;

function stateFilePath(userDataDir) {
  return path.join(String(userDataDir), 'window-state.json');
}

function isValidBounds(b) {
  return !!b && Number.isFinite(b.x) && Number.isFinite(b.y)
    && Number.isFinite(b.width) && Number.isFinite(b.height)
    && b.width >= MIN_VISIBLE_W && b.height >= MIN_VISIBLE_H;
}

// True when any part of the bounds overlaps a display by at least the
// minimum visible area (top-left corner alone is not enough).
function isOnScreen(bounds, displays) {
  if (!isValidBounds(bounds) || !Array.isArray(displays)) return false;
  return displays.some((d) => {
    if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.width) || !Number.isFinite(d.height)) return false;
    const w = Math.min(bounds.x + bounds.width, d.x + d.width) - Math.max(bounds.x, d.x);
    const h = Math.min(bounds.y + bounds.height, d.y + d.height) - Math.max(bounds.y, d.y);
    return w >= MIN_VISIBLE_W && h >= MIN_VISIBLE_H;
  });
}

function loadWindowState(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath(userDataDir), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { ok: true, data: null };
    const { x, y, width, height, maximized } = parsed;
    if (!isValidBounds({ x, y, width, height })) return { ok: true, data: null };
    return { ok: true, data: { x, y, width, height, maximized: maximized === true } };
  } catch {
    return { ok: true, data: null };
  }
}

function saveWindowState(userDataDir, state) {
  const file = stateFilePath(userDataDir);
  const tmpFile = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(state || {}));
    JSON.parse(fs.readFileSync(tmpFile, 'utf8')); // reread before replacing
    fs.renameSync(tmpFile, file);
    return { ok: true };
  } catch {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* best effort */
    }
    return { ok: false };
  }
}

function restoreBounds(saved, displays, fallback) {
  if (saved && isOnScreen(saved, displays)) return { bounds: saved, useSaved: true };
  return { bounds: fallback, useSaved: false };
}

module.exports = { loadWindowState, saveWindowState, isOnScreen, restoreBounds };
