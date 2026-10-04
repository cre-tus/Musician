import React, { useState } from 'react';
import type { MspUserInputAnswer, MspUserInputPrompt } from '../types';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { useStrings } from '../lib/lang';
import { formatStr } from '../lib/i18n.mjs';

interface Props {
  prompt: MspUserInputPrompt;
  onAnswer: (answers: MspUserInputAnswer[]) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => Promise<{ ok: boolean; error?: string }>;
}

export default function MspUserInputCard({ prompt, onAnswer, onCancel }: Props) {
  const s = useStrings();
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
      setError(formatStr(s.msp.missingAnswer, { header: missing.header || missing.question }));
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
      else setError(result.error || s.msp.sendFailed);
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
      else setError(result.error || s.msp.skipFailed);
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
          <strong id={`msp-user-input-title-${prompt.key}`}>{formatStr(s.msp.confirmRequest, { tool: prompt.toolName })}</strong>
          <span>{s.msp.answerRouted}</span>
        </div>
        <span className="tag tag-msp">MSP</span>
      </div>
      {submitted ? <div className="msp-user-input-submitted" role="status">{s.msp.submitted}</div> : (
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
                <legend><span>{question.header || formatStr(s.msp.questionN, { n: index + 1 })}</span>{question.question}</legend>
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
                          {option.preview && <details><summary>{s.msp.preview}</summary><pre>{option.preview.content}</pre></details>}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <label className="msp-input-free-text">{s.msp.freeText}
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
                {multi && <small className="msp-input-limit">{formatStr(s.msp.limitMinMax, { min: question.selection.minSelections ?? 1, max })}</small>}
              </fieldset>
            );
          })}
          {error && <div id={`msp-user-input-error-${prompt.key}`} className="msp-input-error" role="alert">{error}</div>}
          <div className="msp-user-input-actions">
            <button className="btn" type="button" onClick={() => void skip()} disabled={busy}>{s.msp.skip}</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? s.msp.sending : s.msp.send}</button>
          </div>
        </form>
      )}
    </section>
  );
}
