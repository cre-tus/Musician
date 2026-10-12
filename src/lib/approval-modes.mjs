// Permission (approval mode) values shared by Settings and the composer
// picker. Empty string means "CLI default". Pure + unit-tested; keep in
// sync with APPROVAL_MODES in electron/msp.js.
export const APPROVAL_MODE_VALUES = ['', 'allowAll', 'promptUnmatched', 'onRequest', 'denyUnmatched'];

export function sanitizeApprovalMode(value) {
  return APPROVAL_MODE_VALUES.includes(value) ? value : '';
}

export function approvalModeLabel(value, settingsStrings) {
  const st = settingsStrings && typeof settingsStrings === 'object' ? settingsStrings : {};
  switch (value) {
    case 'allowAll': return st.approvalAllowAll || value;
    case 'promptUnmatched': return st.approvalPromptUnmatched || value;
    case 'onRequest': return st.approvalOnRequest || value;
    case 'denyUnmatched': return st.approvalDenyUnmatched || value;
    default: return st.cliDefault || '';
  }
}
