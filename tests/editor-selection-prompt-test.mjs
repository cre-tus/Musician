import assert from 'node:assert/strict';
import { formatEditorSelectionPrompt } from '../src/lib/editor-selection-prompt.mjs';

const prompt = formatEditorSelectionPrompt({
  relativePath: 'src/App.tsx',
  startLine: 12,
  endLine: 15,
  language: 'typescript',
  text: 'const title = "안녕";\nreturn title;',
});
assert.match(prompt, /경로: `src\/App\.tsx` \(줄 12-15\)/);
assert.match(prompt, /```typescript\nconst title/);
assert.equal(formatEditorSelectionPrompt({ relativePath: 'x.ts', startLine: 4, endLine: 4, language: 'typescript', text: 'x' }), '선택한 코드 영역을 참고해줘. 경로: `x.ts` (줄 4)\n\n```typescript\nx\n```');
assert.match(formatEditorSelectionPrompt({ relativePath: 'x.md', startLine: 1, endLine: 1, language: 'markdown', text: '```\ncode\n```' }), /````markdown/);
assert.equal(formatEditorSelectionPrompt({ relativePath: 'x.ts', startLine: 1, endLine: 1, language: 'typescript', text: '  \n' }), '');

console.log('Editor selection prompt formatting checks passed.');
