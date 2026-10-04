import React, { useState } from 'react';
import type { MspApproval } from '../types';
import { AlertIcon } from './icons';

function subjectSummary(a: MspApproval['approval']): string {
  const s = a.subject || {};
  switch (s.kind) {
    case 'shell':
      return s.command || a.toolName;
    case 'fileAccess':
      return `${s.access || '파일'}: ${s.path || s.target || ''}`.trim();
    case 'network':
      return `${s.protocol || 'net'}: ${s.host || s.target || ''}`.trim();
    default:
      return s.target || s.path || s.command || a.toolName || s.kind || '승인 요청';
  }
}

function scopeLabel(scope: string): string {
  if (scope === 'session') return '세션';
  if (scope === 'localPersistent') return '계속';
  return '한 번';
}

function Card({ item, onDecide }: { item: MspApproval; onDecide: (key: string, choiceId: string, feedback?: string) => void }) {
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
          <b>{item.approval.toolName || '도구'} 승인 요청</b>
          <div className="approval-sub">{subjectSummary(item.approval)}</div>
        </div>
      </div>
      {item.approval.rawArgs && (
        <details>
          <summary>인자 보기</summary>
          <pre className="stderr">{item.approval.rawArgs}</pre>
        </details>
      )}
      {showFeedback && (
        <input
          className="approval-feedback"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="모델에게 전달할 말 (선택)"
          disabled={busy}
        />
      )}
      <div className="approval-choices">
        {item.approval.choices.map((c) => (
          <button key={c.choiceId} className="btn" onClick={() => decide(c.choiceId)} disabled={busy} title={c.rulePreview || c.decision}>
            {c.label} <span className="src-tag">{scopeLabel(c.scope)}</span>
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
