import assert from 'node:assert/strict';
import { clampChatScrollTop, parseChatScrollState } from '../src/lib/chat-scroll-state.mjs';

assert.deepEqual(parseChatScrollState('{"scrollTop":120.7,"follow":false}'), { scrollTop: 120, follow: false });
assert.deepEqual(parseChatScrollState('{"scrollTop":0}'), { scrollTop: 0, follow: true });
assert.equal(parseChatScrollState('not json'), null);
assert.equal(parseChatScrollState('{"scrollTop":-1}'), null);
assert.equal(clampChatScrollTop({ scrollTop: 500, follow: false }, 240), 240);
assert.equal(clampChatScrollTop({ scrollTop: 30, follow: true }, 240), 30);
assert.equal(clampChatScrollTop(null, 240), 0);

console.log('Chat scroll position checks passed.');
