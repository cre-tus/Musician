export interface BrowserBookmark {
  url: string;
  title: string;
  createdAt: number;
}
export const MAX_BROWSER_BOOKMARKS: number;
export function normalizeBookmarkUrl(url: unknown): string;
export function bookmarkHost(url: unknown): string;
export function normalizeBrowserBookmarks(value: unknown): BrowserBookmark[];
export function isBrowserBookmarked(list: unknown, url: unknown): boolean;
export function toggleBrowserBookmark(list: unknown, url: unknown, title?: unknown, now?: number): BrowserBookmark[];
export function removeBrowserBookmark(list: unknown, url: unknown): BrowserBookmark[];
export function readBrowserBookmarks(storage?: {
  getItem(key: string): string | null;
} | null): BrowserBookmark[];
export function writeBrowserBookmarks(
  list: unknown,
  storage?: { setItem(key: string, value: string): void } | null,
): void;
