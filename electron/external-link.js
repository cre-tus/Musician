'use strict';

function normalizeExternalLink(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return null;
    if ((url.protocol === 'https:' || url.protocol === 'http:') && (url.username || url.password)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

module.exports = { normalizeExternalLink };
