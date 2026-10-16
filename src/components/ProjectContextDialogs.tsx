import React, { useEffect, useRef, useState } from 'react';
import { api, hasBridge } from '../lib/mudex';
import { agentsMdPath, validateAgentsMd } from '../lib/agents-md.mjs';
import {
  MAX_MEMORY_TEXT,
  WIRE_CAP,
  addProjectMemory,
  deleteProjectMemory,
  listProjectMemories,
  loadProjectMemories,
  saveProjectMemories,
  setProjectMemoryEnabled,
  updateProjectMemory,
} from '../lib/project-memory.mjs';
import type { ProjectMemory } from '../lib/project-memory.mjs';
import { clearDraft, draftKey, readDraft, writeDraft } from '../lib/modal-drafts.mjs';
import { formatStr } from '../lib/i18n.mjs';
import { useStrings } from '../lib/lang';

interface DialogProps {
  folder: string;
  onClose: () => void;
  onNotice?: (message: string, kind?: string) => void;
}

// Every input dialog shares one keyboard contract: the first field takes
// focus on open, Tab cycles inside the dialog, Escape leaves, and focus
// returns to the opener on close.
function trapTabKey(event: React.KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== 'Tab' || !root) return;
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function useFocusReturn() {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
}

// Project memory manager: the agent's per-project notes. Multi-line input
// (Ctrl+Enter adds), live count in the title, per-note edit/disable/delete.
// Unsent input survives an accidental close or restart via a folder-scoped
// draft; backdrop clicks never discard a dirty draft.
export function MemoryDialog(props: DialogProps) {
  const { folder, onClose } = props;
  const strings = useStrings();
  const ft = strings.files;
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const storageKey = draftKey('memory', folder);

  useFocusReturn();

  useEffect(() => {
    setMemories(listProjectMemories(loadProjectMemories(), folder));
    const restored = readDraft(undefined, draftKey('memory', folder));
    setDraft(restored || '');
    setDraftRestored(!!restored);
    setEditingId(null);
    setEditText('');
    setSavedFlash(false);
  }, [folder]);

  const refreshMemories = () => {
    setMemories(listProjectMemories(loadProjectMemories(), folder));
    window.dispatchEvent(new CustomEvent('musician:memory-change'));
  };

  const changeDraft = (value: string) => {
    setDraft(value);
    writeDraft(undefined, storageKey, value);
    if (value.length === 0) setDraftRestored(false);
  };

  const discardDraft = () => {
    clearDraft(undefined, storageKey);
    setDraft('');
    setDraftRestored(false);
  };

  const dirty = draft.trim().length > 0 || editingId !== null;

  const submitMemory = () => {
    const text = draft.trim();
    if (!folder || !text) return;
    saveProjectMemories(undefined, addProjectMemory(loadProjectMemories(), folder, text));
    clearDraft(undefined, storageKey);
    setDraft('');
    setDraftRestored(false);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2500);
    refreshMemories();
  };

  const removeMemory = (id: string) => {
    saveProjectMemories(undefined, deleteProjectMemory(loadProjectMemories(), id));
    if (editingId === id) {
      setEditingId(null);
      setEditText('');
    }
    refreshMemories();
  };

  const toggleMemory = (id: string, off: boolean) => {
    saveProjectMemories(undefined, setProjectMemoryEnabled(loadProjectMemories(), id, off));
    refreshMemories();
  };

  const saveEdit = () => {
    if (!editingId || !editText.trim()) return;
    saveProjectMemories(undefined, updateProjectMemory(loadProjectMemories(), editingId, editText));
    setEditingId(null);
    setEditText('');
    refreshMemories();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !dirty) onClose(); }}>
      <section
        ref={dialogRef}
        className="modal memory-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (editingId) {
              setEditingId(null);
              setEditText('');
            } else {
              onClose();
            }
          } else {
            trapTabKey(event, dialogRef.current);
          }
        }}
      >
        <div className="modal-header">
          <div className="modal-title-block">
            <h3 id="memory-title">{ft.memoryTitle} ({memories.length})</h3>
            <p className="modal-subtitle"><code>{folder}</code> · {ft.memoryEveryTurn}</p>
          </div>
        </div>
        <div className="modal-body">
          {draftRestored && draft && (
            <p className="draft-note">
              {ft.memoryDraftRestored}
              <button className="mini-btn" type="button" onClick={discardDraft}>{ft.memoryDiscardDraft}</button>
            </p>
          )}
          {memories.length === 0 ? (
            <div className="empty-note">{ft.memoryEmpty}</div>
          ) : (
            <ul className="memory-list">
              {memories.map((m) => {
                const off = m.disabled === true;
                const editing = editingId === m.id;
                return (
                  <li key={m.id} className={off ? 'memory-row is-off' : 'memory-row'}>
                    {editing ? (
                      <textarea
                        className="memory-textarea"
                        value={editText}
                        rows={3}
                        maxLength={MAX_MEMORY_TEXT}
                        onChange={(event) => setEditText(event.target.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && editText.trim()) {
                            event.preventDefault();
                            saveEdit();
                          }
                        }}
                        aria-label={ft.memoryAddLabel}
                        spellCheck={false}
                        autoFocus
                      />
                    ) : (
                      <div className="memory-text">{m.text}</div>
                    )}
                    <div className="memory-actions">
                      {editing ? (
                        <>
                          <button className="mini-btn on" type="button" disabled={!editText.trim()} onClick={saveEdit}>
                            {strings.common.save}
                          </button>
                          <button className="mini-btn" type="button" onClick={() => { setEditingId(null); setEditText(''); }}>
                            {strings.common.cancel}
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="mini-btn" type="button" onClick={() => { setEditingId(m.id); setEditText(m.text); }}>
                            {ft.memoryEdit}
                          </button>
                          <button className="mini-btn" type="button" onClick={() => toggleMemory(m.id, off)}>
                            {off ? ft.memoryEnable : ft.memoryDisable}
                          </button>
                          <button className="mini-btn" type="button" onClick={() => removeMemory(m.id)}>
                            {ft.memoryDelete}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <label className="field">
            <span className="field-label-row">
              {ft.memoryAddLabel}
              <span className="field-count">{formatStr(ft.memoryCount, { len: draft.length, max: MAX_MEMORY_TEXT, cap: WIRE_CAP })}</span>
            </span>
            <textarea
              value={draft}
              rows={5}
              maxLength={MAX_MEMORY_TEXT}
              onChange={(event) => changeDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && draft.trim()) {
                  event.preventDefault();
                  submitMemory();
                }
              }}
              placeholder={ft.memoryPh}
              aria-label={ft.memoryAddLabel}
              spellCheck={false}
              autoFocus
            />
          </label>
          <div className="empty-note">{ft.memoryHint} · {ft.memorySubmitHint}</div>
        </div>
        <div className="modal-footer">
          {savedFlash && <span className="save-flash" role="status">{ft.memorySaved}</span>}
          <button className="btn" type="button" onClick={onClose}>{strings.common.close}</button>
          <button className="btn btn-primary" type="button" disabled={!draft.trim()} onClick={submitMemory}>{ft.memoryAdd}</button>
        </div>
      </section>
    </div>
  );
}

// Project instructions editor: the root AGENTS.md, guarded writes, honest
// conflicts when edited outside. Unsaved edits persist as a folder-scoped
// draft; a dirty backdrop click never discards them.
export function AgentsDialog(props: DialogProps) {
  const { folder, onClose, onNotice } = props;
  const strings = useStrings();
  const ft = strings.files;
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const storageKey = draftKey('agents', folder);

  useFocusReturn();

  useEffect(() => {
    if (!folder || !hasBridge()) return;
    setError('');
    setBusy(true);
    setDraftRestored(false);
    let cancelled = false;
    (async () => {
      try {
        const target = agentsMdPath(folder);
        const r = await api().readFile(target);
        if (cancelled) return;
        const fileContent = r.ok ? (r.content || '') : '';
        if (r.ok) {
          setExists(true);
          setOriginal(fileContent);
        } else {
          setExists(false);
          setOriginal(null);
        }
        const draft = readDraft(undefined, draftKey('agents', folder));
        if (draft !== null && draft !== fileContent) {
          setContent(draft);
          setDraftRestored(true);
        } else {
          setContent(fileContent);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [folder]);

  const changeContent = (value: string) => {
    setContent(value);
    setError('');
    if (value === (original || '')) {
      clearDraft(undefined, storageKey);
      setDraftRestored(false);
    } else {
      writeDraft(undefined, storageKey, value);
    }
  };

  const discardDraft = () => {
    clearDraft(undefined, storageKey);
    setContent(original || '');
    setDraftRestored(false);
  };

  const dirty = original === null ? content.length > 0 : content !== original;

  const saveAgents = async () => {
    if (!folder || !hasBridge() || busy) return;
    const check = validateAgentsMd(content);
    if (!check.ok) {
      setError(check.error === 'TOO_LARGE' ? ft.agentsTooLarge : ft.agentsFailed);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api().writeFile(agentsMdPath(folder), content, exists ? original || '' : undefined);
      if (!r.ok) {
        if (r.error === 'FILE_CHANGED' || r.error === 'FILE_CHANGED_DELETED') {
          setError(ft.agentsConflict);
          const fresh = await api().readFile(agentsMdPath(folder));
          if (fresh.ok) {
            setOriginal(fresh.content || '');
          }
        } else {
          setError(r.error || ft.agentsFailed);
        }
        return;
      }
      setExists(true);
      setOriginal(content);
      clearDraft(undefined, storageKey);
      setDraftRestored(false);
      if (onNotice) onNotice(ft.agentsSaved, 'git');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changed = original !== null && content !== original;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !dirty) onClose(); }}>
      <section
        ref={dialogRef}
        className="modal agents-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agents-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.preventDefault();
            onClose();
          } else {
            trapTabKey(event, dialogRef.current);
          }
        }}
      >
        <div className="modal-header">
          <div className="modal-title-block">
            <h3 id="agents-title">{ft.agentsTitle}</h3>
            <p className="modal-subtitle">{ft.agentsScope} · <code>{agentsMdPath(folder || '')}</code></p>
          </div>
          <p className="modal-count">{formatStr(ft.agentsChars, { len: content.length })}{changed && ` · ${formatStr(ft.agentsChanged, { n: Math.abs(content.length - (original || '').length) })}`}</p>
        </div>
        <div className="modal-body">
          {draftRestored && (
            <p className="draft-note">
              {ft.agentsDraftRestored}
              <button className="mini-btn" type="button" onClick={discardDraft}>{ft.agentsDiscardDraft}</button>
            </p>
          )}
          {!exists && <p className="modal-note">{ft.agentsMissing}</p>}
          <label className="field">{ft.agentsFile}
            <textarea
              value={content}
              disabled={busy}
              rows={16}
              onChange={(event) => changeContent(event.target.value)}
              placeholder={ft.agentsPh}
              aria-label={ft.agentsFile}
              spellCheck={false}
              autoFocus
            />
          </label>
          {changed && original !== null && (
            <details className="diff-box">
              <summary>{ft.agentsDiff}</summary>
              <div className="diff-cols">
                <div className="diff-col">
                  <h4>{ft.agentsBefore}</h4>
                  <pre>{original}</pre>
                </div>
                <div className="diff-col">
                  <h4>{ft.agentsAfter}</h4>
                  <pre>{content}</pre>
                </div>
              </div>
            </details>
          )}
          {error && <div className="tree-error explorer-entry-error" role="alert">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>{strings.common.cancel}</button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void saveAgents()}>{busy ? ft.agentsSaving : ft.agentsSave}</button>
        </div>
      </section>
    </div>
  );
}
