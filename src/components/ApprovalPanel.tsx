import React, { useState } from 'react';
import type { MspApproval } from '../types';
import { AlertIcon } from './icons';
import { useStrings } from '../lib/lang';
import { formatStr } from '../lib/i18n.mjs';

type Strings = Record<string, Record<string, string>>;

function subjectSummary(a: MspApproval['approval'], s: Strings): string {
  const subj = a.subject || {};
  switch (subj.kind) {
    case 'shell':
      return subj.command || a.toolName;
    case 'fileAccess':
      return `${subj.access || s.approval.fileAccessFallback}: ${subj.path || subj.target || ''}`.trim();
    case 'network':
      return `${subj.protocol || 'net'}: ${subj.host || subj.target || ''}`.trim();
    default:
      return subj.target || subj.path || subj.command || a.toolName || subj.kind || s.approval.requestDefault;
  }
}

function scopeLabel(scope: string, s: Strings): string {
  if (scope === 'session') return s.approval.scopeSession;
  if (scope === 'localPersistent') return s.approval.scopePersistent;
  return s.approval.scopeOnce;
}

function Card({ item, onDecide }: { item: MspApproval; onDecide: (key: string, choiceId: string, feedback?: string) => void }) {
  const s = useStrings();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const showFeedback = item.approval.choices.some((c) => c.acceptsFeedback);
  const decide = (choiceId: string) => {
    if (busy) return;
    setBusy(true);
    onDecide(item.key, choiceId, showFeedback && feedback.trim() ? feedback.trim() : undefined);
  };
  return (
    <div className="approval-card">
      <div className="approval-head">
        <AlertIcon size={15} />
        <div>
          <b>{formatStr(s.approval.approvalRequest, { tool: item.approval.toolName || s.approval.tool })}</b>
          <div className="approval-sub">{subjectSummary(item.approval, s)}</div>
        </div>
      </div>
      {item.approval.rawArgs && (
        <details>
          <summary>{s.approval.showArgs}</summary>
          <pre className="stderr">{item.approval.rawArgs}</pre>
        </details>
      )}
      {showFeedback && (
        <input
          className="approval-feedback"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={s.approval.feedbackPlaceholder}
          disabled={busy}
        />
      )}
      <div className="approval-choices">
        {item.approval.choices.map((c) => (
          <button key={c.choiceId} className="btn" onClick={() => decide(c.choiceId)} disabled={busy} title={c.rulePreview || c.decision}>
            {c.label} <span className="src-tag">{scopeLabel(c.scope, s)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ApprovalPanel({ approvals, onDecide }: { approvals: MspApproval[]; onDecide: (key: string, choiceId: string, feedback?: string) => void }) {
  if (approvals.length === 0) return null;
  return (
    <div className="approval-list">
      {approvals.map((a) => (
        <Card key={a.key} item={a} onDecide={onDecide} />
      ))}
    </div>
  );
}
