// Tell a dropped connection apart from a real task failure. Transient
// means "the link died, the work did not fail": the UI offers a guarded
// reconnect-and-continue instead of a failure verdict, and the retry goes
// through the same single-run guards as any other submit, so reconnecting
// never fires the same turn twice.
const TRANSIENT_RE = /HOST_DEAD|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|socket hang up|connection (?:closed|reset|refused|lost|aborted)|fetch failed|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|read ECONN/i;

// Returns 'transient' | 'fatal' | null (null = no error to classify).
export function classifyRunError(error) {
  if (error === null || error === undefined) return null;
  const msg = String(error.text || error.message || error.error || error);
  if (!msg) return null;
  TRANSIENT_RE.lastIndex = 0;
  return TRANSIENT_RE.test(msg) ? 'transient' : 'fatal';
}

export function isTransientRunError(error) {
  return classifyRunError(error) === 'transient';
}
