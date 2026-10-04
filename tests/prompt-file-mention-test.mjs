import assert from 'node:assert/strict';
import { findPromptFileMention, insertPromptFileMention } from '../src/lib/prompt-file-mention.mjs';

assert.deepEqual(findPromptFileMention('Please inspect @src/App', 23), { start: 15, end: 23, query: 'src/App' });
assert.deepEqual(findPromptFileMention('@', 1), { start: 0, end: 1, query: '' });
assert.deepEqual(findPromptFileMention('See (@src/App', 13), { start: 5, end: 13, query: 'src/App' }, 'punctuation can introduce a file mention');
assert.deepEqual(findPromptFileMention('@"src/My Folder', 15), { start: 0, end: 15, query: 'src/My Folder' }, 'quoted paths may contain spaces');
assert.equal(findPromptFileMention('@"src/My Folder"', 16), null, 'a closed quoted mention should stop autocomplete');
assert.equal(findPromptFileMention('name@example.com', 16), null, 'email addresses should not open file suggestions');
assert.equal(findPromptFileMention('@src/App rest', 9), null, 'suggestions should stop once the caret leaves the active token');
assert.deepEqual(insertPromptFileMention('Check @App and keep this', { start: 6, end: 10 }, 'src/App.tsx'), {
  value: 'Check `src/App.tsx` and keep this',
  cursor: 19,
});
assert.deepEqual(insertPromptFileMention('@foo', { start: 0, end: 4 }, 'docs/a`b.md'), {
  value: '`docs/a\\`b.md`',
  cursor: 14,
});
console.log('Prompt file mention checks passed.');
