import React, { useState } from 'react';
import type { MspUserInputAnswer, MspUserInputPrompt } from '../types';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';

interface Props {
  prompt: MspUserInputPrompt;
  onAnswer: (answers: MspUserInputAnswer[]) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => Promise<{ ok: boolean; error?: string }>;
}

export default function MspUserInputCard({ prompt, onAnswer, onCancel }: Props) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [errorQuestionId, setErrorQuestionId] = useState<string | null>(null);
  const clearInputError = (questionId: string) => {
    if (errorQuestionId !== null && errorQuestionId !== questionId) return;
    setError('');
    setErrorQuestionId(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || submitted) return;
    const missing = prompt.questions.find((question) => {
      const text = freeText[question.id]?.trim() || '';
      const choices = selected[question.id] || [];
      const min = question.selection.minSelections ?? 1;
      return text.length > 500 || (!text && (question.selection.mode === 'single' ? choices.length !== 1 : choices.length < min));
    });
    if (missing) {
      setError(`“${missing.header || missing.question}”에 답을 선택하거나 직접 입력해줘.`);
      setErrorQuestionId(missing.id);
      scheduleAfterPaint(() => document.getElementById(`msp-user-input-question-${prompt.key}-${missing.id}`)?.focus());
      return;
    }
    const answers: MspUserInputAnswer[] = prompt.questions.map((question) => {
      const text = freeText[question.id]?.trim() || '';
      const choices = selected[question.id] || [];
      return text
        ? { questionId: question.id, freeText: text }
        : question.selection.mode === 'single'
          ? { questionId: question.id, selectedLabel: choices[0] }
          : { questionId: question.id, selectedLabels: choices };
    });
    setBusy(true);
    setError('');
    setErrorQuestionId(null);
    try {
      const result = await onAnswer(answers);
      if (result.ok) setSubmitted(true);
      else setError(result.error || '답변을 보내지 못했어. 다시 시도해줘.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (busy || submitted) return;
    setBusy(true);
    setError('');
    setErrorQuestionId(null);
    try {
      const result = await onCancel();
      if (result.ok) setSubmitted(true);
      else setError(result.error || '질문을 건너뛰지 못했어. 다시 시도해줘.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="msp-user-input-card" aria-labelledby={`msp-user-input-title-${prompt.key}`}>
      <div className="msp-user-input-heading">
        <div>
          <strong id={`msp-user-input-title-${prompt.key}`}>{prompt.toolName}가 확인을 요청했어</strong>
          <span>답변은 이 세션으로 전달돼.</span>
        </div>
        <span className="tag tag-msp">MSP</span>
      </div>
      {submitted ? <div className="msp-user-input-submitted" role="status">응답을 보냈어. Muse가 계속 진행 중이야…</div> : (
        <form onSubmit={(event) => void submit(event)}>
          {prompt.questions.map((question, index) => {
            const chosen = selected[question.id] || [];
            const max = question.selection.maxSelections ?? question.options.length;
            const multi = question.selection.mode === 'multiple';
            return (
              <fieldset
                id={`msp-user-input-question-${prompt.key}-${question.id}`}
                className="msp-input-question"
                key={question.id}
                tabIndex={-1}
                aria-invalid={errorQuestionId === question.id}
                aria-describedby={errorQuestionId === question.id ? `msp-user-input-error-${prompt.key}` : undefined}
              >
                <legend><span>{question.header || `질문 ${index + 1}`}</span>{question.question}</legend>
                <div className="msp-input-options">
                  {question.options.map((option) => {
                    const checked = chosen.includes(option.label);
                    const disabled = busy || (!checked && multi && chosen.length >= max);
                    return (
                      <label className={checked ? 'msp-input-option selected' : 'msp-input-option'} key={option.label}>
                        <input
                          type={multi ? 'checkbox' : 'radio'}
                          name={`msp-input-${prompt.key}-${question.id}`}
                          value={option.label}
                          checked={checked}
                          disabled={disabled || !!freeText[question.id]}
                          onChange={() => {
                            clearInputError(question.id);
                            setSelected((prev) => ({
                              ...prev,
                              [question.id]: multi
                                ? checked ? chosen.filter((label) => label !== option.label) : [...chosen, option.label]
                                : [option.label],
                            }));
                          }}
                        />
                        <span className="msp-input-option-copy">
                          <b>{option.label}</b>
                          {option.description && <small>{option.description}</small>}
                          {option.preview && <details><summary>미리보기</summary><pre>{option.preview.content}</pre></details>}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <label className="msp-input-free-text">직접 입력 (선택지를 대신할 수 있어)
                  <input
                    type="text"
                    maxLength={500}
                    value={freeText[question.id] || ''}
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value;
                      clearInputError(question.id);
                      setFreeText((prev) => ({ ...prev, [question.id]: value }));
                      if (value) setSelected((prev) => ({ ...prev, [question.id]: [] }));
                    }}
                  />
                </label>
                {multi && <small className="msp-input-limit">최소 {question.selection.minSelections ?? 1}개 · 최대 {max}개 선택</small>}
              </fieldset>
            );
          })}
          {error && <div id={`msp-user-input-error-${prompt.key}`} className="msp-input-error" role="alert">{error}</div>}
          <div className="msp-user-input-actions">
            <button className="btn" type="button" onClick={() => void skip()} disabled={busy}>이번 질문 건너뛰기</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '보내는 중…' : '답변 보내기'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
