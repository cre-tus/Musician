const STORAGE_KEY = 'mudex:goals:v1';

export const MAX_GOALS = 50;
export const MAX_GOAL_TITLE = 200;
export const MAX_GOAL_NOTES = 8000;
export const MAX_GOAL_LINKS = 20;

function isValidGoal(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    (value.status === 'active' || value.status === 'done') &&
    Number.isFinite(value.progress) &&
    Number.isFinite(value.createdAt) &&
    Number.isFinite(value.updatedAt)
  );
}

function cleanProgress(progress) {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function cleanSessionIds(sessionIds) {
  if (!Array.isArray(sessionIds)) return [];
  const seen = new Set();
  const out = [];
  for (const id of sessionIds) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_GOAL_LINKS) break;
  }
  return out;
}

function cleanGoal(value) {
  return {
    id: value.id,
    title: value.title.trim().slice(0, MAX_GOAL_TITLE),
    notes: typeof value.notes === 'string' ? value.notes.trim().slice(0, MAX_GOAL_NOTES) : '',
    status: value.status,
    progress: cleanProgress(value.progress),
    sessionIds: cleanSessionIds(value.sessionIds),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function compareGoals(a, b) {
  if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return b.createdAt - a.createdAt;
}

export function normalizeGoals(value, limit = MAX_GOALS) {
  if (!Array.isArray(value)) return [];
  const cap = Number.isInteger(limit) && limit > 0 ? limit : MAX_GOALS;
  return value
    .filter(isValidGoal)
    .map(cleanGoal)
    .sort(compareGoals)
    .slice(0, cap);
}

let idCounter = 0;

export function createGoal(input) {
  if (!input || typeof input !== 'object') return null;
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  if (!title || title.length > MAX_GOAL_TITLE) return null;
  if (notes.length > MAX_GOAL_NOTES) return null;
  idCounter += 1;
  return {
    id: `goal-${now.toString(36)}-${idCounter.toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`,
    title,
    notes,
    status: 'active',
    progress: 0,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function addGoal(list, item) {
  const current = normalizeGoals(list);
  if (!isValidGoal(item) || current.length >= MAX_GOALS) return current;
  return normalizeGoals([...current, item]);
}

export function removeGoal(list, id) {
  const current = normalizeGoals(list);
  if (typeof id !== 'string' || !current.some((item) => item.id === id)) return current;
  return current.filter((item) => item.id !== id);
}

export function updateGoal(list, id, patch, now) {
  const current = normalizeGoals(list);
  if (typeof id !== 'string' || !patch || typeof patch !== 'object') return current;
  const target = current.find((item) => item.id === id);
  if (!target) return current;
  const at = Number.isFinite(now) ? now : Date.now();
  const next = { ...target };
  // Atomic: any invalid provided field rejects the whole patch.
  if (patch.title !== undefined) {
    const title = typeof patch.title === 'string' ? patch.title.trim() : '';
    if (!title || title.length > MAX_GOAL_TITLE) return current;
    next.title = title;
  }
  if (patch.notes !== undefined) {
    const notes = typeof patch.notes === 'string' ? patch.notes.trim() : '';
    if (notes.length > MAX_GOAL_NOTES) return current;
    next.notes = notes;
  }
  next.updatedAt = at;
  return normalizeGoals(current.map((item) => (item.id === id ? next : item)));
}

export function setGoalProgress(list, id, progress, now) {
  const current = normalizeGoals(list);
  if (typeof id !== 'string' || !Number.isFinite(progress)) return current;
  if (!current.some((item) => item.id === id)) return current;
  const at = Number.isFinite(now) ? now : Date.now();
  const pct = cleanProgress(progress);
  return normalizeGoals(current.map((item) => (
    item.id === id ? { ...item, progress: pct, status: pct >= 100 ? 'done' : 'active', updatedAt: at } : item
  )));
}

export function toggleGoalDone(list, id, now) {
  const current = normalizeGoals(list);
  if (typeof id !== 'string') return current;
  const target = current.find((item) => item.id === id);
  if (!target) return current;
  const at = Number.isFinite(now) ? now : Date.now();
  const toDone = target.status !== 'done';
  const next = toDone
    ? { ...target, status: 'done', progress: 100, updatedAt: at }
    : { ...target, status: 'active', progress: target.progress >= 100 ? 99 : target.progress, updatedAt: at };
  return normalizeGoals(current.map((item) => (item.id === id ? next : item)));
}

export function linkGoalSession(list, id, sessionId, now) {
  const current = normalizeGoals(list);
  if (typeof id !== 'string' || typeof sessionId !== 'string' || sessionId.length === 0) return current;
  const target = current.find((item) => item.id === id);
  if (!target || target.sessionIds.includes(sessionId) || target.sessionIds.length >= MAX_GOAL_LINKS) return current;
  const at = Number.isFinite(now) ? now : Date.now();
  return normalizeGoals(current.map((item) => (
    item.id === id ? { ...item, sessionIds: [...item.sessionIds, sessionId], updatedAt: at } : item
  )));
}

export function unlinkGoalSession(list, id, sessionId, now) {
  const current = normalizeGoals(list);
  if (typeof id !== 'string' || typeof sessionId !== 'string') return current;
  const target = current.find((item) => item.id === id);
  if (!target || !target.sessionIds.includes(sessionId)) return current;
  const at = Number.isFinite(now) ? now : Date.now();
  return normalizeGoals(current.map((item) => (
    item.id === id ? { ...item, sessionIds: item.sessionIds.filter((sid) => sid !== sessionId), updatedAt: at } : item
  )));
}

export function pruneGoalSessions(list, liveIds) {
  const current = normalizeGoals(list);
  const live = new Set(Array.isArray(liveIds) ? liveIds.filter((id) => typeof id === 'string') : []);
  return current.map((item) => {
    if (item.sessionIds.every((sid) => live.has(sid))) return item;
    return { ...item, sessionIds: item.sessionIds.filter((sid) => live.has(sid)) };
  });
}

export function summarizeGoals(list) {
  const current = normalizeGoals(list);
  const total = current.length;
  if (total === 0) return { total: 0, active: 0, done: 0, avgProgress: 0 };
  const done = current.filter((item) => item.status === 'done').length;
  const avg = current.reduce((sum, item) => sum + item.progress, 0) / total;
  return { total, active: total - done, done, avgProgress: Math.round(avg) };
}

export function normalizeGoalStore(value) {
  // Legacy shape: a bare goals array migrates to { goals, activeGoalId }.
  if (Array.isArray(value)) return { goals: normalizeGoals(value), activeGoalId: null };
  if (!value || typeof value !== 'object') return { goals: [], activeGoalId: null };
  const goals = normalizeGoals(value.goals);
  const activeGoalId = typeof value.activeGoalId === 'string' && goals.some((item) => item.id === value.activeGoalId)
    ? value.activeGoalId
    : null;
  return { goals, activeGoalId };
}

export function startGoal(store, id) {
  const current = normalizeGoalStore(store);
  if (typeof id !== 'string' || !current.goals.some((item) => item.id === id)) return current;
  return { goals: current.goals, activeGoalId: id };
}

export function stopGoal(store) {
  const current = normalizeGoalStore(store);
  return { goals: current.goals, activeGoalId: null };
}

export function activeGoal(store) {
  const current = normalizeGoalStore(store);
  if (!current.activeGoalId) return null;
  return current.goals.find((item) => item.id === current.activeGoalId) || null;
}

export function readGoalStore(storage) {
  try {
    const target = storage || globalThis.localStorage;
    const raw = target?.getItem(STORAGE_KEY);
    return normalizeGoalStore(raw ? JSON.parse(raw) : { goals: [], activeGoalId: null });
  } catch {
    return { goals: [], activeGoalId: null };
  }
}

export function writeGoalStore(store, storage) {
  try {
    const target = storage || globalThis.localStorage;
    target?.setItem(STORAGE_KEY, JSON.stringify(normalizeGoalStore(store)));
  } catch {
    // Goals are a convenience; the app keeps working if storage is unavailable.
  }
}
