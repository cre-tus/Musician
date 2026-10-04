'use strict';
// Profile + tune-modal wiring test: bottom bar is one mini profile whose
// modal offers Settings/Codex, and model+approval+reasoning live in one
// borderless modal instead of three framed listboxes.
// Exit 0 = ALL PASS, exit 1 = FAIL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const sidebar = read('src/components/Sidebar.tsx');
const chat = read('src/components/ChatView.tsx');
const appView = read('src/App.tsx');

// 1. bottom bar = one mini profile, no multi-button row.
assert.ok(/mini-profile/.test(sidebar), 'Sidebar has a mini profile button');
assert.ok(!/status-btns/.test(sidebar), 'Sidebar has no multi-button row');
// 2. profile modal offers settings + codex integration.
assert.ok(/profile-card/.test(sidebar), 'Sidebar has a profile modal');
assert.ok(/onOpenCodex/.test(sidebar), 'profile modal triggers Codex integration');
assert.ok(/onOpenSettings/.test(sidebar), 'profile modal triggers Settings');
console.log('ok - mini profile + modal');

// 3. top Codex button gone, panel toggle icon-only.
assert.ok(!/>\s*Codex 연동\s*<\/button>/.test(chat), 'no top Codex button in chat header');
assert.ok(!/<PanelIcon size={15} \/>\s*패널/.test(chat), 'panel toggle has no text label');
assert.ok(/onToggleEditor/.test(chat), 'panel toggle still wired');
console.log('ok - header cleanup');

// 4. model/approval/reasoning in one modal, no framed listboxes.
assert.ok(!/function PopSelect/.test(chat), 'no PopSelect listbox component');
assert.ok(!/openMenu === 'model'/.test(chat), 'no per-field popup state');
assert.ok(/tuneOpen/.test(chat), 'single tune modal state');
assert.ok(/tune-card/.test(chat), 'tune modal dialog');
assert.ok(/changeModel/.test(chat) && /changeApproval/.test(chat) && /changeReasoning/.test(chat),
  'all three setters still reachable from the modal');
console.log('ok - unified tune modal');

// 5. App routes profile Codex action into the active thread handoff.
assert.ok(/onOpenCodex/.test(appView), 'App handles profile Codex action');
assert.ok(/codexSignal/.test(appView), 'App forwards a codex signal');
assert.ok(/codexSignal/.test(chat), 'ChatView opens handoff on signal');
console.log('ok - codex signal wiring');

// 6. profile dot is enlarged, modal opens above the button, timeout is off.
const css = read('src/styles.css');
const dotBlock = (css.match(/\.avatar \.s-dot\s*\{[^}]*\}/) || [''])[0];
assert.ok(/width:\s*1\dpx/.test(dotBlock), 'avatar status dot is enlarged');
const cardBlock = (css.match(/\.profile-card\s*\{[^}]*\}/) || [''])[0];
assert.ok(/position:\s*fixed/.test(cardBlock), 'profile card is anchored, not centered');
assert.ok(/bottom:/.test(cardBlock), 'profile card sits above the button');
const backdropBlock = (css.match(/\.profile-backdrop\s*\{[^}]*\}/) || [''])[0];
assert.ok(/background:\s*transparent/.test(backdropBlock), 'profile backdrop is a click layer, not a dim');
const main = read('electron/main.js');
assert.ok(/execTimeoutMs > 0/.test(main), 'exec run has no timer when timeout is 0');
assert.ok(/timeoutMs > 0/.test(main), 'msp run has no timer when timeout is 0');
console.log('ok - profile dot + popover + timeout off');

console.log('PROFILE TUNE TEST: ALL PASS');
