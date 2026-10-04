'use strict';

const { normalizeUrl } = require('./browser-url');

function resolveBrowserStartUrl(initialUrl, home) {
  for (const candidate of [initialUrl, home, 'https://www.google.com']) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    try {
      const url = normalizeUrl(candidate);
      const protocol = new URL(url).protocol;
      if (['http:', 'https:', 'file:', 'about:'].includes(protocol)) return url;
    } catch {
      // Ignore corrupt persisted values and try the next fallback.
    }
  }
  return 'https://www.google.com';
}

module.exports = { resolveBrowserStartUrl };
