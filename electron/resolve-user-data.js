'use strict';
// Resolve the Electron userData directory. E2E rigs pass an isolated dir
// via MUSICIAN_E2E_USERDATA; otherwise keep the pre-rename dir so
// settings/sessions survive the rebrand.
// resolveUserDataDir({ env, appData, isDirectory }) -> string
function resolveUserDataDir({ env, appData, isDirectory } = {}) {
  const e2e = env && typeof env.MUSICIAN_E2E_USERDATA === 'string' ? env.MUSICIAN_E2E_USERDATA.trim() : '';
  if (e2e) return e2e;
  const base = String(appData || '');
  const has = typeof isDirectory === 'function' ? isDirectory : () => false;
  const path = require('node:path');
  const legacy = ['Mudex', 'mudex']
    .map((n) => path.join(base, n))
    .find((p) => {
      try {
        return has(p);
      } catch {
        return false;
      }
    });
  return legacy || path.join(base, 'Mudex');
}

module.exports = { resolveUserDataDir };
