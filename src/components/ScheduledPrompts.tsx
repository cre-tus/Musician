import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduledPrompt, ScheduledRepeat } from '../lib/scheduled-prompts.mjs';
import { MAX_SCHEDULED_PROMPTS, formatRepeat, formatScheduledFireTime } from '../lib/scheduled-prompts.mjs';
import { useLang, useStrings } from '../lib/lang';
import { formatStr } from '../lib/i18n.mjs';

function toInputValue(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nextMorningNine(now: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

interface SchedulePromptDialogProps {
  draft: string;
  sessionTitle: string;
  mode?: 'create' | 'edit';
  initialFireAt?: number;
  initialRepeat?: ScheduledRepeat;
  onSchedule: (fireAt: number, repeat: ScheduledRepeat, text?: string) => void;
  onClose: () => void;
}

export function SchedulePromptDialog({ draft, sessionTitle, mode, initialFireAt, initialRepeat, onSchedule, onClose }: SchedulePromptDialogProps) {
  const s = useStrings();
  const lang = useLang();
  const edit = mode === 'edit';
  const titleId = edit ? 'schedule-edit-title' : 'schedule-dialog-title';
  const repeatOptions: { value: ScheduledRepeat; label: string }[] = [
    { value: 'once', label: s.schedule.repeatOnce },
    { value: 'daily', label: s.schedule.repeatDaily },
    { value: 'weekly', label: s.schedule.repeatWeekly },
    { value: 'monthly', label: s.schedule.repeatMonthly },
  ];
  const presets = useMemo(() => {
    const now = Date.now();
    return [
      { label: s.schedule.presetMin10, fireAt: now + 10 * 60000 },
      { label: s.schedule.presetMin30, fireAt: now + 30 * 60000 },
      { label: s.schedule.presetHour1, fireAt: now + 3600000 },
      { label: s.schedule.presetHour3, fireAt: now + 3 * 3600000 },
      { label: s.schedule.presetTomorrow9, fireAt: nextMorningNine(now) },
    ];
  }, [s]);
  const [custom, setCustom] = useState(() => toInputValue(Number.isFinite(initialFireAt) ? (initialFireAt as number) : Date.now() + 3600000));
  const [picked, setPicked] = useState<number>(Number.isFinite(initialFireAt) ? (initialFireAt as number) : presets[2].fireAt);
  const [repeat, setRepeat] = useState<ScheduledRepeat>(initialRepeat || 'once');
  const [text, setText] = useState(draft);
  const customMs = useMemo(() => {
    const ms = new Date(custom).getTime();
    return Number.isFinite(ms) ? ms : Number.NaN;
  }, [custom]);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  const textValid = !edit || (text.trim().length > 0 && text.trim().length <= 8000);
  const valid = Number.isFinite(picked) && picked > Date.now() && textValid;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        ref={dialogRef}
        className="modal schedule-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          else if (event.key === 'Tab') {
            const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') || []);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
      >
        <div className="modal-header"><h3 id={titleId}>{edit ? s.schedule.editTitle : s.schedule.createTitle}</h3></div>
        <div className="modal-body">
          <p className="modal-note">{formatStr(s.schedule.noteWhen, { when: edit ? s.schedule.whenEdit : s.schedule.whenCreate })} <code>{sessionTitle}</code> {s.schedule.noteRest}</p>
          {edit ? (
            <textarea
              className="schedule-edit-text"
              aria-label={s.schedule.editTextLabel}
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          ) : (
            <p className="schedule-text">{draft}</p>
          )}
          <div className="schedule-presets" role="group" aria-label={s.schedule.timeGroup}>
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={picked === preset.fireAt ? 'pick active' : 'pick'}
                aria-pressed={picked === preset.fireAt}
                onClick={() => setPicked(preset.fireAt)}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={Number.isFinite(customMs) && picked === customMs ? 'pick active' : 'pick'}
              aria-pressed={Number.isFinite(customMs) && picked === customMs}
              onClick={() => { if (Number.isFinite(customMs)) setPicked(customMs); }}
            >
              {s.schedule.customPick}
            </button>
          </div>
          <div className="schedule-presets" role="group" aria-label={s.schedule.repeatGroup}>
            {repeatOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={repeat === option.value ? 'pick active' : 'pick'}
                aria-pressed={repeat === option.value}
                onClick={() => setRepeat(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="field">
            {s.schedule.dateLabel}
            <input
              type="datetime-local"
              value={custom}
              min={toInputValue(Date.now() + 60000)}
              onChange={(event) => {
                setCustom(event.target.value);
                const ms = new Date(event.target.value).getTime();
                if (Number.isFinite(ms)) setPicked(ms);
              }}
            />
          </label>
          {!valid && <p className="modal-note test-err">{!textValid ? s.schedule.errText : s.schedule.errTime}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn" type="button" onClick={onClose}>{s.common.cancel}</button>
          <button ref={confirmRef} className="btn-primary" type="button" disabled={!valid} onClick={() => onSchedule(picked, repeat, edit ? text : undefined)}>
            {valid ? formatStr(edit ? s.schedule.confirmEdit : s.schedule.confirmCreate, { time: formatScheduledFireTime(picked, undefined, lang) }) + (repeat === 'once' ? '' : formatStr(s.schedule.confirmRepeat, { repeat: formatRepeat(repeat, lang) })) : (edit ? s.schedule.applyEdit : s.schedule.applyCreate)}
          </button>
        </div>
      </section>
    </div>
  );
}

interface ScheduledPromptListDialogProps {
  items: ScheduledPrompt[];
  sessionTitleOf: (sessionId: string) => string;
  onCancel: (id: string) => void;
  onEdit: (id: string) => void;
  onFireNow: (id: string) => void;
  onClose: () => void;
}

export function ScheduledPromptListDialog({ items, sessionTitleOf, onCancel, onEdit, onFireNow, onClose }: ScheduledPromptListDialogProps) {
  const s = useStrings();
  const lang = useLang();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.clearInterval(timer);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const pending = items.filter((item) => item.status === 'pending');
  const history = items.filter((item) => item.status !== 'pending');

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="modal schedule-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-list-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        }}
      >
        <div className="modal-header"><h3 id="schedule-list-title">{s.schedule.listTitle}</h3></div>
        <div className="modal-body">
          {items.length === 0 && <p className="modal-note">{formatStr(s.schedule.emptyNote, { max: MAX_SCHEDULED_PROMPTS })}</p>}
          {pending.length > 0 && (
            <div className="schedule-list" role="list" aria-label={s.schedule.pendingGroup}>
              {pending.map((item) => (
                <div className="schedule-row" role="listitem" key={item.id}>
                  <div className="schedule-row-main">
                    <span className="schedule-row-text" title={item.text}>{item.text}</span>
                    <span className="schedule-row-meta">{sessionTitleOf(item.sessionId)} · {formatScheduledFireTime(item.fireAt, now, lang)}{item.repeat !== 'once' ? formatStr(s.schedule.rowRepeat, { repeat: formatRepeat(item.repeat, lang) }) : ''}</span>
                  </div>
                  <button className="btn" type="button" onClick={() => onFireNow(item.id)}>{s.schedule.fireNow}</button>
                  <button className="btn" type="button" onClick={() => onEdit(item.id)}>{s.schedule.editBtn}</button>
                  <button className="btn" type="button" onClick={() => onCancel(item.id)}>{s.common.cancel}</button>
                </div>
              ))}
            </div>
          )}
          {history.length > 0 && (
            <div className="schedule-list" role="list" aria-label={s.schedule.historyGroup}>
              {history.map((item) => (
                <div className="schedule-row schedule-row-fired" role="listitem" key={item.id}>
                  <div className="schedule-row-main">
                    <span className="schedule-row-text" title={item.text}>{item.text}</span>
                    <span className="schedule-row-meta">{sessionTitleOf(item.sessionId)} · {item.status === 'fired' ? s.schedule.fired : s.schedule.missed}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button ref={closeRef} className="btn-primary" type="button" onClick={onClose}>{s.common.close}</button>
        </div>
      </section>
    </div>
  );
}
