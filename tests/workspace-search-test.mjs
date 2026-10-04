import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { searchInFiles } = require('../electron/workspace-search.js');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'musician-workspace-search-'));

try {
  await fs.mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'generated'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.ts'), 'searchneedle in app\n');
  await fs.writeFile(path.join(root, 'src', 'app.test.ts'), 'searchneedle in test\n');
  await fs.writeFile(path.join(root, 'src', 'nested', 'util.ts'), 'searchneedle in util\n');
  await fs.writeFile(path.join(root, 'src', 'generated', 'code.ts'), 'searchneedle generated\n');
  await fs.writeFile(path.join(root, 'docs', 'guide.md'), 'guide text\n');
  await fs.writeFile(path.join(root, 'sample.txt'), [
    'Foo food seafood',
    'foo FOO',
    '고양이 고양이들',
  ].join('\n'));

  const insensitive = await searchInFiles(root, 'foo');
  assert.equal(insensitive.ok, true);
  assert.deepEqual(insensitive.matches.map((match) => match.lineNumber), [1, 2]);

  const sensitive = await searchInFiles(root, 'Foo', { caseSensitive: true });
  assert.deepEqual(sensitive.matches.map((match) => match.lineNumber), [1]);

  const wholeWord = await searchInFiles(root, 'foo', { wholeWord: true });
  assert.deepEqual(wholeWord.matches.map((match) => match.lineNumber), [1, 2]);
  assert.equal(wholeWord.matches[0].lineText, 'Foo food seafood');

  const unicodeWholeWord = await searchInFiles(root, '고양이', { wholeWord: true });
  assert.deepEqual(unicodeWholeWord.matches.map((match) => match.lineNumber), [3]);

  const combined = await searchInFiles(root, 'FOO', { caseSensitive: true, wholeWord: true });
  assert.deepEqual(combined.matches.map((match) => match.lineNumber), [2]);

  const filteredFiles = await require('../electron/workspace-search.js').searchFiles(root, 'app', {
    include: 'src/**/*.ts',
    exclude: '**/*.test.ts',
  });
  assert.deepEqual(filteredFiles.files.map((file) => file.relativePath), ['src/app.ts']);

  const filteredContent = await searchInFiles(root, 'searchneedle', {
    include: 'src/**/*.ts',
    exclude: '**/*.test.ts, **/generated/**',
  });
  assert.deepEqual(filteredContent.matches.map((match) => match.relativePath).sort(), ['src/app.ts', 'src/nested/util.ts']);

  const basenameFilter = await require('../electron/workspace-search.js').searchFiles(root, 'guide', { include: '*.md' });
  assert.deepEqual(basenameFilter.files.map((file) => file.relativePath), ['docs/guide.md']);

  // Cooperative cancellation: a superseded keystroke's scan must abort fast
  // instead of contending with the final scan (fast-typing stampede).
  const { searchFiles } = require('../electron/workspace-search.js');
  const preCancelledFiles = await searchFiles(root, 'app', { isCancelled: () => true });
  assert.deepEqual(preCancelledFiles, { ok: false, error: 'CANCELLED' });
  const preCancelledContent = await searchInFiles(root, 'searchneedle', { isCancelled: () => true });
  assert.deepEqual(preCancelledContent, { ok: false, error: 'CANCELLED' });
  let polls = 0;
  const midScan = await searchInFiles(root, 'searchneedle', { isCancelled: () => ++polls > 2 });
  assert.equal(midScan.error, 'CANCELLED', 'cancel is polled inside the walk, not just at entry');
  assert.ok(polls > 2 && polls < 40, `bounded polling, got ${polls}`);
  const uncancelled = await searchInFiles(root, 'searchneedle', { isCancelled: () => false });
  assert.equal(uncancelled.ok, true);
  assert.ok(uncancelled.matches.length >= 3, 'cancel hook must not alter normal results');

  console.log('Workspace content search option checks passed.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
