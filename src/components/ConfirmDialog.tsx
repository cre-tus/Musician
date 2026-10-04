import React, { useEffect, useRef } from 'react';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  alternateLabel?: string;
  destructive?: boolean;
}

export type ConfirmResult = 'confirm' | 'alternate' | 'cancel';

interface Props extends ConfirmOptions {
  onResolve: (result: ConfirmResult) => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, alternateLabel, destructive = false, onResolve }: Props) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  return (
      <div className="modal-backdrop confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onResolve('cancel'); }}>
      <section
        ref={dialogRef}
        className="modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onResolve('cancel'); }
          else if (event.key === 'Tab') {
            const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') || []);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
      >
        <div className="modal-header"><h3 id="confirm-dialog-title">{title}</h3></div>
        <div className="modal-body"><p id="confirm-dialog-message" className="confirm-dialog-message">{message}</p></div>
        <div className="modal-footer">
          <button ref={cancelRef} className="btn" type="button" onClick={() => onResolve('cancel')}>취소</button>
          {alternateLabel && <button className="btn" type="button" onClick={() => onResolve('alternate')}>{alternateLabel}</button>}
          <button className={destructive ? 'btn-danger' : 'btn-primary'} type="button" onClick={() => onResolve('confirm')}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
