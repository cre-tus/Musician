import assert from 'node:assert/strict';
import { agentBadgeState, reasonLabel } from '../src/lib/browser-agent-badge.mjs';

// Active pulse wins over everything.
assert.deepEqual(
  agentBadgeState({ agentEnabled: true, health: { ok: true, reason: null }, agentActive: true, method: 'click' }),
  { mode: 'active', label: '에이전트 조작 중', title: '에이전트: click', clickable: false },
);

// Setting off never claims a connection.
assert.deepEqual(
  agentBadgeState({ agentEnabled: false, health: { ok: true, reason: null }, agentActive: false, method: '' }),
  { mode: 'off', label: '에이전트 꺼짐', title: '에이전트 조종 꺼짐 (설정 → 브라우저)', clickable: false },
);

// No signal yet: checking, not connected.
assert.deepEqual(
  agentBadgeState({ agentEnabled: true, health: null, agentActive: false, method: '' }),
  { mode: 'checking', label: '에이전트 확인 중', title: '브라우저 브리지 상태를 확인하는 중', clickable: false },
);

// Healthy bridge.
assert.deepEqual(
  agentBadgeState({ agentEnabled: true, health: { ok: true, reason: null }, agentActive: false, method: '' }),
  { mode: 'ok', label: '에이전트 연결됨', title: '브라우저 브리지 정상 · 클릭하면 다시 확인', clickable: true },
);

// Unhealthy bridge carries the reason and offers a retry.
const down = agentBadgeState({ agentEnabled: true, health: { ok: false, reason: 'BRIDGE_UNREACHABLE:127.0.0.1:61232' }, agentActive: false, method: '' });
assert.equal(down.mode, 'down');
assert.equal(down.label, '에이전트 연결 끊김');
assert.equal(down.clickable, true);
assert.ok(down.title.includes('브리지에 연결 안 됨'), down.title);
assert.ok(down.title.includes('다시 연결'), down.title);

// Reason labels.
assert.equal(reasonLabel('BRIDGE_FILE_MISSING:x'), '브리지 파일 없음');
assert.equal(reasonLabel('CLI_MCP_UNAVAILABLE'), 'CLI 업데이트 필요');
assert.equal(reasonLabel('MCP_SERVER_FILE_MISSING:x'), 'MCP 서버 파일 없음');
assert.equal(reasonLabel('SOME_FUTURE_CODE:x'), 'SOME_FUTURE_CODE');

console.log('Browser agent badge state checks passed.');
