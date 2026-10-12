import React from 'react';
import type { Goal, GoalStore } from '../lib/goals.mjs';
import { useStrings } from '../lib/lang';
import GoalsTab from './GoalsTab';
import { XIcon } from './icons';

interface Props {
  store: GoalStore;
  onStoreChange: (next: GoalStore) => void;
  sessions: Array<{ id: string; title: string }>;
  activeSessionId: string;
  onJumpToSession: (id: string) => void;
  onGoalStarted: (goal: Goal) => boolean;
  onNewViaChat: () => void;
  onClose: () => void;
}

// Inline goals management: expands above the composer inside the active
// chat pane instead of a screen-centered modal. New goals are never typed
// here — the button below hands off to goal-setup mode in the chat.
export default function GoalsPanel({ store, onStoreChange, sessions, activeSessionId, onJumpToSession, onGoalStarted, onNewViaChat, onClose }: Props) {
  const strings = useStrings();
  const t = strings.goals;

  return (
    <section
      className="goals-panel"
      aria-labelledby="goals-panel-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      }}
    >
      <div className="goals-panel-head">
        <h3 id="goals-panel-title">{t.title}</h3>
        <button
          type="button"
          className="btn goals-chat-new"
          onClick={onNewViaChat}
        >
          {t.setupNew}
        </button>
        <button
          type="button"
          className="icon-btn goals-close"
          onClick={onClose}
          title={t.close}
          aria-label={t.close}
        >
          <XIcon size={14} />
        </button>
      </div>
      <GoalsTab
        store={store}
        onStoreChange={onStoreChange}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onJumpToSession={onJumpToSession}
        onGoalStarted={onGoalStarted}
      />
    </section>
  );
}
