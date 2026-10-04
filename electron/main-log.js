'use strict';
// Packaged apps have no visible console: notable main-process events also
// land in <userData>/musician.log (JSON lines) so causes stay inspectable.
// Logging must never break the app: all failures are swallowed.
const fs = require('node:fs');
const path = require('node:path');

function appendMainLog(userDataDir, tag, obj) {
  try {
    const line = `${new Date().toISOString()} ${tag} ${JSON.stringify(obj || {})}\n`;
    fs.appendFileSync(path.join(String(userDataDir), 'musician.log'), line);
    return true;
  } catch {
    return false;
  }
}

module.exports = { appendMainLog };
