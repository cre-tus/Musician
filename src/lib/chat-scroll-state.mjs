export function parseChatScrollState(serialized) {
  try {
    const value = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || !Number.isFinite(value.scrollTop) || value.scrollTop < 0) return null;
    return { scrollTop: Math.floor(value.scrollTop), follow: value.follow !== false };
  } catch {
    return null;
  }
}

export function clampChatScrollTop(state, maxScrollTop) {
  if (!state || !Number.isFinite(maxScrollTop)) return 0;
  return Math.min(Math.max(0, state.scrollTop), Math.max(0, maxScrollTop));
}
