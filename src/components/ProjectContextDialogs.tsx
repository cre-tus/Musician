import React, { useEffect, useState } from 'react';
import { api, hasBridge } from '../lib/mudex';
import { agentsMdPath, validateAgentsMd } from '../lib/agents-md.mjs';
import { addProjectMemory, deleteProjectMemory, listProjectMemories, loadProjectMemories, saveProjectMemories } from '../lib/project-memory.mjs';
import type { ProjectMemory } from '../lib/project-memory.mjs';
import { useStrings } from '../lib/lang';

interface DialogProps {
  folder: string;
  onClose: () => void;
  onNotice?: (message: string, kind?: string) => void;
}

// Project memory manager: the agent's per-project notes. Multi-line input
// (Ctrl+Enter adds), live count in the title, per-note delete.
export function MemoryDialog(props: DialogProps) {
  const { folder, onClose } = props;
  const strings = useStrings();
  const ft = strings.files;
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setMemories(listProjectMemories(loadProjectMemories(), folder));
    setDraft('');
  }, [folder]);

  const refreshMemories = () => {
    setMemories(listProjectMemories(loadProjectMemories(), folder));
    window.dispatchEvent(new CustomEvent('musician:memory-change'));
  };

  const submitMemory = () => {
    const text = draft.trim();
    if (!folder || !text) return;
    saveProjectMemories(undefined, addProjectMemory(loadProjectMemories(), folder, text));
    setDraft('');
    refreshMemories();
  };

  const removeMemory = (id: string) => {
    saveProjectMemories(undefined, deleteProjectMemory(loadProjectMemories(), id));
    refreshMemories();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal memory-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-title" tabIndex={-1} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      }}>
        <div className="modal-header"><h3 id="memory-title">{ft.memoryTitle} ({memories.length})</h3></div>
        <div className="modal-body">
          {memories.length === 0 ? (
            <div className="empty-note">{ft.memoryEmpty}</div>
          ) : (
            <ul className="gh-comments-list">
              {memories.map((m) => (
                <li key={m.id} className="gh-comment-row">
                  <div className="gh-comment-body">{m.text}</div>
                  <div className="gh-comment-actions">
                    <button className="mini-btn" type="button" onClick={() => removeMemory(m.id)}>
                      {ft.memoryDelete}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <label className="field">{ft.memoryAdd}
            <textarea
              value={draft}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && draft.trim()) {
                  event.preventDefault();
                  submitMemory();
                }
              }}
              placeholder={ft.memoryPh}
              aria-label={ft.memoryPh}
              spellCheck={false}
              autoFocus
            />
          </label>
          <div className="empty-note">{ft.memoryHint} · {ft.memorySubmitHint}</div>
        </div>
        <div className="modal-footer">
          <button className="btn" type="button" onClick={onClose}>{strings.common.cancel}</button>
          <button className="btn" type="button" disabled={!draft.trim()} onClick={submitMemory}>{ft.memoryAdd}</button>
        </div>
      </section>
    </div>
  );
}

// Project instructions editor: the root AGENTS.md, guarded writes, honest
// conflicts when edited outside.
export function AgentsDialog(props: DialogProps) {
  const { folder, onClose, onNotice } = props;
  const strings = useStrings();
  const ft = strings.files;
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  const [exists, setExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!folder || !hasBridge()) return;
    setError('');
    setBusy(true);
    let cancelled = false;
    (async () => {
      try {
        const target = agentsMdPath(folder);
        const r = await api().readFile(target);
        if (cancelled) return;
        if (r.ok) {
          setExists(true);
          setOriginal(r.content || '');
          setContent(r.content || '');
        } else {
          setExists(false);
          setOriginal(null);
          setContent('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [folder]);

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
      if (onNotice) onNotice(ft.agentsSaved, 'git');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal agents-dialog" role="dialog" aria-modal="true" aria-labelledby="agents-title" tabIndex={-1} onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      }}>
        <div className="modal-header"><h3 id="agents-title">{ft.agentsTitle}</h3></div>
        <div className="modal-body">
          <p className="modal-note">{agentsMdPath(folder || '')}</p>
          {!exists && <p className="modal-note">{ft.agentsMissing}</p>}
          <label className="field">{ft.agentsFile}
            <textarea value={content} disabled={busy} rows={14} onChange={(event) => { setContent(event.target.value); setError(''); }} placeholder={ft.agentsPh} aria-label={ft.agentsFile} spellCheck={false} />
          </label>
          {error && <div className="tree-error explorer-entry-error" role="alert">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>{strings.common.cancel}</button>
          <button className="btn" type="button" disabled={busy} onClick={() => void saveAgents()}>{busy ? ft.agentsSaving : ft.agentsSave}</button>
        </div>
      </section>
    </div>
  );
}
