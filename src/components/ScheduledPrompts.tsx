import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduledPrompt, ScheduledRepeat } from '../lib/scheduled-prompts.mjs';
import { MAX_SCHEDULED_PROMPTS, formatRepeat, formatScheduledFireTime } from '../lib/scheduled-prompts.mjs';

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

const REPEAT_OPTIONS: { value: ScheduledRepeat; label: string }[] = [
  { value: 'once', label: '1회만' },
  { value: 'daily', label: '매일' },
  { value: 'weekly', label: '매주' },
  { value: 'monthly', label: '매월' },
];

export function SchedulePromptDialog({ draft, sessionTitle, mode, initialFireAt, initialRepeat, onSchedule, onClose }: SchedulePromptDialogProps) {
  const edit = mode === 'edit';
  const titleId = edit ? 'schedule-edit-title' : 'schedule-dialog-title';
  const presets = useMemo(() => {
    const now = Date.now();
    return [
      { label: '10분 후', fireAt: now + 10 * 60000 },
      { label: '30분 후', fireAt: now + 30 * 60000 },
      { label: '1시간 후', fireAt: now + 3600000 },
      { label: '3시간 후', fireAt: now + 3 * 3600000 },
      { label: '내일 아침 9시', fireAt: nextMorningNine(now) },
    ];
  }, []);
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
        <div className="modal-header"><h3 id={titleId}>{edit ? '예약 변경' : '프롬프트 예약'}</h3></div>
        <div className="modal-body">
          <p className="modal-note">{edit ? '바꾼 시간' : '시간'}이 되면 <code>{sessionTitle}</code> 스레드에서 자동 실행돼. 실행 중이면 끝난 뒤 순서대로 실행돼.</p>
          {edit ? (
            <textarea
              className="schedule-edit-text"
              aria-label="예약 프롬프트 내용"
              rows={3}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          ) : (
            <p className="schedule-text">{draft}</p>
          )}
          <div className="schedule-presets" role="group" aria-label="예약 시간 선택">
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
              직접 입력
            </button>
          </div>
          <div className="schedule-presets" role="group" aria-label="반복 선택">
            {REPEAT_OPTIONS.map((option) => (
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
            날짜와 시간
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
          {!valid && <p className="modal-note test-err">{!textValid ? '내용을 비워둘 수 없어 (최대 8000자).' : '지금보다 이후 시간을 골라줘.'}</p>}
        </div>
        <div className="modal-footer">
          <button className="btn" type="button" onClick={onClose}>취소</button>
          <button ref={confirmRef} className="btn-primary" type="button" disabled={!valid} onClick={() => onSchedule(picked, repeat, edit ? text : undefined)}>
            {valid ? `${formatScheduledFireTime(picked)}에 ${edit ? '변경' : '예약'}${repeat === 'once' ? '' : ` (${formatRepeat(repeat)})`}` : (edit ? '변경하기' : '예약하기')}
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
        <div className="modal-header"><h3 id="schedule-list-title">예약된 프롬프트</h3></div>
        <div className="modal-body">
          {items.length === 0 && <p className="modal-note">예약이 없어. 입력창에 쓰고 시계 버튼을 눌러 예약해줘 (최대 {MAX_SCHEDULED_PROMPTS}개).</p>}
          {pending.length > 0 && (
            <div className="schedule-list" role="list" aria-label="대기 중인 예약">
              {pending.map((item) => (
                <div className="schedule-row" role="listitem" key={item.id}>
                  <div className="schedule-row-main">
                    <span className="schedule-row-text" title={item.text}>{item.text}</span>
                    <span className="schedule-row-meta">{sessionTitleOf(item.sessionId)} · {formatScheduledFireTime(item.fireAt, now)}{item.repeat !== 'once' ? ` · ${formatRepeat(item.repeat)} 반복` : ''}</span>
                  </div>
                  <button className="btn" type="button" onClick={() => onFireNow(item.id)}>지금 실행</button>
                  <button className="btn" type="button" onClick={() => onEdit(item.id)}>편집</button>
                  <button className="btn" type="button" onClick={() => onCancel(item.id)}>취소</button>
                </div>
              ))}
            </div>
          )}
          {history.length > 0 && (
            <div className="schedule-list" role="list" aria-label="지난 예약">
              {history.map((item) => (
                <div className="schedule-row schedule-row-fired" role="listitem" key={item.id}>
                  <div className="schedule-row-main">
                    <span className="schedule-row-text" title={item.text}>{item.text}</span>
                    <span className="schedule-row-meta">{sessionTitleOf(item.sessionId)} · {item.status === 'fired' ? '실행됨' : '실행 못함'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button ref={closeRef} className="btn-primary" type="button" onClick={onClose}>닫기</button>
        </div>
      </section>
    </div>
  );
}
