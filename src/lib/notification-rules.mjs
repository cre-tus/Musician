export function shouldShowBackgroundNotification({ enabled, isActiveSession, windowFocused, willContinueAutomatically }) {
  return !!enabled && (!isActiveSession || !windowFocused) && !willContinueAutomatically;
}

export function runNotificationStatus({ cancelled, completedSuccessfully }) {
  if (cancelled) return 'stopped';
  return completedSuccessfully ? 'success' : 'failed';
}
