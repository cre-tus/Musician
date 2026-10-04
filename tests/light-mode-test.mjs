import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Light-mode contract: the app ships a real light theme, not dark-only.
// - styles.css carries a [data-theme='light'] variable block (light surfaces,
//   dark text, light borders/shadows) plus light overrides for every
//   hardcoded dark surface.
// - App + electron main pass settings.theme through (dark stays the default,
//   nothing forces 'dark' over a stored 'light').
// - Settings exposes a theme picker; the suite runs this test.
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('src/styles.css');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const app = read('src/App.tsx');
const main = read('electron/main.js');
const settingsView = read('src/components/SettingsView.tsx');
const pkg = JSON.parse(read('package.json'));

function blockOf(haystack, start) {
  const open = haystack.indexOf('{', start);
  assert.ok(open >= 0, 'block opens');
  let depth = 0;
  for (let i = open; i < haystack.length; i++) {
    if (haystack[i] === '{') depth++;
    else if (haystack[i] === '}') {
      depth--;
      if (depth === 0) return haystack.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced braces in theme block');
}

// 1. Light variable block with every theme-dependent token.
const lightAt = bare.indexOf("[data-theme='light']");
assert.ok(lightAt >= 0, '[data-theme=light] block exists');
const lightVars = blockOf(bare, lightAt);
for (const token of [
  'color-scheme: light',
  '--bg:', '--bg-sidebar:', '--bg-raised:', '--bg-sunken:',
  '--fg:', '--fg-muted:', '--fg-subtle:',
  '--accent:', '--accent-text:', '--accent-soft:',
  '--danger:', '--ok:',
  '--border:', '--border-soft:', '--shadow:',
]) {
  assert.ok(lightVars.includes(token), `light block sets ${token}`);
}
console.log('ok - light variable block complete');

// 2. Light overrides for every hardcoded dark surface.
for (const sel of [
  '.sidebar', '.thread-row.active', '.term-shell', '.files-tab',
  '.quick-open', '.explorer-search-history',
]) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\[data-theme='light'\\]\\s+${esc}\\s*\\{`);
  assert.ok(re.test(bare), `light override for ${sel}`);
}
for (const rule of [
  "[data-theme='light'] .panel,",
  "[data-theme='light'] .profile-card,",
  "[data-theme='light'] .strip-menu {",
  "[data-theme='light'] .btn:hover:not(:disabled),",
  "[data-theme='light'] .mini-btn:hover {",
  "[data-theme='light'] .mini-profile:hover {",
]) {
  assert.ok(bare.includes(rule), `light override rule: ${rule}`);
}
console.log('ok - hardcoded dark surfaces covered');

// 3. Renderer passes settings.theme through; dark is only the default.
const appDefaults = (app.match(/theme: 'dark'/g) || []).length;
assert.equal(appDefaults, 1, `exactly one dark default in App, saw ${appDefaults}`);
assert.ok(/dataset\.theme\s*=\s*settings\.theme/.test(app), 'theme effect applies settings.theme');
assert.ok(/setDark\(settings\.theme !== 'light'\)/.test(app), 'dark flag derives from settings.theme');
console.log('ok - renderer theme wiring');

// 4. Main keeps dark as the default but honors a stored light theme.
const defaults = (main.match(/theme: 'dark'/g) || []).length;
assert.equal(defaults, 1, `exactly one dark default, saw ${defaults}`);
assert.ok(!main.includes("theme = 'dark'"), 'main never overwrites theme with dark');
assert.ok(/sanitizeTheme/.test(main), 'main sanitizes stored theme values');
console.log('ok - main theme wiring');

// 5. Settings exposes a real theme picker.
assert.ok(settingsView.includes('commit({ theme:'), 'settings commits theme changes');
assert.ok(settingsView.includes('aria-label="앱 테마"'), 'theme picker group labelled');
assert.ok(!settingsView.includes('항상 켜짐'), 'dark-only notice removed');
console.log('ok - settings theme picker');

// 6. The suite runs this test.
assert.ok((pkg.scripts.test || '').includes('light-mode:test'), 'test chain includes light-mode');
assert.equal(pkg.scripts['light-mode:test'], 'node tests/light-mode-test.mjs');
console.log('ok - suite wiring');

console.log('LIGHT MODE TEST: ALL PASS');
