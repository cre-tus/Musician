import assert from 'node:assert/strict';
import {
  MAX_BROWSER_BOOKMARKS,
  bookmarkHost,
  isBrowserBookmarked,
  normalizeBookmarkUrl,
  normalizeBrowserBookmarks,
  readBrowserBookmarks,
  removeBrowserBookmark,
  toggleBrowserBookmark,
  writeBrowserBookmarks,
} from '../src/lib/browser-bookmarks.mjs';

function makeMemoryStorage(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };
}

// Canonicalization: trims, resolves URL variants to one href, rejects junk.
assert.equal(normalizeBookmarkUrl('https://example.com'), 'https://example.com/');
assert.equal(normalizeBookmarkUrl('  https://example.com/a?x=1  '), 'https://example.com/a?x=1');
assert.equal(normalizeBookmarkUrl('http://localhost:3000/x'), 'http://localhost:3000/x');
assert.equal(normalizeBookmarkUrl('notaurl'), '');
assert.equal(normalizeBookmarkUrl('  '), '');
assert.equal(normalizeBookmarkUrl(null), '');

// Host display for palette hints.
assert.equal(bookmarkHost('https://sub.example.com/a'), 'sub.example.com');
assert.equal(bookmarkHost('notaurl'), '');

// Normalize: drops invalid rows, dedupes by canonical URL (first wins),
// falls back to the host for empty titles, caps at MAX.
const normalized = normalizeBrowserBookmarks([
  { url: 'https://example.com', title: 'Ex', createdAt: 3 },
  { url: 'notaurl', title: 'junk', createdAt: 4 },
  null,
  { url: 'https://example.com/', title: 'Dupe', createdAt: 5 },
  { url: 'https://other.org/x', title: '  ', createdAt: 6 },
]);
assert.deepEqual(normalized.map((b) => b.url), ['https://example.com/', 'https://other.org/x']);
assert.equal(normalized[0].title, 'Ex');
assert.equal(normalized[1].title, 'other.org');
const over = Array.from({ length: MAX_BROWSER_BOOKMARKS + 5 }, (_, i) => ({
  url: `https://site-${i}.example/`, title: `t${i}`, createdAt: i,
}));
assert.equal(normalizeBrowserBookmarks(over).length, MAX_BROWSER_BOOKMARKS);
assert.deepEqual(normalizeBrowserBookmarks('nope'), []);

// Toggle adds newest-first with host fallback, removes by any URL variant,
// and leaves the list alone for invalid URLs.
const added = toggleBrowserBookmark([], 'https://example.com', '  ', 100);
assert.equal(added.length, 1);
assert.equal(added[0].url, 'https://example.com/');
assert.equal(added[0].title, 'example.com');
assert.equal(added[0].createdAt, 100);
const added2 = toggleBrowserBookmark(added, 'https://second.org/', 'Second', 200);
assert.deepEqual(added2.map((b) => b.url), ['https://second.org/', 'https://example.com/']);
assert.deepEqual(toggleBrowserBookmark(added2, 'https://example.com', '', 300), [added2[0]]);
assert.deepEqual(toggleBrowserBookmark(added, 'notaurl', 'x', 400), added);

// Membership and removal match canonically.
assert.equal(isBrowserBookmarked(added2, 'https://second.org'), true);
assert.equal(isBrowserBookmarked(added2, 'https://missing.org/'), false);
assert.equal(isBrowserBookmarked(added2, 'notaurl'), false);
assert.deepEqual(removeBrowserBookmark(added2, 'https://second.org'), [added2[1]]);
assert.deepEqual(removeBrowserBookmark(added2, 'https://missing.org/'), added2);

// Storage round-trips and never throws.
const storage = makeMemoryStorage();
assert.deepEqual(readBrowserBookmarks(storage), []);
writeBrowserBookmarks(added2, storage);
assert.deepEqual(readBrowserBookmarks(storage).map((b) => b.url), ['https://second.org/', 'https://example.com/']);
assert.deepEqual(readBrowserBookmarks(makeMemoryStorage({ 'mudex:browser-bookmarks:v1': '{broken' })), []);
writeBrowserBookmarks(null, storage);
assert.deepEqual(readBrowserBookmarks(), []);

console.log('Browser bookmarks passed.');
