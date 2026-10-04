import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Modal/shortcut/schedule UI contract:
// - Every modal backdrop safe-centers: the dialog looks centered when short
//   but scrolls from the top (never clips its head) when tall or the window
//   is short. Implemented as backdrop align-start + overflow + dialog margin
//   auto, so the resting look is unchanged.
// - One size scale (.modal-sm/.modal/.modal-lg); palette and quick-open share
//   the same top-anchored offset instead of two different ones.
// - Shortcut rows render one <kbd> per chord (split by splitShortcutKeys)
//   with styled separators; group ids are index-based (valid for
//   aria-labelledby); settings key rows wrap instead of overflowing.
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('src/styles.css');
const shortcutsDialog = read('src/components/KeyboardShortcutsDialog.tsx');
const app = read('src/App.tsx');
const chat = read('src/components/ChatView.tsx');
const scheduleDialogs = read('src/components/ScheduledPrompts.tsx');
const pkg = JSON.parse(read('package.json'));
const blockOf = (sel) => {
  const at = css.indexOf(sel);
  assert.ok(at >= 0, `${sel} styled`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in ${sel}`);
};

// 1. Modal backdrop safe-centering (resting look unchanged: margin auto).
const backdrop = blockOf('.modal-backdrop {');
assert.ok(/align-items:\s*flex-start/.test(backdrop), 'modal backdrop top-anchors tall content');
assert.ok(/overflow-y:\s*auto/.test(backdrop), 'modal backdrop scrolls');
assert.ok(/padding:\s*24px 16px/.test(backdrop), 'modal backdrop keeps edge clearance');
assert.ok(/margin:\s*auto/.test(blockOf('.modal {')), 'modal margin-auto centers when short');
console.log('ok - modal safe-centering');

// 2. One size scale; existing widths preserved.
assert.ok(/width:\s*520px/.test(blockOf('.modal {')), '.modal stays 520px');
assert.ok(/width:\s*400px/.test(blockOf('.modal-sm {')), '.modal-sm is 400px');
assert.ok(/width:\s*680px/.test(blockOf('.modal-lg {')), '.modal-lg is 680px');
assert.ok(/width:\s*440px/.test(blockOf('.confirm-dialog {')), '.confirm-dialog stays 440px');
console.log('ok - modal size scale');

// 3. Palette and quick-open share one top-anchored offset.
const paletteBackdrop = blockOf('.palette-backdrop {');
const quickBackdrop = blockOf('.quick-open-backdrop {');
for (const [name, block] of [['palette', paletteBackdrop], ['quick-open', quickBackdrop]]) {
  assert.ok(/align-items:\s*flex-start/.test(block), `${name} backdrop top-anchors`);
  assert.ok(/padding:\s*min\(14vh,\s*120px\) 20px 20px/.test(block), `${name} backdrop shares the top offset`);
}
console.log('ok - palette/quick-open offset');

// 4. Shortcuts dialog scrolls safely on short windows.
const shortcutsBackdrop = blockOf('.shortcuts-backdrop {');
assert.ok(/overflow-y:\s*auto/.test(shortcutsBackdrop), 'shortcuts backdrop scrolls');
assert.ok(/margin:\s*auto/.test(blockOf('.shortcuts-dialog {')), 'shortcuts dialog margin-auto centers');
assert.ok(/overflow-y:\s*auto/.test(blockOf('.tune-backdrop {')), 'tune backdrop scrolls on short windows');
console.log('ok - shortcuts safe-centering');

// 5. Shortcut chips: one kbd per chord, styled separators, unified mono.
assert.ok(/\.shortcut-sep\s*\{/.test(css), '.shortcut-sep styled');
assert.ok(/var\(--mono\)/.test(blockOf('.shortcut-row kbd {')), 'shortcut kbd uses --mono');
assert.ok(shortcutsDialog.includes('splitShortcutKeys'), 'dialog splits chords into chips');
assert.ok(shortcutsDialog.includes('shortcutGroupId'), 'dialog uses index-based group ids');
assert.ok(!shortcutsDialog.includes('shortcuts-${group.title}'), 'no space-bearing group ids');
console.log('ok - shortcut chips');

// 6. Dialog rows match the real keymap (Ctrl+1-9 tab jump, F1 palette).
assert.ok(shortcutsDialog.includes('Ctrl+1'), 'dialog lists number-key tab jump');
assert.ok(shortcutsDialog.includes('F1'), 'dialog lists the F1 palette key');
assert.ok(shortcutsDialog.includes('Ctrl+Alt+R'), 'dialog lists the schedule-list key');
assert.ok(shortcutsDialog.includes('/new'), 'dialog points at slash commands');
assert.ok(app.includes("k === 'r'"), 'App handles the schedule-list key');
const settingsView = read('src/components/SettingsView.tsx');
assert.ok(settingsView.includes('Ctrl+Alt+R'), 'settings lists the schedule-list key');
assert.ok(chat.includes('/ 명령'), 'composer placeholder hints slash commands');
assert.ok(app.includes("'Ctrl+Alt+R'"), 'palette hints the schedule-list key');
console.log('ok - dialog keymap coverage');

// 7. Settings key rows wrap instead of squeezing the label out.
const keys = blockOf('.keys {');
assert.ok(/flex-wrap:\s*wrap/.test(keys), '.keys wraps');
assert.ok(/justify-content:\s*flex-end/.test(keys), '.keys right-aligns wrapped rows');
assert.ok(/\.setting-row > span:first-child \{[^}]*min-width:\s*0/.test(css), 'setting labels can shrink');
console.log('ok - settings keys wrap');

// 8. Schedule-dialog + message-time chrome exists.
for (const sel of ['.schedule-dialog {', '.schedule-presets {', '.schedule-row {', '.schedule-list {', '.msg-time {']) {
  assert.ok(css.includes(sel), `${sel} styled`);
}
console.log('ok - schedule + msg-time chrome');

// 9. Schedule wiring: composer button, fire delivery/consumption, repeat.
assert.ok(chat.includes('aria-label="프롬프트 예약"'), 'composer carries the schedule button');
assert.ok(chat.includes('msg-time'), 'messages render timestamps');
assert.ok(chat.includes('onScheduledConsumed'), 'ChatView reports fire consumption');
assert.ok(app.includes('scheduledFire') && app.includes('setInterval(tick, 20000)'), 'App ticks and delivers due prompts');
assert.ok(app.includes('rollRepeatingPrompt'), 'App rolls repeating prompts on consumption');
assert.ok(app.includes("item.repeat === 'once'"), 'App retires only one-shot items as missed');
assert.ok(app.includes('scheduled-prompts') && app.includes('setScheduleListOpen(true)'), 'palette manages reservations');
assert.ok(scheduleDialogs.includes('반복 선택'), 'schedule dialog offers repeat');
assert.ok(scheduleDialogs.includes('매일') && scheduleDialogs.includes('매주'), 'repeat options rendered');
console.log('ok - schedule wiring');

// 10. Slash commands: popup chrome, composer wiring, App mapping.
for (const sel of ['.composer-slash {', '.composer-slash-heading {', '.composer-slash-option {']) {
  assert.ok(css.includes(sel), `${sel} styled`);
}
assert.ok(chat.includes('composer-slash-results'), 'composer renders the slash popup');
assert.ok(chat.includes('acceptSlashCommand'), 'composer accepts slash commands');
assert.ok(chat.includes('findSlashCommand'), 'composer parses the leading token');
assert.ok(chat.includes('tuneSignal'), 'ChatView receives the tune signal');
assert.ok(app.includes('runSlashCommand'), 'App maps slash ids to affordances');
assert.ok(app.includes('setTuneSignal'), 'App signals the tune popover');
assert.ok(app.includes("case 'diff'") && app.includes("case 'terminal'"), 'slash maps /diff and /terminal');
assert.ok(app.includes("id: 'tune-model'"), 'palette offers model tuning');
assert.ok(app.includes("id: 'export-active-transcript'"), 'palette exports the active transcript');
const terminal = read('src/components/TerminalTab.tsx');
assert.ok(terminal.includes('registerLinkProvider'), 'terminal registers the link provider');
assert.ok(terminal.includes('findTerminalLinks'), 'terminal uses the link spans');
assert.ok(terminal.includes('openExternalLink'), 'terminal opens links externally');
console.log('ok - slash wiring');

// 11. Suite wiring for this bundle.
for (const name of ['modal-layout', 'shortcut-display', 'scheduled-prompts', 'slash-commands', 'terminal-links']) {
  assert.ok((pkg.scripts.test || '').includes(`${name}:test`), `test chain includes ${name}`);
  assert.equal(pkg.scripts[`${name}:test`], `node tests/${name}-test.mjs`);
}
assert.ok((pkg.scripts.test || '').includes('exit-marker:test'), 'test chain includes exit-marker');
assert.equal(pkg.scripts['exit-marker:test'], 'node tests/exit-marker-test.js');
console.log('ok - suite wiring');

console.log('MODAL LAYOUT TEST: ALL PASS');
