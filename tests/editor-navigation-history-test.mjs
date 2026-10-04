import assert from 'node:assert/strict';
import { editorNavigationStorageKey, pushEditorLocation, readEditorNavigationHistory, remapEditorNavigationPaths, removeEditorNavigationPaths, stepEditorLocation, toggleEditorLocationBookmark, writeEditorNavigationHistory } from '../src/lib/editor-navigation-history.mjs';

const a = { path: 'src/a.ts', line: 1, column: 1 };
const b = { path: 'src/b.ts', line: 8, column: 3 };
let state = pushEditorLocation([], -1, a);
state = pushEditorLocation(state.entries, state.index, a);
assert.deepEqual(state, { entries: [a], index: 0 });
state = pushEditorLocation(state.entries, state.index, b);
assert.deepEqual(state, { entries: [a, b], index: 1 });
assert.deepEqual(stepEditorLocation(state.entries, state.index, -1), { index: 0, location: a });
assert.deepEqual(pushEditorLocation(state.entries, 0, a), { entries: [a, b], index: 0 });
state = { entries: state.entries, index: 0 };
state = pushEditorLocation(state.entries, state.index, { path: 'src/c.ts', line: 2, column: 1 });
assert.deepEqual(state, { entries: [a, { path: 'src/c.ts', line: 2, column: 1 }], index: 1 });
assert.equal(stepEditorLocation(state.entries, state.index, 1).location, null);
const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
const projectHistory = { entries: [a, b], index: 0, bookmarks: [b] };
assert.equal(writeEditorNavigationHistory('C:\\Project\\', projectHistory, storage), true);
assert.deepEqual(readEditorNavigationHistory('c:/project', storage), projectHistory);
assert.equal(editorNavigationStorageKey('C:\\Project'), editorNavigationStorageKey('c:/project/'));
values.set(editorNavigationStorageKey('broken'), '{');
assert.deepEqual(readEditorNavigationHistory('broken', storage), { entries: [], index: -1, bookmarks: [] });
let bookmarks = toggleEditorLocationBookmark([], a);
assert.deepEqual(bookmarks, { bookmarks: [a], bookmarked: true });
bookmarks = toggleEditorLocationBookmark(bookmarks.bookmarks, a);
assert.deepEqual(bookmarks, { bookmarks: [], bookmarked: false });
bookmarks = toggleEditorLocationBookmark([a], { path: 'SRC\\A.TS', line: 1, column: 1 });
assert.deepEqual(bookmarks, { bookmarks: [], bookmarked: false });
bookmarks = toggleEditorLocationBookmark([], a, 1);
bookmarks = toggleEditorLocationBookmark(bookmarks.bookmarks, b, 1);
assert.deepEqual(bookmarks.bookmarks, [b]);
state = pushEditorLocation([], -1, a, 2);
state = pushEditorLocation(state.entries, state.index, b, 2);
state = pushEditorLocation(state.entries, state.index, { path: 'src/c.ts', line: 3, column: 1 }, 2);
assert.deepEqual(state.entries, [b, { path: 'src/c.ts', line: 3, column: 1 }]);
const renamedHistory = remapEditorNavigationPaths(
  { entries: [{ path: 'C:\\P\\old\\a.ts', line: 1, column: 1 }, { path: 'C:\\P\\other.ts', line: 2, column: 1 }], index: 1, bookmarks: [{ path: 'C:\\P\\old\\a.ts', line: 1, column: 1 }] },
  'C:\\P\\old',
  'C:\\P\\new',
);
assert.deepEqual(renamedHistory.entries.map((entry) => entry.path), ['C:\\P\\new\\a.ts', 'C:\\P\\other.ts']);
assert.equal(renamedHistory.index, 1);
assert.deepEqual(renamedHistory.bookmarks.map((entry) => entry.path), ['C:\\P\\new\\a.ts']);
const fileRenamed = remapEditorNavigationPaths(
  { entries: [{ path: 'c:/p/a.ts', line: 4, column: 2 }], index: 0, bookmarks: [] },
  'C:\\P\\A.TS',
  'C:\\P\\b.ts',
);
assert.deepEqual(fileRenamed.entries, [{ path: 'C:\\P\\b.ts', line: 4, column: 2 }]);
const prunedHistory = removeEditorNavigationPaths(renamedHistory, 'C:\\P\\new');
assert.deepEqual(prunedHistory, { entries: [{ path: 'C:\\P\\other.ts', line: 2, column: 1 }], index: 0, bookmarks: [] });
const emptiedHistory = removeEditorNavigationPaths(prunedHistory, 'C:\\P\\other.ts');
assert.deepEqual(emptiedHistory, { entries: [], index: -1, bookmarks: [] });
console.log('Editor navigation history checks passed.');
