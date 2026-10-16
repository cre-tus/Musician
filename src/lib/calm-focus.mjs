// Calm-work focus guard: when the user enables it, background-caused UI
// moves (auto tab switches, panel opens, focus steals) stay put.
export function isCalmFocus(settings) {
  return !!settings && typeof settings === 'object' && settings.calmFocus === true;
}
