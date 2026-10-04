'use strict';

function browserTabShortcut(input) {
  if (!input || input.type !== 'keyDown') return null;
  const key = String(input.key || '').toLowerCase();
  if (!(input.control || input.meta)) return null;

  if (input.shift && key === 'p') return 'command-palette';
  if (key === 'p') return 'quick-open';
  if (key === 'k') return 'command-palette';
  if (input.shift && key === 't') return 'reopen-closed-file';
  if (input.shift && key === 'f') return 'find-in-files';
  if (!input.shift && /^[1-9]$/.test(key)) return `select-tab-${key}`;
  if (input.shift && key === 'e') return 'open-explorer';
  if (!input.shift && !input.alt && key === 'b') return 'toggle-sidebar';
  if (input.alt && key === 'e') return 'toggle-editor';
  if (input.code === 'Comma' || key === ',') return 'open-settings';
  if (key === 'l') return 'focus-address';
  if (key === 'f') return 'find-in-page';
  if (key === 'w') return input.shift ? 'close-all-tabs' : 'close-tab';
  if (key === 'tab') return input.shift ? 'recent-tab-previous' : 'recent-tab-next';
  if (key === 'pageup' || key === 'pagedown') {
    const direction = key === 'pagedown' ? 'right' : 'left';
    return input.shift ? `move-tab-${direction}` : `ordered-tab-${direction}`;
  }
  return null;
}

module.exports = { browserTabShortcut };
