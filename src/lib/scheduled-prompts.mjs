const STORAGE_KEY = 'mudex:scheduled-prompts:v1';

export const MAX_SCHEDULED_PROMPTS = 20;
export const STALE_AFTER_MS = 24 * 3600 * 1000;

function isValidItem(item) {
  return (
    !!item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.sessionId === 'string' &&
    item.sessionId.length > 0 &&
    typeof item.text === 'string' &&
    item.text.trim().length > 0 &&
    Number.isFinite(item.fireAt) &&
    Number.isFinite(item.createdAt) &&
    (item.status === 'pending' || item.status === 'fired' || item.status === 'missed')
  );
}

function cleanRepeat(repeat) {
  return repeat === 'daily' || repeat === 'weekly' || repeat === 'monthly' ? repeat : 'once';
}

function cleanItem(item) {
  return {
    id: item.id,
    sessionId: item.sessionId,
    text: item.text.trim(),
    fireAt: item.fireAt,
    createdAt: item.createdAt,
    status: item.status,
    repeat: cleanRepeat(item.repeat),
  };
}

export function normalizeScheduledPrompts(value, limit = MAX_SCHEDULED_PROMPTS) {
  if (!Array.isArray(value)) return [];
  const cap = Number.isInteger(limit) && limit > 0 ? limit : MAX_SCHEDULED_PROMPTS;
  return value
    .filter(isValidItem)
    .map(cleanItem)
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(0, cap);
}

let idCounter = 0;

export function createScheduledPrompt(input) {
  if (!input || typeof input !== 'object') return null;
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId : '';
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const fireAt = input.fireAt;
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  if (!sessionId || !text || !Number.isFinite(fireAt) || fireAt <= now) return null;
  if (text.length > 8000) return null;
  idCounter += 1;
  return {
    id: `sched-${now.toString(36)}-${idCounter.toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`,
    sessionId,
    text,
    fireAt,
    createdAt: now,
    status: 'pending',
    repeat: cleanRepeat(input.repeat),
  };
}

export function addScheduledPrompt(list, item) {
  const current = normalizeScheduledPrompts(list);
  if (!isValidItem(item) || current.length >= MAX_SCHEDULED_PROMPTS) return current;
  return normalizeScheduledPrompts([...current, item]);
}

export function cancelScheduledPrompt(list, id) {
  const current = normalizeScheduledPrompts(list);
  if (typeof id !== 'string' || !current.some((item) => item.id === id)) return current;
  return current.filter((item) => item.id !== id);
}

export function markScheduledPrompt(list, id, status) {
  const current = normalizeScheduledPrompts(list);
  if ((status !== 'fired' && status !== 'missed') || typeof id !== 'string') return current;
  if (!current.some((item) => item.id === id)) return current;
  return current.map((item) => (item.id === id ? { ...item, status } : item));
}

export function dueScheduledPrompts(list, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  return normalizeScheduledPrompts(list).filter((item) => item.status === 'pending' && item.fireAt <= at);
}

function addMonthsCalendar(ms, months) {
  const date = new Date(ms);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date.getTime();
}

export function nextRepeatFireTime(fireAt, repeat, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  if (!Number.isFinite(fireAt)) return null;
  if (repeat === 'monthly') {
    // Calendar-month rollover, preserving wall-clock day/time. Month-end
    // dates clamp into short months (Jan 31 -> Feb 28) and stay clamped.
    let next = fireAt;
    for (let i = 0; i < 1200 && next <= at; i += 1) next = addMonthsCalendar(next, 1);
    return Number.isFinite(next) && next > at ? next : null;
  }
  const step = repeat === 'daily' ? 86400000 : repeat === 'weekly' ? 7 * 86400000 : 0;
  if (step <= 0) return null;
  let next = fireAt;
  // Whole-step rollover: a daily 09:00 stays 09:00 even after days offline.
  while (next <= at) next += step;
  return next;
}

export function rescheduleScheduledPrompt(list, id, patch, now) {
  const current = normalizeScheduledPrompts(list);
  if (typeof id !== 'string' || !patch || typeof patch !== 'object') return current;
  const target = current.find((item) => item.id === id);
  if (!target || target.status !== 'pending') return current;
  const at = Number.isFinite(now) ? now : Date.now();
  const next = { ...target };
  // Atomic: any invalid provided field rejects the whole patch.
  if (patch.text !== undefined) {
    const text = typeof patch.text === 'string' ? patch.text.trim() : '';
    if (!text || text.length > 8000) return current;
    next.text = text;
  }
  if (patch.fireAt !== undefined) {
    if (!Number.isFinite(patch.fireAt) || patch.fireAt <= at) return current;
    next.fireAt = patch.fireAt;
  }
  if (patch.repeat !== undefined) next.repeat = cleanRepeat(patch.repeat);
  return normalizeScheduledPrompts(current.map((item) => (item.id === id ? next : item)));
}

export function fireableScheduledPrompt(list, id, sessions, firing) {
  if (firing) return null;
  if (typeof id !== 'string') return null;
  const item = normalizeScheduledPrompts(list).find((row) => row.id === id);
  if (!item || item.status !== 'pending') return null;
  const live = Array.isArray(sessions)
    && sessions.some((session) => session && session.id === item.sessionId && !session.archived);
  return live ? item : null;
}

export function rollRepeatingPrompt(list, id, now) {
  const current = normalizeScheduledPrompts(list);
  if (typeof id !== 'string') return current;
  const target = current.find((item) => item.id === id);
  const rolled = target ? nextRepeatFireTime(target.fireAt, target.repeat, now) : null;
  if (!target || rolled === null) return current;
  return current.map((item) => (item.id === id ? { ...item, fireAt: rolled, status: 'pending' } : item));
}

export function formatRepeat(repeat, lang) {
  const en = lang === 'en';
  if (repeat === 'daily') return en ? 'Daily' : '매일';
  if (repeat === 'weekly') return en ? 'Weekly' : '매주';
  if (repeat === 'monthly') return en ? 'Monthly' : '매월';
  return '';
}

export function staleScheduledPrompts(list, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  return normalizeScheduledPrompts(list).filter(
    (item) => item.status === 'pending' && at - item.fireAt > STALE_AFTER_MS,
  );
}

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function fmtClock(ms) {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatScheduledFireTime(fireAt, now, lang) {
  if (!Number.isFinite(fireAt)) return '';
  const en = lang === 'en';
  const at = Number.isFinite(now) ? now : Date.now();
  const diff = fireAt - at;
  if (diff <= 0) return en ? 'Now' : '지금 실행';
  if (diff < 3600000) {
    const minutes = Math.max(1, Math.round(diff / 60000));
    return en ? `In ${minutes} min` : `${minutes}분 후`;
  }
  if (diff < 24 * 3600000 && startOfDay(fireAt) === startOfDay(at)) {
    const hours = Math.floor(diff / 3600000);
    if (hours >= 1 && diff < (hours + 1) * 3600000 && hours < 6) return en ? `In ${hours}h` : `${hours}시간 후`;
    return en ? `Today ${fmtClock(fireAt)}` : `오늘 ${fmtClock(fireAt)}`;
  }
  const tomorrow = startOfDay(at) + 86400000;
  if (startOfDay(fireAt) === tomorrow) return en ? `Tomorrow ${fmtClock(fireAt)}` : `내일 ${fmtClock(fireAt)}`;
  const date = new Date(fireAt);
  return `${date.getMonth() + 1}-${date.getDate()} ${fmtClock(fireAt)}`;
}

export function readScheduledPrompts(storage) {
  try {
    const target = storage || globalThis.localStorage;
    const raw = target?.getItem(STORAGE_KEY);
    return normalizeScheduledPrompts(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function writeScheduledPrompts(list, storage) {
  try {
    const target = storage || globalThis.localStorage;
    target?.setItem(STORAGE_KEY, JSON.stringify(normalizeScheduledPrompts(list)));
  } catch {
    // Scheduled prompts are a convenience; the composer keeps working if storage is unavailable.
  }
}
