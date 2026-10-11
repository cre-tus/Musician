import React, { useEffect, useRef } from 'react';
import type { GoalStore } from '../lib/goals.mjs';
import { useStrings } from '../lib/lang';
import GoalsTab from './GoalsTab';
import { XIcon } from './icons';

interface Props {
  store: GoalStore;
  onStoreChange: (next: GoalStore) => void;
  sessions: Array<{ id: string; title: string }>;
  activeSessionId: string;
  onJumpToSession: (id: string) => void;
  onClose: () => void;
}

export default function GoalsDialog({ store, onStoreChange, sessions, activeSessionId, onJumpToSession, onClose }: Props) {
  const strings = useStrings();
  const t = strings.goals;
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="modal modal-lg goals-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="goals-dialog-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        }}
      >
        <div className="modal-header">
          <h3 id="goals-dialog-title">{t.title}</h3>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn goals-close"
            onClick={onClose}
            title={t.close}
            aria-label={t.close}
          >
            <XIcon size={14} />
          </button>
        </div>
        <div className="modal-body">
          <GoalsTab
            store={store}
            onStoreChange={onStoreChange}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onJumpToSession={onJumpToSession}
          />
        </div>
      </section>
    </div>
  );
}
