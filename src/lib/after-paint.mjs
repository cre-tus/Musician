// Runs a task after paint when possible, with a timer fallback for occluded
// windows where requestAnimationFrame stays paused. The task runs exactly
// once; the returned cancel suppresses it.
export function scheduleAfterPaint(task, options = {}) {
  const noop = () => {};
  if (typeof task !== 'function') return noop;
  const timeoutMs = typeof options?.timeoutMs === 'number' && options.timeoutMs >= 0 ? options.timeoutMs : 50;
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    task();
  };
  let frame = 0;
  let timer = 0;
  const g = typeof globalThis !== 'undefined' ? globalThis : undefined;
  if (g && typeof g.requestAnimationFrame === 'function') {
    try {
      frame = g.requestAnimationFrame(run);
    } catch {
      frame = 0;
    }
  }
  if (g && typeof g.setTimeout === 'function') {
    timer = g.setTimeout(run, timeoutMs);
  } else if (!frame) {
    run();
  }
  return () => {
    if (done) return;
    done = true;
    try {
      if (frame && typeof g?.cancelAnimationFrame === 'function') g.cancelAnimationFrame(frame);
    } catch {
      /* already fired */
    }
    try {
      if (timer && typeof g?.clearTimeout === 'function') g.clearTimeout(timer);
    } catch {
      /* already fired */
    }
  };
}
