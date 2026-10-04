function isoTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return '';
  try { return new Date(timestamp).toISOString(); } catch { return ''; }
}

function codeFence(value) {
  const longest = Math.max(0, ...String(value).match(/`+/g)?.map((run) => run.length) || []);
  return '`'.repeat(Math.max(3, longest + 1));
}

function fenced(value) {
  const text = String(value || '');
  const fence = codeFence(text);
  return `${fence}\n${text}\n${fence}`;
}

export function formatSessionTranscript(session, options = {}) {
  const title = String(session?.title || '제목 없는 세션').replace(/[\r\n\t]+/g, ' ').trim() || '제목 없는 세션';
  const createdAt = isoTimestamp(session?.createdAt);
  const exportedAt = isoTimestamp(options.exportedAt ?? Date.now());
  const metadata = [
    `- 세션 ID: ${String(session?.id || '')}`,
    ...(session?.cwd || options.projectFallback ? [`- 작업 폴더: ${String(session?.cwd || options.projectFallback)}`] : []),
    ...(createdAt ? [`- 생성 시각: ${createdAt}`] : []),
    ...(exportedAt ? [`- 내보낸 시각: ${exportedAt}`] : []),
  ];
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const body = messages.map((message) => {
    const role = message?.role === 'user' ? '사용자' : 'Musician';
    const timestamp = isoTimestamp(message?.ts);
    const date = timestamp ? ` · ${timestamp}` : '';
    const text = String(message?.text || '').trim();
    const details = [];
    if (message?.cmd) details.push(`**실행 명령**\n\n${fenced(message.cmd)}`);
    if (message?.cwd) details.push(`**실행 위치:** \`${message.cwd}\``);
    if (Number.isFinite(message?.durationMs) && message.durationMs > 0) details.push(`**소요 시간:** ${(message.durationMs / 1000).toFixed(1)}초`);
    if (message?.code !== null && message?.code !== undefined) details.push(`**종료 코드:** ${message.code}`);
    if (message?.timeout) details.push('**상태:** 시간 초과');
    if (message?.changedFiles?.length) details.push(`**변경 파일:**\n${message.changedFiles.map((file) => `- \`${file}\``).join('\n')}`);
    if (message?.changedStats?.length) details.push(`**변경 통계:**\n${message.changedStats.map((item) => `- \`${item.file}\`: +${item.added} / -${item.deleted}`).join('\n')}`);
    if (message?.verify?.length) details.push(`**검증 결과:**\n${message.verify.map((item) => `- ${item.ok ? '통과' : '실패'} · \`${item.script}\` · 종료 코드 ${item.code ?? '없음'}${item.ts ? ` · ${isoTimestamp(item.ts)}` : ''}${item.tail ? `\n\n${fenced(item.tail)}` : ''}`).join('\n')}`);
    if (message?.stderr) details.push(`**stderr**\n\n${fenced(message.stderr)}`);
    if (message?.work?.length) details.push(`**작업 로그**\n\n${fenced(message.work.join('\n'))}`);
    if (message?.reverted) details.push('**파일 변경:** 되돌림');
    return `## ${role}${date}\n\n${text || '*(내용 없음)*'}${details.length ? `\n\n${details.join('\n\n')}` : ''}`;
  });
  return `# ${title}\n\n${metadata.join('\n')}\n\n${body.join('\n\n---\n\n')}`.trimEnd();
}

export function formatSessionTranscripts(sessions, options = {}) {
  if (!Array.isArray(sessions)) return '';
  return sessions
    .filter((session) => session && typeof session === 'object')
    .map((session) => formatSessionTranscript(session, options))
    .join('\n\n---\n\n');
}
