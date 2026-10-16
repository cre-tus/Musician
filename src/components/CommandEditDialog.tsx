import React, { useEffect, useRef, useState } from 'react';
import { clearDraft, draftKey as makeDraftKey, readDraft, writeDraft } from '../lib/modal-drafts.mjs';
import { useStrings } from '../lib/lang';

export interface CommandEditResult {
  cwd: string;
  cmd: string;
}

// One shared "review the command and working folder, edit, then run"
// dialog: custom verify commands use it before each run. Cancel always
// comes first; the run action is the emphasized primary button. A dirty
// backdrop click never discards edits, and per-run drafts survive an
// accidental close or restart.
export default function CommandEditDialog({
  title,
  cmdLabel,
  cwdLabel,
  initialCmd,
  initialCwd,
  confirmLabel,
  cancelLabel,
  busy,
  draftKey,
  onConfirm,
  onClose,
}: {
  title: string;
  cmdLabel: string;
  cwdLabel: string;
  initialCmd: string;
  initialCwd: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  draftKey?: string;
  onConfirm: (result: CommandEditResult) => void;
  onClose: () => void;
}) {
  const strings = useStrings();
  const chat = strings.chat;
  const [cmd, setCmd] = useState(initialCmd);
  const [cwd, setCwd] = useState(initialCwd);
  const [restored, setRestored] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const cwdRef = useRef<HTMLInputElement | null>(null);
  const restoredOnce = useRef(false);
  const storageKey = draftKey ? makeDraftKey('cmdedit', draftKey) : null;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cwdRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Restore this run's draft once; other runs keep their own key.
  useEffect(() => {
    if (restoredOnce.current || !storageKey) return;
    restoredOnce.current = true;
    try {
      const raw = readDraft(undefined, storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { cwd?: unknown; cmd?: unknown };
      const nextCwd = typeof saved.cwd === 'string' ? saved.cwd : '';
      const nextCmd = typeof saved.cmd === 'string' ? saved.cmd : '';
      if ((nextCwd || nextCmd) && (nextCwd !== initialCwd || nextCmd !== initialCmd)) {
        setCwd(nextCwd);
        setCmd(nextCmd);
        setRestored(true);
      }
    } catch {
      // A corrupt draft never blocks the dialog.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !restoredOnce.current) return;
    if (cmd === initialCmd && cwd === initialCwd) {
      if (!restored) clearDraft(undefined, storageKey);
      return;
    }
    writeDraft(undefined, storageKey, JSON.stringify({ cwd, cmd }));
  }, [cmd, cwd, initialCmd, initialCwd, restored, storageKey]);

  const dirty = cmd !== initialCmd || cwd !== initialCwd;
  const cwdEmpty = cwd.trim().length === 0;
  const cmdEmpty = cmd.trim().length === 0;
  const canRun = !cwdEmpty && !cmdEmpty && !busy;
  const shell = typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent) ? 'PowerShell' : 'sh';

  const discardDraft = () => {
    if (storageKey) clearDraft(undefined, storageKey);
    setCwd(initialCwd);
    setCmd(initialCmd);
    setRestored(false);
  };

  const confirm = () => {
    if (storageKey) clearDraft(undefined, storageKey);
    onConfirm({ cwd: cwd.trim(), cmd: cmd.trim() });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !dirty) onClose(); }}>
      <section
        ref={dialogRef}
        className="modal cmdedit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmdedit-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Tab' && dialogRef.current) {
            const controls = Array.from(
              dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'),
            );
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="modal-header">
          <div className="modal-title-block">
            <h3 id="cmdedit-title">{title}</h3>
          </div>
        </div>
        <div className="modal-body">
          {restored && (
            <p className="draft-note">
              {chat.cmdDraftRestored}
              <button className="mini-btn" type="button" disabled={busy} onClick={discardDraft}>{chat.cmdDiscardDraft}</button>
            </p>
          )}
          <label className="field">
            {cwdLabel}
            <input
              ref={cwdRef}
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
              disabled={busy}
              aria-invalid={cwdEmpty}
            />
          </label>
          {cwdEmpty && <p className="field-error" role="alert">{chat.cmdBadCwd}</p>}
          <label className="field">
            {cmdLabel}
            <textarea
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              rows={4}
              spellCheck={false}
              disabled={busy}
              aria-invalid={cmdEmpty}
            />
          </label>
          {cmdEmpty && <p className="field-error" role="alert">{chat.cmdBadCmd}</p>}
          <div className="cmd-preview" aria-label={chat.cmdPreview}>
            <span className="cmd-preview-title">{chat.cmdPreview}</span>
            <div className="cmd-preview-row">
              <span>{cmdLabel}</span>
              <code>{cmd.trim() || '—'}</code>
            </div>
            <div className="cmd-preview-row">
              <span>{cwdLabel}</span>
              <code>{cwd.trim() || '—'}</code>
            </div>
            <div className="cmd-preview-row">
              <span>{chat.cmdShell}</span>
              <code>{shell}</code>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canRun}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
