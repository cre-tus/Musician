'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isWithin(root, target, allowEqual = false) {
  const relative = path.relative(root, target);
  if (!relative) return allowEqual;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function watcherKey(directory) {
  const resolved = path.resolve(directory);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

class WorkspaceWatcher {
  constructor({ onChange, onError } = {}) {
    this.onChange = onChange || (() => {});
    this.onError = onError || (() => {});
    this.watchers = new Map();
  }

  watch(rootValue, directoryValue) {
    try {
      if (!rootValue || !directoryValue) return { ok: false, error: 'BAD_PATH' };
      const root = fs.realpathSync(path.resolve(String(rootValue)));
      const directory = fs.realpathSync(path.resolve(String(directoryValue)));
      if (!isWithin(root, directory, true)) return { ok: false, error: 'OUTSIDE_WORKSPACE' };
      if (!fs.statSync(directory).isDirectory()) return { ok: false, error: 'NOT_A_DIRECTORY' };

      const key = watcherKey(directoryValue);
      const existing = this.watchers.get(key);
      if (existing) {
        existing.refs += 1;
        return { ok: true };
      }

      const watcher = fs.watch(directory, (eventType, filename) => {
        const changedPath = filename == null ? directory : path.resolve(directory, String(filename));
        if (!isWithin(directory, changedPath, true)) return;
        this.onChange({ root, directory, path: changedPath, eventType });
      });
      const record = { watcher, refs: 1 };
      this.watchers.set(key, record);
      watcher.on('error', (error) => {
        if (this.watchers.get(key) === record) this.watchers.delete(key);
        watcher.close();
        this.onError({ root, directory, error: String((error && error.message) || error) });
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  }

  unwatch(_rootValue, directoryValue) {
    if (!directoryValue) return { ok: false, error: 'BAD_PATH' };
    const key = watcherKey(directoryValue);
    const record = this.watchers.get(key);
    if (!record) return { ok: true };
    record.refs -= 1;
    if (record.refs <= 0) {
      this.watchers.delete(key);
      record.watcher.close();
    }
    return { ok: true };
  }

  closeAll() {
    for (const record of this.watchers.values()) record.watcher.close();
    this.watchers.clear();
  }
}

module.exports = { WorkspaceWatcher };
