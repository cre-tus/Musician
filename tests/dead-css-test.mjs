import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dead-CSS regression: the composer-bar tune-btn redesign stopped rendering
// any `.tool` element (live DOM: zero `.tool` nodes), so every standalone
// `.tool` selector is dead; the 900px `.composer` arm is a no-op vs the
// 14px base. This locks the cleanup in: reintroducing a dead `.tool`
// selector or the no-op arm fails the suite.
// Exit 0 = ALL PASS.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

// 1. No standalone `.tool` selector token (`.tool-btn`/`.tool-pop` excluded).
const deadTool = bare.match(/\.tool(?![A-Za-z0-9_-])/g) || [];
assert.equal(deadTool.length, 0, `dead .tool selectors present: ${deadTool.length}`);
console.log('ok - no standalone .tool selectors');

// 2. The 900px block keeps only the live .chat-scroll arm.
const at = bare.indexOf('@media (max-width: 900px)');
assert.ok(at >= 0, '900px media block exists');
let depth = 0;
let end = -1;
for (let i = bare.indexOf('{', at); i < bare.length; i++) {
  if (bare[i] === '{') depth++;
  else if (bare[i] === '}') {
    depth--;
    if (depth === 0) { end = i; break; }
  }
}
assert.ok(end > at, '900px block closes');
const block = bare.slice(at, end);
assert.ok(/\.chat-scroll/.test(block), '900px block keeps the .chat-scroll arm');
assert.ok(!/\.composer(?![A-Za-z0-9_-])/.test(block), '900px block has no no-op .composer arm');
console.log('ok - 900px block holds only the live arm');

// 3. Liveness guard: neighbors of the deleted rules still exist.
assert.ok(/^\.composer \{/m.test(bare), '.composer base rule kept');
assert.ok(/^\.tool-btn \{/m.test(bare), '.tool-btn rule kept');
assert.ok(/^\.approval-select \{/m.test(bare), '.approval-select rule kept');
console.log('ok - live neighbors kept');

// 4. No dead popover selectors (whole block unrendered since the tune-btn
// redesign; no tsx/electron/mcp reference).
const deadPop = bare.match(/\.(tool-pop|pop-btn|pop-label|pop-value|pop-menu|pop-item|pop-check|pop-text)(?![A-Za-z0-9_-])/g) || [];
assert.equal(deadPop.length, 0, `dead popover selectors present: ${deadPop.length}`);
assert.ok(/^\.mini-profile \{/m.test(bare), '.mini-profile rule kept');
console.log('ok - no dead popover selectors');

// 5. No dead bars/stat selectors (old usage view; zero tsx/electron refs).
const deadBars = bare.match(/\.(bars|bar-row|bar-label|bar-track|bar-fill|bar-val|stat-cards|stat-card|stat-label|stat-value|stat-sub)(?![A-Za-z0-9_-])/g) || [];
assert.equal(deadBars.length, 0, `dead bars/stat selectors present: ${deadBars.length}`);
assert.ok(/^\.panel \{\n  border-color: var\(--border-soft\);\n  box-shadow: var\(--shadow\);\n\}$/m.test(bare),
  '.panel keeps its override declarations standalone');
assert.ok(/^\.seg\.active \{$/m.test(bare), '.seg.active rule kept');
console.log('ok - no dead bars/stat selectors');

// 6. No dead side/session selectors (old sidebar; zero tsx/electron/E2E refs).
const deadSide = bare.match(/\.(side-tabs|side-tab|side-body|side-footer|session-list|session-item|session-title)(?![A-Za-z0-9_-])/g) || [];
assert.equal(deadSide.length, 0, `dead side/session selectors present: ${deadSide.length}`);
assert.ok(/^\.side-actions \{$/m.test(bare), '.side-actions rule kept');
assert.ok(/^\.session-filters \{$/m.test(bare), '.session-filters rule kept');
console.log('ok - no dead side/session selectors');

// 7. No dead pill/status selectors (old badges; zero tsx/electron/E2E refs).
const deadPill = bare.match(/\.(pill|pill-ok|pill-bad|status-line|status-pill|status-btns)(?![A-Za-z0-9_-])/g) || [];
assert.equal(deadPill.length, 0, `dead pill/status selectors present: ${deadPill.length}`);
assert.ok(/^\.pill-picks \{$/m.test(bare), '.pill-picks rule kept');
console.log('ok - no dead pill/status selectors');

// 8. No dead diff/singleton selectors (old sidebar/badges; zero tsx/electron/E2E refs).
const deadMisc = bare.match(/\.(diff-chips|diff-chip|brand-sub|folder-path|msp-tag|field-hint|test-row|composer-row|xp-block)(?![A-Za-z0-9_-])/g) || [];
assert.equal(deadMisc.length, 0, `dead diff/misc selectors present: ${deadMisc.length}`);
assert.ok(/^\.brand-name \{$/m.test(bare), '.brand-name rule kept');
assert.ok(/^\.tag-msp \{$/m.test(bare), '.tag-msp rule kept');
assert.ok(/^\.composer-box \{$/m.test(bare), '.composer-box rule kept');
console.log('ok - no dead diff/misc selectors');

// 9. .file-status truncates instead of pushing file-bar actions out of view
// at narrow widths (ux-diskconflict NO_RELOAD_DLG at 1424px viewport).
const statusRule = bare.match(/^\.file-status \{[^}]*\}/m);
assert.ok(statusRule, '.file-status rule exists');
assert.ok(/min-width:\s*0/.test(statusRule[0]), '.file-status has min-width: 0');
assert.ok(/text-overflow:\s*ellipsis/.test(statusRule[0]), '.file-status truncates with ellipsis');
console.log('ok - .file-status truncates at narrow widths');

console.log('DEAD CSS TEST: ALL PASS');
