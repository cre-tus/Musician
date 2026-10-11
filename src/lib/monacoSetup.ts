// Monaco local bundle setup (no CDN at runtime). Import once from any
// component that renders a monaco editor.
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

// Bundle monaco locally (no CDN at runtime) with vite workers.
(self as unknown as { MonacoEnvironment?: object }).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};
(loader as unknown as { config: (o: object) => void }).config({ monaco });

// App editor themes: stock bases with run-diff colors pinned to
// light-green (added) vs pink (removed). hc-black stays untouched.
monaco.editor.defineTheme('musician-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'diffEditor.insertedLineBackground': '#bef26422',
    'diffEditor.removedLineBackground': '#f9a8d422',
    'diffEditor.insertedTextBackground': '#bef26466',
    'diffEditor.removedTextBackground': '#f9a8d466',
    'diffEditorGutter.insertedLineBackground': '#bef264',
    'diffEditorGutter.removedLineBackground': '#f9a8d4',
    'diffEditorOverview.insertedForeground': '#bef264cc',
    'diffEditorOverview.removedForeground': '#f9a8d4cc',
  },
});
monaco.editor.defineTheme('musician-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'diffEditor.insertedLineBackground': '#e6ffec',
    'diffEditor.removedLineBackground': '#ffe4ec',
    'diffEditor.insertedTextBackground': '#abf2bc',
    'diffEditor.removedTextBackground': '#ffb3c6',
    'diffEditorGutter.insertedLineBackground': '#2da44e',
    'diffEditorGutter.removedLineBackground': '#e85d8a',
    'diffEditorOverview.insertedForeground': '#2da44ecc',
    'diffEditorOverview.removedForeground': '#e85d8acc',
  },
});

export {};
