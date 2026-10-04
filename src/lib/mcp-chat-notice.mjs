// One-line chat notice for session MCP pre-flight failures.
//
// The host stays silent when an OPTIONAL MCP server fails to start, so the
// chat-start ack carries mcpHealth and the chat surface says it out loud.
// Returns null when there is nothing to report.
import { reasonLabel } from './browser-agent-badge.mjs';

export function mcpChatNotice(mcpHealth, lang = 'ko') {
  const bad = (Array.isArray(mcpHealth) ? mcpHealth : []).filter((h) => h && h.ok === false);
  if (bad.length === 0) return null;
  const first = bad[0];
  const en = lang === 'en';
  const extra = bad.length > 1 ? (en ? ` +${bad.length - 1} more` : ` 외 ${bad.length - 1}건`) : '';
  const code = first.reason ? ` (${first.reason})` : '';
  if (en) return `Browser tools didn’t connect to the model (${first.name}: ${reasonLabel(first.reason, lang)}${extra})${code} — press the browser tab badge to reconnect.`;
  return `브라우저 도구가 모델에 연결되지 않았어 (${first.name}: ${reasonLabel(first.reason)}${extra})${code} — 브라우저 탭의 배지를 눌러 다시 연결해줘.`;
}
