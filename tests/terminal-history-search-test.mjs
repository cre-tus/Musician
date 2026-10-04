import assert from 'node:assert/strict';
import { rankTerminalHistory } from '../src/lib/terminal-history-search.mjs';

const history = ['git status', 'git stash push', 'npm run typecheck', 'git switch main', 'Get-ChildItem src'];
assert.deepEqual(rankTerminalHistory(history, 'git st').map((item) => item.command), ['git status', 'git stash push', 'git switch main']);
assert.deepEqual(rankTerminalHistory(history, 'gsp').map((item) => item.command), ['git stash push']);
assert.deepEqual(rankTerminalHistory(history, 'npm check').map((item) => item.command), ['npm run typecheck']);
assert.deepEqual(rankTerminalHistory(history, 'npm deploy'), []);
assert.deepEqual(rankTerminalHistory(history, '').map((item) => item.index), [4, 3, 2, 1, 0]);
assert.equal(rankTerminalHistory(['ＴｙｐｅＣｈｅｃｋ'], 'typecheck').length, 1);
console.log('Terminal history fuzzy search checks passed.');
