'use strict';
// Project folders + per-folder sessions test: lib helpers behave, and the
// sidebar/app wiring exposes add/select/remove/new-session.
// Exit 0 = ALL PASS, exit 1 = FAIL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function extractFn(src, start) {
  let i = src.indexOf('{', start);
  assert.ok(i >= 0, 'function body found');
  let depth = 0;
  let quote = null;
  let esc = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1).replace(/^export\s+/, '');
    }
  }
  throw new Error('unbalanced braces in target function');
}

const libSrc = read('src/lib/mudex.ts');
const pathUtilsSrc = read('src/lib/path-utils.mjs');
const normAt = pathUtilsSrc.indexOf('export function normalizePathForComparison(');
const normHelper = extractFn(pathUtilsSrc, normAt);
function loadFn(name) {
  const at = libSrc.indexOf(`export function ${name}(`);
  assert.ok(at >= 0, `${name} defined in lib/mudex`);
  const js = extractFn(libSrc, at)
    .replace(`${name}(projects: string[], folder: string): string[]`, `${name}(projects, folder)`);
  return new Function(`${normHelper}\n${js}\nreturn ${name};`)();
}
const addProject = loadFn('addProject');
const removeProject = loadFn('removeProject');

// 1. addProject appends, dedups, ignores empties; removeProject filters.
assert.deepEqual(addProject([], 'C:\\a'), ['C:\\a']);
assert.deepEqual(addProject(['C:\\a'], 'C:\\a'), ['C:\\a']);
assert.deepEqual(addProject(['C:\\a'], 'C:\\b'), ['C:\\a', 'C:\\b']);
assert.deepEqual(addProject(['C:\\a'], ''), ['C:\\a']);
assert.deepEqual(removeProject(['C:\\a', 'C:\\b'], 'C:\\a'), ['C:\\b']);
assert.deepEqual(removeProject(['C:\\a'], 'C:\\z'), ['C:\\a']);
assert.deepEqual(removeProject(['C:\\a'], 'C:\\a\\'), []);
assert.deepEqual(removeProject(['C:\\a'], 'c:/a'), []);
console.log('ok - addProject/removeProject behavior');

// 2. persistence keys + cwd-carrying sessions.
assert.ok(/LS_PROJECTS = 'mudex:projects:v1'/.test(libSrc), 'projects storage key');
assert.ok(/function loadProjects\(\)/.test(libSrc) && /function saveProjects\(/.test(libSrc), 'load/save projects');
assert.ok(/function newSession\(cwd\?: string\)/.test(libSrc), 'newSession takes an optional cwd');
console.log('ok - lib persistence + session cwd');

// 3. the existing project groups carry add/select/remove/new-session.
const sidebar = read('src/components/Sidebar.tsx');
assert.ok(!sidebar.includes('project-folders'), 'no separate folders section');
assert.ok(sidebar.includes('프로젝트 폴더 추가'), 'add action in the project header');
assert.ok(sidebar.includes('props.projects'), 'groups union registered folders');
assert.ok(sidebar.includes('map.set(p, [])'), 'empty folders still list a group');
assert.ok(sidebar.includes('group-actions'), 'per-group action buttons');
assert.ok(sidebar.includes('onAddProject'), 'add action');
assert.ok(sidebar.includes('onSelectProject'), 'select action');
assert.ok(sidebar.includes('onRemoveProject'), 'remove action');
assert.ok(sidebar.includes('onNewSessionInFolder'), 'per-project new session action');
assert.ok(sidebar.includes('group-head active'), 'active project highlighted');
console.log('ok - sidebar projects wiring');

// 4. app owns the project list and routes per-folder sessions.
const appView = read('src/App.tsx');
assert.ok(appView.includes('loadProjects') && appView.includes('saveProjects'), 'App persists projects');
assert.ok(appView.includes('activateFolder'), 'App activates folders');
assert.ok(appView.includes('newChatInFolder'), 'App creates sessions in a folder');
assert.ok(appView.includes('onNewSessionInFolder={'), 'App passes the action down');
console.log('ok - app projects wiring');

console.log('PROJECTS TEST: ALL PASS');
