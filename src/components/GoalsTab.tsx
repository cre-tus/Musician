import React, { useEffect, useState } from 'react';
import type { Goal, GoalStore } from '../lib/goals.mjs';
import {
  MAX_GOALS,
  addGoal,
  createGoal,
  linkGoalSession,
  normalizeGoalStore,
  pruneGoalSessions,
  removeGoal,
  setGoalProgress,
  startGoal,
  stopGoal,
  summarizeGoals,
  toggleGoalDone,
  unlinkGoalSession,
  updateGoal,
} from '../lib/goals.mjs';
import { formatStr } from '../lib/i18n.mjs';
import { useStrings } from '../lib/lang';
import { CheckIcon, PlusIcon, TrashIcon, XIcon } from './icons';

interface Props {
  store: GoalStore;
  onStoreChange: (next: GoalStore) => void;
  sessions: Array<{ id: string; title: string }>;
  activeSessionId: string;
  onJumpToSession: (id: string) => void;
}

// Long-term goals across sessions: a plain list with manual progress,
// notes, links to the sessions working toward each goal, and one global
// current goal (started) shown as a gauge above the chat. The store lives
// in App so the chat gauge and this list stay in sync.
export default function GoalsTab({ store, onStoreChange, sessions, activeSessionId, onJumpToSession }: Props) {
  const strings = useStrings();
  const t = strings.goals;
  const goals = store.goals;
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');

  const updateGoals = (next: Goal[]) => {
    onStoreChange(normalizeGoalStore({ goals: next, activeGoalId: store.activeGoalId }));
  };

  // Drop links to deleted sessions; no-op when every link is live.
  const sessionIds = sessions.map((session) => session.id).join('\0');
  useEffect(() => {
    const live = sessionIds.split('\0').filter((id) => id.length > 0);
    const liveSet = new Set(live);
    if (store.goals.every((goal) => goal.sessionIds.every((sid) => liveSet.has(sid)))) return;
    onStoreChange(normalizeGoalStore({
      goals: pruneGoalSessions(store.goals, live),
      activeGoalId: store.activeGoalId,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIds]);

  const summary = summarizeGoals(goals);
  const titles = new Map(sessions.map((session) => [session.id, session.title]));

  const submitDraft = (event?: React.FormEvent) => {
    event?.preventDefault();
    const created = createGoal({ title: draft });
    if (!created) return;
    if (goals.length >= MAX_GOALS) {
      setNotice(formatStr(t.full, { n: MAX_GOALS }));
      return;
    }
    setNotice('');
    updateGoals(addGoal(goals, created));
    setDraft('');
  };

  const expand = (goal: Goal) => {
    if (expandedId === goal.id) {
      setExpandedId(null);
      return;
    }
    setTitleDraft(goal.title);
    setNotesDraft(goal.notes);
    setExpandedId(goal.id);
  };

  const commitTitle = (goal: Goal) => {
    if (titleDraft.trim() && titleDraft.trim() !== goal.title) {
      updateGoals(updateGoal(goals, goal.id, { title: titleDraft }));
    }
  };

  const commitNotes = (goal: Goal) => {
    if (notesDraft.trim() !== goal.notes) {
      updateGoals(updateGoal(goals, goal.id, { notes: notesDraft }));
    }
  };

  return (
    <div className="goals-tab">
      <div className="goals-head">
        <span className="goals-summary">
          {formatStr(t.summary, { active: summary.active, done: summary.done, avg: summary.avgProgress })}
        </span>
      </div>
      <form className="goals-new" onSubmit={submitDraft}>
        <input
          className="goals-new-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t.newPlaceholder}
          maxLength={200}
          aria-label={t.newPlaceholder}
        />
        <button type="submit" className="btn goals-add" disabled={!draft.trim()}>
          <PlusIcon size={13} /> {t.add}
        </button>
      </form>
      {notice && <div className="goals-notice" role="status">{notice}</div>}
      {goals.length === 0 && <div className="goals-empty">{t.empty}</div>}
      <div className="goals-list">
        {goals.map((goal) => {
          const expanded = expandedId === goal.id;
          const started = store.activeGoalId === goal.id;
          const linkedCurrent = activeSessionId.length > 0 && goal.sessionIds.includes(activeSessionId);
          return (
            <div key={goal.id} className={`goals-row${goal.status === 'done' ? ' is-done' : ''}${expanded ? ' is-open' : ''}${started ? ' is-active' : ''}`}>
              <div className="goals-row-main">
                <button
                  type="button"
                  className="goals-check"
                  role="checkbox"
                  aria-checked={goal.status === 'done'}
                  title={goal.status === 'done' ? t.reopen : t.done}
                  aria-label={goal.status === 'done' ? t.reopen : t.done}
                  onClick={() => updateGoals(toggleGoalDone(goals, goal.id))}
                >
                  {goal.status === 'done' && <CheckIcon size={13} />}
                </button>
                <button type="button" className="goals-name" onClick={() => expand(goal)} aria-expanded={expanded}>
                  <span className="goals-name-text">{goal.title}</span>
                </button>
                <button
                  type="button"
                  className="btn goals-start"
                  aria-pressed={started}
                  title={started ? t.stop : t.start}
                  onClick={() => onStoreChange(started ? stopGoal(store) : startGoal(store, goal.id))}
                >
                  {started ? t.stop : t.start}
                </button>
                <span className="goals-pct" aria-label={`${t.progress} ${goal.progress}%`}>{goal.progress}%</span>
                <button
                  type="button"
                  className="icon-btn goals-delete"
                  title={t.remove}
                  aria-label={`${t.remove}: ${goal.title}`}
                  onClick={() => updateGoals(removeGoal(goals, goal.id))}
                >
                  <TrashIcon size={13} />
                </button>
              </div>
              <div className="goals-bar" aria-hidden="true">
                <div className="goals-fill" style={{ width: `${goal.progress}%` }} />
              </div>
              {expanded && (
                <div className="goals-detail">
                  <label className="goals-field">
                    <span className="goals-label">{t.editTitle}</span>
                    <input
                      className="goals-title-input"
                      value={titleDraft}
                      maxLength={200}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={() => commitTitle(goal)}
                    />
                  </label>
                  <label className="goals-field">
                    <span className="goals-label">{t.progress}</span>
                    <input
                      type="range"
                      className="goals-progress"
                      min={0}
                      max={100}
                      step={1}
                      value={goal.progress}
                      aria-label={t.progress}
                      onChange={(event) => updateGoals(setGoalProgress(goals, goal.id, Number(event.target.value)))}
                    />
                  </label>
                  <label className="goals-field">
                    <span className="goals-label">{t.notes}</span>
                    <textarea
                      className="goals-notes"
                      value={notesDraft}
                      placeholder={t.notesPlaceholder}
                      rows={2}
                      onChange={(event) => setNotesDraft(event.target.value)}
                      onBlur={() => commitNotes(goal)}
                    />
                  </label>
                  <div className="goals-links">
                    <span className="goals-label">{t.linked}</span>
                    {goal.sessionIds.length === 0 && <span className="goals-nolinks">{t.noLinks}</span>}
                    {goal.sessionIds.map((sid) => (
                      <span key={sid} className="goals-chip">
                        <button
                          type="button"
                          className="goals-chip-jump"
                          title={titles.get(sid) || sid}
                          onClick={() => onJumpToSession(sid)}
                        >
                          {titles.get(sid) || sid.slice(0, 8)}
                        </button>
                        <button
                          type="button"
                          className="icon-btn goals-unlink"
                          title={t.unlink}
                          aria-label={`${t.unlink}: ${titles.get(sid) || sid}`}
                          onClick={() => updateGoals(unlinkGoalSession(goals, goal.id, sid))}
                        >
                          <XIcon size={11} />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="btn goals-link-current"
                      disabled={linkedCurrent || activeSessionId.length === 0}
                      onClick={() => updateGoals(linkGoalSession(goals, goal.id, activeSessionId))}
                    >
                      {t.linkCurrent}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
