export function adjacentSessionIndex(currentIndex, count, key) {
  if (!Number.isInteger(count) || count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return Math.min(count - 1, Math.max(-1, currentIndex) + 1);
  if (key === 'ArrowUp') return Math.max(0, Math.min(count - 1, currentIndex) - 1);
  return null;
}
