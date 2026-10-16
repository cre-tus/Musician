// Log readability: shared line filter for static outputs (verify tails,
// stderr, tool outputs). Search narrows, errors-only keeps failure lines.
const ERROR_LINE_RE = /error|fail|exception|traceback|warn|경고|오류|실패|문제가 발생|exit [1-9]|code [1-9]|✗|×/i;

export function filterLogLines(text, opts) {
  const o = opts || {};
  if (!String(text || '')) return [];
  const query = String(o.query || '').trim().toLowerCase();
  const lines = String(text || '').split('\n');
  return lines.filter((line) => {
    if (o.errorsOnly && !ERROR_LINE_RE.test(line)) return false;
    if (query && !line.toLowerCase().includes(query)) return false;
    return true;
  });
}
