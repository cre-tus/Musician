import assert from 'node:assert/strict';
import { fuzzyMatchIndexes, scoreSidebarSession } from '../src/lib/sidebar-session-search.mjs';

const session = (title, cwd = '', messages = []) => ({ title, cwd, messages });
assert.ok(scoreSidebarSession(session('Workspace session switch'), 'wss') > 0, 'title initials should match fuzzy queries');
assert.ok(scoreSidebarSession(session('Build tools'), 'C:/work/mudex'), 'workspace paths should be searchable');
assert.ok(scoreSidebarSession(session('Unrelated', '', [{ text: 'remember to update the editor tabs' }]), 'editor tabs') > 0, 'message text should support multiple search terms');
assert.equal(scoreSidebarSession(session('Unrelated', '', [{ text: 'editor tabs' }]), 'editor missing'), -1, 'every query term must match');
assert.ok(scoreSidebarSession(session('Ｔａｂ Ｓｗｉｔｃｈ'), 'tab switch') > 0, 'compatibility forms should normalize before matching');
assert.deepEqual(fuzzyMatchIndexes('Workspace Switch', 'wss'), [0, 4, 10], 'fuzzy title matches should expose the matching character positions');
assert.deepEqual(fuzzyMatchIndexes('Ｔａｂ Switch', 'tab'), [0, 1, 2], 'highlight positions should map normalized compatibility characters back to the visible title');
console.log('Sidebar session fuzzy search checks passed.');
