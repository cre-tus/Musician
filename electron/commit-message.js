'use strict';
// AI commit-message generation: prompt building + output cleaning.
// The main handler stays thin (git diff + one-shot `muse exec`); every
// pure rule lives here under unit tests.
const DIFF_MAX_CHARS = 20000;
const STATUS_MAX_CHARS = 4000;
const MESSAGE_MAX_CHARS = 1500;

function cap(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}\n…(truncated)` : s;
}

function buildCommitPrompt({ status, diff, lang }) {
  const locale = lang === 'en' ? 'English' : 'Korean';
  return [
    `Write a git commit message in ${locale} for the change below.`,
    'Rules: output ONLY the commit message, no code fences, no quotes, no explanation.',
    'First line: 50 chars or less, imperative mood, no trailing period.',
    'Add a blank line plus a short body only when the change needs it.',
    '',
    '--- git status --short ---',
    cap(status, STATUS_MAX_CHARS),
    '',
    '--- git diff ---',
    cap(diff, DIFF_MAX_CHARS),
  ].join('\n');
}

function cleanCommitMessage(text) {
  let out = String(text || '').trim();
  // Strip a single wrapping fence or quote pair the model may add anyway.
  const fence = out.match(/^(`{3,})\w*\n([\s\S]*?)\1\s*$/);
  if (fence) out = fence[2].trim();
  const quoted = out.match(/^(['"])([\s\S]*?)\1$/);
  if (quoted) out = quoted[2].trim();
  // Strip common lead-ins ("Commit message: <msg>", "Here's..."). When the
  // message shares the lead-in line, only the prefix is removed.
  const lines = out.split('\n');
  while (lines.length > 0) {
    const stripped = lines[0].replace(/^(commit message\s*[:：]|here('| i)s [^:\n]*?message[^:\n]*?[:：]?|sure\s*[,，])\s*/i, '');
    if (stripped !== lines[0]) {
      lines[0] = stripped;
      if (!stripped.trim()) lines.shift();
      else break;
    } else break;
  }
  out = lines.join('\n').trim();
  if (out.length > MESSAGE_MAX_CHARS) out = out.slice(0, MESSAGE_MAX_CHARS).trimEnd();
  return out;
}

module.exports = { DIFF_MAX_CHARS, STATUS_MAX_CHARS, MESSAGE_MAX_CHARS, buildCommitPrompt, cleanCommitMessage };
