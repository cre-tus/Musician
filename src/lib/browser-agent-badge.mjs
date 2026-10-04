// Pure badge state for the browser tab's agent indicator.
// Single source: live health signals, never the setting alone.
export function reasonLabel(reason) {
  const code = String(reason || '').split(':')[0];
  switch (code) {
    case 'AGENT_DISABLED': return '설정에서 꺼짐';
    case 'MCP_SERVER_FILE_MISSING': return 'MCP 서버 파일 없음';
    case 'MCP_COMMAND_NOT_FOUND': return '실행 파일 없음';
    case 'BRIDGE_FILE_MISSING': return '브리지 파일 없음';
    case 'BRIDGE_PID_DEAD': return '브리지 종료됨';
    case 'BRIDGE_UNREACHABLE': return '브리지에 연결 안 됨';
    case 'BRIDGE_HEALTH_TIMEOUT': return '브리지 응답 없음';
    case 'BRIDGE_HEALTH_BAD_RESPONSE': return '브리지 응답 이상';
    case 'CLI_MCP_UNAVAILABLE': return 'CLI 업데이트 필요';
    case 'HEALTH_CHECK_FAILED': return '확인 실패';
    default: return code || '알 수 없음';
  }
}

// { agentEnabled, health: {ok, reason}|null, agentActive, method }
// -> { mode, label, title, clickable }
export function agentBadgeState({ agentEnabled, health, agentActive, method }) {
  if (agentActive) {
    return {
      mode: 'active',
      label: '에이전트 조작 중',
      title: method ? `에이전트: ${method}` : '에이전트 조작 중',
      clickable: false,
    };
  }
  if (!agentEnabled) {
    return {
      mode: 'off',
      label: '에이전트 꺼짐',
      title: '에이전트 조종 꺼짐 (설정 → 브라우저)',
      clickable: false,
    };
  }
  if (!health) {
    return {
      mode: 'checking',
      label: '에이전트 확인 중',
      title: '브라우저 브리지 상태를 확인하는 중',
      clickable: false,
    };
  }
  if (health.ok) {
    return {
      mode: 'ok',
      label: '에이전트 연결됨',
      title: '브라우저 브리지 정상 · 클릭하면 다시 확인',
      clickable: true,
    };
  }
  return {
    mode: 'down',
    label: '에이전트 연결 끊김',
    title: `${reasonLabel(health.reason)}${health.reason ? ` (${health.reason})` : ''} · 클릭하면 다시 연결`,
    clickable: true,
  };
}
