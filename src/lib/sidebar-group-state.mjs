export function parseSidebarGroupState(serialized) {
  try {
    const value = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, expanded]) => key && typeof expanded === 'boolean')
        .slice(-300),
    );
  } catch {
    return {};
  }
}

export function toggleSidebarGroup(state, key) {
  return { ...state, [key]: state[key] === false };
}
