import assert from 'node:assert/strict';
import { mcpChatNotice } from '../src/lib/mcp-chat-notice.mjs';

// No health signal: nothing to say.
assert.equal(mcpChatNotice(null), null);
assert.equal(mcpChatNotice(undefined), null);
assert.equal(mcpChatNotice([]), null);

// Healthy servers stay silent.
assert.equal(mcpChatNotice([{ name: 'musician-browser', ok: true, reason: null }]), null);

// One unhealthy server names the cause and the fix.
const one = mcpChatNotice([{ name: 'musician-browser', ok: false, reason: 'BRIDGE_UNREACHABLE:127.0.0.1:61232' }]);
assert.ok(one.includes('musician-browser'), one);
assert.ok(one.includes('브리지에 연결 안 됨'), one);
assert.ok(one.includes('BRIDGE_UNREACHABLE:127.0.0.1:61232'), one);
assert.ok(one.includes('다시 연결'), one);

// Several failures collapse into one line.
const many = mcpChatNotice([
  { name: 'musician-browser', ok: false, reason: 'BRIDGE_FILE_MISSING:x' },
  { name: 'other', ok: false, reason: 'SOME_FUTURE_CODE' },
]);
assert.ok(many.includes('외 1건'), many);

// Missing reason still reports.
const unknown = mcpChatNotice([{ name: 'musician-browser', ok: false, reason: null }]);
assert.ok(unknown.includes('알 수 없음'), unknown);

console.log('MCP chat notice checks passed.');
