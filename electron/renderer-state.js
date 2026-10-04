'use strict';
// File-backed durable store for high-value renderer state (editor drafts,
// navigation bookmarks). Web Storage can lose recent writes on a crash or
// forced kill (async LevelDB commit; sessionStorage never survives a restart),
// so main keeps an authoritative JSON copy in userData.
const fs = require('node:fs');
const path = require('node:path');

function stateFilePath(userDataDir) {
  return path.join(String(userDataDir), 'renderer-state.json');
}

// Missing or corrupt files load as empty — the caller falls back to whatever
// Web Storage still has. Never throws.
function loadRendererState(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath(userDataDir), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: true, data: {} };
    const data = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') data[key] = value;
    }
    return { ok: true, data };
  } catch {
    return { ok: true, data: {} };
  }
}

// Atomic replace (tmp + rename). userData always exists; other failures
// report false without throwing.
function saveRendererState(userDataDir, data) {
  const file = stateFilePath(userDataDir);
  const tmpFile = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data || {}));
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

// Pure in-memory set/delete for the main-side map.
function applyStateSet(data, key, value) {
  const next = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  if (value === null || value === undefined) delete next[String(key)];
  else next[String(key)] = String(value);
  return next;
}

module.exports = { applyStateSet, loadRendererState, saveRendererState, stateFilePath };
