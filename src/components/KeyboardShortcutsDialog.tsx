import React, { useEffect, useRef } from 'react';
import { XIcon } from './icons';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { shortcutGroupId, splitShortcutKeys } from '../lib/shortcut-display.mjs';
import { useStrings } from '../lib/lang';

export default function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  const s = useStrings();
  const groups = [
    {
      title: s.shortcuts.g0t,
      shortcuts: [
        ['Ctrl+P', s.shortcuts.nl00],
        ['Ctrl+N', s.shortcuts.nl01],
        ['Ctrl+Shift+P / Ctrl+K / F1', s.shortcuts.nl02],
        [s.shortcuts.scopeTabsKeys, s.shortcuts.nl03],
        ['Ctrl+Shift+E', s.shortcuts.nl04],
        ['Ctrl+Alt+S', s.shortcuts.nl05],
        ['Ctrl+Alt+R', s.shortcuts.nl06],
        ['Ctrl+L', s.shortcuts.nl07],
        [s.shortcuts.findBrowserKeys, s.shortcuts.nl08],
        ['Alt+← / Alt+→', s.shortcuts.nl09],
        ['Ctrl+R / F5', s.shortcuts.nl10],
        ['Esc', s.shortcuts.nl11],
        [s.shortcuts.explorerMoveKeys, s.shortcuts.nl12],
        ['F2 / Delete', s.shortcuts.nl13],
        ['Ctrl+B', s.shortcuts.nl14],
        ['Ctrl+Alt+E', s.shortcuts.nl15],
        ['Ctrl+,', s.shortcuts.nl16],
        [s.shortcuts.settingsFindKeys, s.shortcuts.nl17],
        ['Ctrl+Shift+`', s.shortcuts.nl18],
        [s.shortcuts.termHistoryKeys, s.shortcuts.nl19],
        [s.shortcuts.termClearKeys, s.shortcuts.nl20],
        ['Ctrl+Shift+/', s.shortcuts.nl21],
      ],
    },
    {
      title: s.shortcuts.g1t,
      shortcuts: [
        ['Ctrl+F', s.shortcuts.cl00],
        ['Ctrl+Shift+F', s.shortcuts.cl01],
        ['Ctrl+Shift+T', s.shortcuts.cl02],
        ['Ctrl+Alt+PageUp / PageDown', s.shortcuts.cl03],
        [s.shortcuts.sidebarMoveKeys, s.shortcuts.cl04],
        ['Ctrl+S', s.shortcuts.cl05],
        ['Ctrl+Shift+S', s.shortcuts.cl06],
        ['Ctrl+Shift+V (Markdown)', s.shortcuts.cl07],
        ['/new', s.shortcuts.cl08],
      ],
    },
    {
      title: s.shortcuts.g2t,
      shortcuts: [
        ['Ctrl+Tab / Ctrl+Shift+Tab', s.shortcuts.tl00],
        ['Ctrl+1 – Ctrl+9', s.shortcuts.tl01],
        ['Ctrl+PageDown / Ctrl+PageUp', s.shortcuts.tl02],
        ['Ctrl+Shift+← / → / PageUp / PageDown', s.shortcuts.tl03],
        ['Ctrl+W', s.shortcuts.tl04],
        ['Ctrl+Shift+W', s.shortcuts.tl05],
        ['Ctrl+G', s.shortcuts.tl06],
        [s.shortcuts.editorNavKeys, s.shortcuts.tl07],
        ['Ctrl+Shift+O', s.shortcuts.tl08],
        ['F12 / Shift+F12', s.shortcuts.tl09],
        ['Alt+F12', s.shortcuts.tl10],
        ['Ctrl+F12', s.shortcuts.tl11],
        ['Shift+Alt+F', s.shortcuts.tl12],
        ['Ctrl+K Ctrl+F', s.shortcuts.tl13],
        ['Ctrl+K Ctrl+0 / Ctrl+K Ctrl+J', s.shortcuts.tl14],
        ['Alt+Z', s.shortcuts.tl15],
        ['Ctrl+= / Ctrl+-', s.shortcuts.tl16],
        ['Ctrl+0', s.shortcuts.tl17],
      ],
    },
  ];
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) scheduleAfterPaint(() => target.focus({ preventScroll: true }));
    };
  }, []);

  return (
    <div className="shortcuts-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Tab') {
            event.preventDefault();
            closeButtonRef.current?.focus();
          }
        }}
      >
        <header className="shortcuts-dialog-head">
          <div>
            <h2 id="shortcuts-dialog-title">{s.shortcuts.title}</h2>
            <p>{s.shortcuts.sub}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="icon-btn" aria-label={s.shortcuts.close} onClick={onClose}><XIcon size={15} /></button>
        </header>
        <div className="shortcuts-groups">
          {groups.map((group, groupIndex) => (
            <section key={group.title} aria-labelledby={shortcutGroupId(groupIndex)}>
              <h3 id={shortcutGroupId(groupIndex)}>{group.title}</h3>
              <dl>
                {group.shortcuts.map(([keys, label]) => (
                  <div className="shortcut-row" key={keys}>
                    <dt>{label}</dt>
                    <dd>
                      {splitShortcutKeys(keys).map((part, partIndex) =>
                        part.type === 'sep'
                          ? <span key={partIndex} className="shortcut-sep" aria-hidden="true">{part.text}</span>
                          : <kbd key={partIndex}>{part.text}</kbd>,
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
