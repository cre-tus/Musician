import assert from 'node:assert/strict';
import { SLASH_COMMANDS, findSlashCommand, matchSlashCommands } from '../src/lib/slash-commands.mjs';

// The table covers app actions with existing affordances (nothing new to wire).
assert.deepEqual(SLASH_COMMANDS.map((cmd) => cmd.id), ['new', 'model', 'usage', 'settings', 'shortcuts', 'schedule', 'export', 'diff', 'terminal']);
for (const cmd of SLASH_COMMANDS) {
  assert.ok(cmd.name.startsWith('/'), `${cmd.id} has a slash name`);
  assert.ok(cmd.title && cmd.hint, `${cmd.id} has title + hint`);
}

// findSlashCommand only fires at the very start of the input.
assert.deepEqual(findSlashCommand('/', 1), { query: '' });
assert.deepEqual(findSlashCommand('/u', 2), { query: 'u' });
assert.deepEqual(findSlashCommand('/new', 4), { query: 'new' });
assert.equal(findSlashCommand('/new', 0), null);
assert.equal(findSlashCommand('/new ', 5), null);
assert.equal(findSlashCommand('/new line', 6), null);
assert.equal(findSlashCommand('hello', 5), null);
assert.equal(findSlashCommand(' /u', 3), null);
assert.equal(findSlashCommand('', 0), null);
assert.equal(findSlashCommand(null, 0), null);

// matchSlashCommands ranks prefix hits first, matches Korean titles too.
assert.deepEqual(matchSlashCommands('').map((cmd) => cmd.id), ['new', 'model', 'usage', 'settings', 'shortcuts', 'schedule', 'export', 'diff', 'terminal']);
assert.equal(matchSlashCommands('u')[0].id, 'usage');
assert.equal(matchSlashCommands('d')[0].id, 'diff');
assert.equal(matchSlashCommands('t')[0].id, 'terminal');
assert.equal(matchSlashCommands('변경')[0].id, 'diff');
assert.equal(matchSlashCommands('U')[0].id, 'usage');
assert.equal(matchSlashCommands('모델')[0].id, 'model');
assert.equal(matchSlashCommands('예약')[0].id, 'schedule');
assert.deepEqual(matchSlashCommands('xyz'), []);
assert.ok(matchSlashCommands('s').length <= 8);
assert.equal(matchSlashCommands('', 3).length, 3);

console.log('Slash commands passed.');
