// Diff line comments: a `path:line` fix request seeded into the composer.
// The user finishes the comment in the composer and sends it — nothing is
// auto-sent, mirroring the selection-question flow. Line numbers always
// refer to the modified (current) side of the diff.
export function formatLineCommentPrompt(args, uiLang = 'ko') {
  const { relativePath, line } = args && typeof args === 'object' ? args : {};
  const lineNo = Number(line);
  if (!Number.isInteger(lineNo) || lineNo <= 0) return '';
  const raw = String(relativePath || '').trim();
  if (!raw) return '';
  const en = uiLang === 'en';
  const path = raw.replace(/[`\\]/g, '\\$&');
  if (en) return `Fix request for \`${path}\` (line ${lineNo}).\n\nRequest: `;
  return `\`${path}\` (줄 ${lineNo}) 수정 요청.\n\n요청: `;
}
