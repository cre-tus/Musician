// Pure badge state for the browser tab's agent indicator.
// Single source: live health signals, never the setting alone.
const REASON_LABEL = {
  AGENT_DISABLED: ['설정에서 꺼짐', 'Off in settings'],
  MCP_SERVER_FILE_MISSING: ['MCP 서버 파일 없음', 'MCP server file missing'],
  MCP_COMMAND_NOT_FOUND: ['실행 파일 없음', 'Executable missing'],
  BRIDGE_FILE_MISSING: ['브리지 파일 없음', 'Bridge file missing'],
  BRIDGE_PID_DEAD: ['브리지 종료됨', 'Bridge exited'],
  BRIDGE_UNREACHABLE: ['브리지에 연결 안 됨', 'Bridge unreachable'],
  BRIDGE_HEALTH_TIMEOUT: ['브리지 응답 없음', 'Bridge not responding'],
  BRIDGE_HEALTH_BAD_RESPONSE: ['브리지 응답 이상', 'Bad bridge response'],
  CLI_MCP_UNAVAILABLE: ['CLI 업데이트 필요', 'CLI update needed'],
  HEALTH_CHECK_FAILED: ['확인 실패', 'Check failed'],
};

export function reasonLabel(reason, lang = 'ko') {
  const code = String(reason || '').split(':')[0];
  const entry = REASON_LABEL[code];
  if (entry) return lang === 'en' ? entry[1] : entry[0];
  return code || (lang === 'en' ? 'Unknown' : '알 수 없음');
}

// { agentEnabled, health: {ok, reason}|null, agentActive, method }
// -> { mode, label, title, clickable }
export function agentBadgeState({ agentEnabled, health, agentActive, method }, lang = 'ko') {
  const en = lang === 'en';
  if (agentActive) {
    return {
      mode: 'active',
      label: en ? 'Agent driving' : '에이전트 조작 중',
      title: method ? `${en ? 'Agent' : '에이전트'}: ${method}` : en ? 'Agent driving' : '에이전트 조작 중',
      clickable: false,
    };
  }
  if (!agentEnabled) {
    return {
      mode: 'off',
      label: en ? 'Agent off' : '에이전트 꺼짐',
      title: en ? 'Agent control off (Settings → Browser)' : '에이전트 조종 꺼짐 (설정 → 브라우저)',
      clickable: false,
    };
  }
  if (!health) {
    return {
      mode: 'checking',
      label: en ? 'Checking agent' : '에이전트 확인 중',
      title: en ? 'Checking the browser bridge status' : '브라우저 브리지 상태를 확인하는 중',
      clickable: false,
    };
  }
  if (health.ok) {
    return {
      mode: 'ok',
      label: en ? 'Agent connected' : '에이전트 연결됨',
      title: en ? 'Browser bridge healthy · click to recheck' : '브라우저 브리지 정상 · 클릭하면 다시 확인',
      clickable: true,
    };
  }
  return {
    mode: 'down',
    label: en ? 'Agent disconnected' : '에이전트 연결 끊김',
    title: `${reasonLabel(health.reason, lang)}${health.reason ? ` (${health.reason})` : ''}${en ? ' · click to reconnect' : ' · 클릭하면 다시 연결'}`,
    clickable: true,
  };
}
