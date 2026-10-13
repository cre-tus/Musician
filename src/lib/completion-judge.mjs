// Completion verdicts from observable signals only: tool outcomes, verify
// exit codes, todo states, and the linked goal's own status. Nothing here
// reads minds — a turn with failing tools or open todos is `open`, never
// `met`, and only a clean board with no linked goal (or a done one) is
// `met`. Reasons are stable codes; rendering lives in i18n.
export const COMPLETION_MET = 'met';
export const COMPLETION_OPEN = 'open';
export const COMPLETION_FAILED = 'failed';

function hasFailedTools(tools) {
  if (!Array.isArray(tools)) return false;
  return tools.some((t) => {
    if (!t || typeof t !== 'object') return false;
    if (t.status === 'failed') return true;
    if (t.exitCode !== null && t.exitCode !== undefined && Number(t.exitCode) !== 0) return true;
    return false;
  });
}

// MspTodo marks finished work `completed` (`cancelled` is dropped work, not
// open work) — the same closed set turn-resume uses, so the verdict and the
// resume handoff never disagree about what is left.
function hasOpenTodos(todos) {
  if (!Array.isArray(todos)) return false;
  return todos.some((t) => {
    if (!t || typeof t !== 'object') return false;
    return t.status !== 'done' && t.status !== 'completed' && t.status !== 'cancelled';
  });
}

export function judgeCompletion({ goal, verify, todos, tools, timedOut, error, cancelled, tokenLimit } = {}) {
  const reasons = [];
  const cancelError = typeof error === 'string' && error.toUpperCase().includes('CANCEL');
  // A timeout is a timeout even though it arrives as an error string, and a
  // user cancel is an interruption, not a failure — both keep their own
  // reason instead of collapsing into the generic turn-error.
  if (timedOut) return { state: COMPLETION_FAILED, reasons: ['timed-out'] };
  if (error && !(cancelled && cancelError)) return { state: COMPLETION_FAILED, reasons: ['turn-error'] };
  if (cancelled || cancelError) reasons.push('cancelled');
  if (tokenLimit) reasons.push('token-limit');
  if (hasFailedTools(tools)) reasons.push('tools-failed');
  if (verify && typeof verify === 'object' && verify.code !== null && verify.code !== undefined && Number(verify.code) !== 0) {
    reasons.push('verify-failed');
  }
  if (hasOpenTodos(todos)) reasons.push('todos-open');
  if (goal && typeof goal === 'object' && goal.status !== 'done') reasons.push('goal-open');
  if (reasons.length > 0) return { state: COMPLETION_OPEN, reasons };
  return { state: COMPLETION_MET, reasons: [] };
}

// Render helper: maps a verdict to display text using caller-supplied
// labels ({ state: { met, open, failed }, reasons: { [code]: text } }).
// Unknown reason codes fall back to the raw code so nothing is hidden.
export function completionVerdictLabel(record, labels) {
  if (!record || typeof record !== 'object') return '';
  const l = (labels && typeof labels === 'object') ? labels : {};
  const states = (l && l.state) || {};
  const stateText =
    record.state === COMPLETION_MET ? states.met
    : record.state === COMPLETION_FAILED ? states.failed
    : states.open;
  const reasonMap = (l && l.reasons) || {};
  const reasons = Array.isArray(record.reasons) ? record.reasons : [];
  const reasonText = reasons.map((r) => reasonMap[r] || String(r)).filter(Boolean).join(', ');
  return reasonText ? `${stateText || record.state} — ${reasonText}` : (stateText || String(record.state || ''));
}
