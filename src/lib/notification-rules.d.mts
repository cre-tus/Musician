export function shouldShowBackgroundNotification(state: {
  enabled: boolean;
  isActiveSession: boolean;
  windowFocused: boolean;
  willContinueAutomatically: boolean;
}): boolean;
export function runNotificationStatus(state: {
  cancelled: boolean;
  completedSuccessfully: boolean;
}): 'success' | 'failed' | 'stopped';
