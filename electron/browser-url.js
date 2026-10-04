'use strict';

function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('EMPTY_URL');
  if (/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(s)) return `http://${s}`;
  if (/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\]):\d+(?:[/?#]|$)/i.test(s)) return `https://${s}`;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s; // Explicit URL scheme.
  return `https://${s}`;
}

const SEARCH_URL = 'https://www.google.com/search?q=';

function looksLikeHost(s) {
  if (/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(s)) return true;
  if (/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\]):\d+(?:[/?#]|$)/i.test(s)) return true;
  return !/\s/.test(s) && s.includes('.');
}

// Address-bar input (typed by the user): URLs navigate, anything else
// becomes a web search. Unlike normalizeUrl this is only for the
// user-typed path — agent/MCP navigation keeps strict URL semantics.
function resolveAddressInput(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('EMPTY_URL');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return normalizeUrl(s);
  if (looksLikeHost(s)) return normalizeUrl(s);
  return `${SEARCH_URL}${encodeURIComponent(s)}`;
}

module.exports = { normalizeUrl, resolveAddressInput };
