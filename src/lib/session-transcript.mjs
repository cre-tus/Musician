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

const TRANSCRIPT_TEXT = {
  ko: {
    untitled: '제목 없는 세션',
    sessionId: '세션 ID',
    workdir: '작업 폴더',
    createdAt: '생성 시각',
    exportedAt: '내보낸 시각',
    user: '사용자',
    runCommand: '실행 명령',
    runAt: '실행 위치',
    duration: '소요 시간',
    secs: '초',
    exitCode: '종료 코드',
    status: '상태',
    timedOut: '시간 초과',
    changedFiles: '변경 파일',
    changedStats: '변경 통계',
    verify: '검증 결과',
    pass: '통과',
    fail: '실패',
    none: '없음',
    workLog: '작업 로그',
    fileChanges: '파일 변경',
    reverted: '되돌림',
    emptyBody: '*(내용 없음)*',
  },
  en: {
    untitled: 'Untitled session',
    sessionId: 'Session ID',
    workdir: 'Working folder',
    createdAt: 'Created',
    exportedAt: 'Exported',
    user: 'User',
    runCommand: 'Run command',
    runAt: 'Ran at',
    duration: 'Duration',
    secs: 's',
    exitCode: 'Exit code',
    status: 'Status',
    timedOut: 'Timed out',
    changedFiles: 'Changed files',
    changedStats: 'Change stats',
    verify: 'Verification',
    pass: 'Passed',
    fail: 'Failed',
    none: 'none',
    workLog: 'Work log',
    fileChanges: 'File changes',
    reverted: 'Reverted',
    emptyBody: '*(empty)*',
  },
};

export function formatSessionTranscript(session, options = {}) {
  const t = TRANSCRIPT_TEXT[options.lang === 'en' ? 'en' : 'ko'];
  const title = String(session?.title || t.untitled).replace(/[\r\n\t]+/g, ' ').trim() || t.untitled;
  const createdAt = isoTimestamp(session?.createdAt);
  const exportedAt = isoTimestamp(options.exportedAt ?? Date.now());
  const metadata = [
    `- ${t.sessionId}: ${String(session?.id || '')}`,
    ...(session?.cwd || options.projectFallback ? [`- ${t.workdir}: ${String(session?.cwd || options.projectFallback)}`] : []),
    ...(createdAt ? [`- ${t.createdAt}: ${createdAt}`] : []),
    ...(exportedAt ? [`- ${t.exportedAt}: ${exportedAt}`] : []),
  ];
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const body = messages.map((message) => {
    const role = message?.role === 'user' ? t.user : 'Musician';
    const timestamp = isoTimestamp(message?.ts);
    const date = timestamp ? ` · ${timestamp}` : '';
    const text = String(message?.text || '').trim();
    const details = [];
    if (message?.cmd) details.push(`**${t.runCommand}**\n\n${fenced(message.cmd)}`);
    if (message?.cwd) details.push(`**${t.runAt}:** \`${message.cwd}\``);
    if (Number.isFinite(message?.durationMs) && message.durationMs > 0) details.push(`**${t.duration}:** ${(message.durationMs / 1000).toFixed(1)}${t.secs}`);
    if (message?.code !== null && message?.code !== undefined) details.push(`**${t.exitCode}:** ${message.code}`);
    if (message?.timeout) details.push(`**${t.status}:** ${t.timedOut}`);
    if (message?.changedFiles?.length) details.push(`**${t.changedFiles}:**\n${message.changedFiles.map((file) => `- \`${file}\``).join('\n')}`);
    if (message?.changedStats?.length) details.push(`**${t.changedStats}:**\n${message.changedStats.map((item) => `- \`${item.file}\`: +${item.added} / -${item.deleted}`).join('\n')}`);
    if (message?.verify?.length) details.push(`**${t.verify}:**\n${message.verify.map((item) => `- ${item.ok ? t.pass : t.fail} · \`${item.script}\` · ${t.exitCode} ${item.code ?? t.none}${item.ts ? ` · ${isoTimestamp(item.ts)}` : ''}${item.tail ? `\n\n${fenced(item.tail)}` : ''}`).join('\n')}`);
    if (message?.stderr) details.push(`**stderr**\n\n${fenced(message.stderr)}`);
    if (message?.work?.length) details.push(`**${t.workLog}**\n\n${fenced(message.work.join('\n'))}`);
    if (message?.reverted) details.push(`**${t.fileChanges}:** ${t.reverted}`);
    return `## ${role}${date}\n\n${text || t.emptyBody}${details.length ? `\n\n${details.join('\n\n')}` : ''}`;
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
