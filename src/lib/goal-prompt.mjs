// Per-turn goal context: a started goal linked to the session travels on
// the wire so the agent works toward it. Notes ride capped — the full
// memo stays in the goals panel, not in every turn.
export const GOAL_NOTES_CONTEXT_LIMIT = 500;

export function activeLinkedGoal(store, sessionId) {
  if (!store || typeof store !== 'object') return null;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  const { goals, activeGoalId } = store;
  if (typeof activeGoalId !== 'string' || !Array.isArray(goals)) return null;
  const goal = goals.find((item) => !!item && item.id === activeGoalId);
  if (!goal || goal.status !== 'active') return null;
  if (!Array.isArray(goal.sessionIds) || !goal.sessionIds.includes(sessionId)) return null;
  return goal;
}

export function formatGoalContext(goal, lang) {
  if (!goal || typeof goal !== 'object') return '';
  if (typeof goal.title !== 'string' || goal.title.length === 0) return '';
  const notes = typeof goal.notes === 'string' ? goal.notes.slice(0, GOAL_NOTES_CONTEXT_LIMIT) : '';
  if (lang === 'en') {
    return `[Goal] ${goal.title}`
      + (notes ? `\nNotes: ${notes}` : '')
      + '\nWork toward the goal above while handling the request below.';
  }
  return `[목표] ${goal.title}`
    + (notes ? `\n메모: ${notes}` : '')
    + '\n위 목표를 향해 아래 요청을 처리해줘.';
}

export function applyGoalContext(prompt, goal, lang) {
  const block = formatGoalContext(goal, lang);
  return block ? `${block}\n\n${prompt}` : prompt;
}

export function buildGoalKick(goal, lang) {
  const block = formatGoalContext(goal, lang);
  if (!block) return '';
  const kick = lang === 'en'
    ? 'Start working on the goal above right now. Briefly outline the steps, then execute from the first step.'
    : '위 목표를 지금 바로 시작해줘. 할 일을 짧게 정리하고, 바로 첫 단계부터 실행해줘.';
  return `${block}\n\n${kick}`;
}
