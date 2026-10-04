'use strict';
// Safe filename for the export-markdown save dialog default path.
// Pure (dialog + write stay in the main handler); mirrors the legacy
// sanitization exactly: collapse newlines/tabs, strip Windows-illegal
// characters and trailing dots/spaces, cap at 120 chars, fall back to the
// default title when nothing remains.
function exportMarkdownFilename(rawTitle) {
  const title = String(rawTitle || 'Musician 대화').replace(/[\r\n\t]+/g, ' ').trim() || 'Musician 대화';
  return title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').slice(0, 120) || 'Musician 대화';
}

module.exports = { exportMarkdownFilename };
