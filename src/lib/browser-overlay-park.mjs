// The native browser view paints above all React UI, so it must park
// whenever a centered App overlay opens (palette, dialogs...). Toasts
// are deliberately excluded — parking on every transient toast flickers.
export function shouldParkBrowserForOverlays(flags) {
  if (!flags || typeof flags !== 'object') return false;
  return Boolean(
    flags.palette
    || flags.quickOpen
    || flags.shortcuts
    || flags.confirm
    || flags.scheduleDraft
    || flags.scheduleList
    || flags.scheduleEdit,
  );
}
