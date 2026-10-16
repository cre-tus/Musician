import React, { useState } from 'react';
import type { MspApproval } from '../types';
import { AlertIcon } from './icons';
import { useStrings } from '../lib/lang';
import { formatStr } from '../lib/i18n.mjs';
import { maskSecrets } from '../lib/secret-mask.mjs';

type Strings = Record<string, Record<string, string>>;

export interface EditedRunResult {
  ok: boolean;
  code?: number | null;
  tail?: string;
  error?: string;
}

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

function Card({
  item,
  cwd,
  onDecide,
  onRunEdited,
  onDismiss,
}: {
  item: MspApproval;
  cwd: string;
  onDecide: (key: string, choiceId: string, feedback?: string) => void;
  onRunEdited?: (key: string, denyChoiceId: string, runCwd: string, command: string) => Promise<EditedRunResult>;
  onDismiss?: (key: string) => void;
}) {
  const s = useStrings();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const subj = item.approval.subject || {};
  const isShell = subj.kind === 'shell';
  const [cmd, setCmd] = useState(subj.command || '');
  const [editCwd, setEditCwd] = useState(cwd);
  const [runBusy, setRunBusy] = useState(false);
  const [runResult, setRunResult] = useState<EditedRunResult | null>(null);
  const showFeedback = item.approval.choices.some((c) => c.acceptsFeedback);
  const denyChoice = item.approval.choices.find((c) => c.decision === 'deny');
  const decide = (choiceId: string) => {
    if (busy || runBusy) return;
    setBusy(true);
    onDecide(item.key, choiceId, showFeedback && feedback.trim() ? feedback.trim() : undefined);
  };
  const canEditRun = isShell && !!onRunEdited && !!denyChoice && !busy && !runBusy
    && cmd.trim().length > 0 && editCwd.trim().length > 0;
  const runEdited = async () => {
    if (!canEditRun || !onRunEdited || !denyChoice) return;
    setRunBusy(true);
    try {
      setRunResult(await onRunEdited(item.key, denyChoice.choiceId, editCwd.trim(), cmd.trim()));
    } catch (e) {
      setRunResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunBusy(false);
    }
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
          <pre className="stderr">{maskSecrets(item.approval.rawArgs)}</pre>
        </details>
      )}
      {isShell && onRunEdited && !runResult && (
        <div className="approval-edit">
          <label className="approval-edit-row">
            <span>{s.approval.editCwdLabel}</span>
            <input
              value={editCwd}
              onChange={(e) => setEditCwd(e.target.value)}
              spellCheck={false}
              disabled={busy || runBusy}
            />
          </label>
          <label className="approval-edit-col">
            <span>{s.approval.editCmdLabel}</span>
            <textarea
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              rows={2}
              spellCheck={false}
              disabled={busy || runBusy}
            />
          </label>
          <button
            type="button"
            className="mini-btn"
            disabled={!canEditRun}
            title={denyChoice ? s.approval.editRunTitle : s.approval.editRunNoDeny}
            onClick={() => void runEdited()}
          >
            {runBusy ? '…' : s.approval.editRun}
          </button>
        </div>
      )}
      {runResult && (
        <div className="approval-result">
          <span className={runResult.ok ? 'code-ok' : 'code-bad'}>
            {formatStr(s.approval.editRunExit, { code: runResult.code ?? '?' })}
          </span>
          {(runResult.tail || runResult.error) && (
            <pre className="stderr">{maskSecrets((runResult.tail || runResult.error || '').slice(-4000))}</pre>
          )}
          <button type="button" className="mini-btn" onClick={() => onDismiss && onDismiss(item.key)}>
            {s.common.close}
          </button>
        </div>
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

export default function ApprovalPanel({
  approvals,
  cwd,
  onDecide,
  onRunEdited,
  onDismiss,
}: {
  approvals: MspApproval[];
  cwd: string;
  onDecide: (key: string, choiceId: string, feedback?: string) => void;
  onRunEdited?: (key: string, denyChoiceId: string, runCwd: string, command: string) => Promise<EditedRunResult>;
  onDismiss?: (key: string) => void;
}) {
  if (approvals.length === 0) return null;
  return (
    <div className="approval-list">
      {approvals.map((a) => (
        <Card key={a.key} item={a} cwd={cwd} onDecide={onDecide} onRunEdited={onRunEdited} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
