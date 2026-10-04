export const MAX_QUEUED_PROMPTS = 20;

export function normalizePromptQueue(value, limit = MAX_QUEUED_PROMPTS) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, Math.max(0, limit));
}

export function enqueuePrompt(queue, prompt, limit = MAX_QUEUED_PROMPTS) {
  const current = normalizePromptQueue(queue, limit);
  if (current.length >= limit || typeof prompt !== 'string' || !prompt.trim()) return current;
  return [...current, prompt.trim()];
}

export function removeQueuedPrompt(queue, index) {
  return extractQueuedPrompt(queue, index).remaining;
}

export function extractQueuedPrompt(queue, index) {
  const current = normalizePromptQueue(queue);
  if (!Number.isInteger(index) || index < 0 || index >= current.length) return { prompt: null, remaining: current };
  return { prompt: current[index], remaining: current.filter((_, itemIndex) => itemIndex !== index) };
}

export function moveQueuedPrompt(queue, index, direction) {
  const current = normalizePromptQueue(queue);
  const target = index + direction;
  if (!Number.isInteger(index) || (direction !== -1 && direction !== 1) || target < 0 || target >= current.length) return current;
  [current[index], current[target]] = [current[target], current[index]];
  return current;
}

export function takeNextPrompt(queue) {
  const current = normalizePromptQueue(queue);
  return { prompt: current[0] ?? null, remaining: current.slice(1) };
}

export function shouldAutoRunQueuedPrompt({ wasRunning, completedSuccessfully, cancelled, queuePaused = false, queueLength }) {
  return !!wasRunning && !!completedSuccessfully && !cancelled && !queuePaused && queueLength > 0;
}
