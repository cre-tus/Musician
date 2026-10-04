import assert from 'node:assert/strict';
import { formatSessionTranscript, formatSessionTranscripts } from '../src/lib/session-transcript.mjs';

const transcript = formatSessionTranscript({
  id: 'session-1',
  title: '검색 기능 개선',
  cwd: 'C:/work/Mudex',
  createdAt: Date.UTC(2026, 0, 2),
  messages: [
    { role: 'user', text: '검색 결과에 경로를 표시해줘.', ts: Date.UTC(2026, 0, 2, 1), done: true },
    { role: 'assistant', text: '경로 정보를 추가했습니다.', ts: Date.UTC(2026, 0, 2, 2), done: true },
  ],
});

assert.match(transcript, /^# 검색 기능 개선/m);
assert.match(transcript, /- 세션 ID: session-1/);
assert.match(transcript, /- 작업 폴더: C:\/work\/Mudex/);
assert.match(transcript, /## 사용자 · 2026-01-02T01:00:00\.000Z\n\n검색 결과에 경로를 표시해줘\./);
assert.match(transcript, /## Musician · 2026-01-02T02:00:00\.000Z\n\n경로 정보를 추가했습니다\./);
assert.match(formatSessionTranscript({ id: 'empty', title: '', messages: [] }), /제목 없는 세션/);

const richTranscript = formatSessionTranscript({
  id: 'rich',
  title: '실행 정보',
  messages: [{
    role: 'assistant',
    text: '수정과 검증을 마쳤습니다.',
    ts: Date.UTC(2026, 0, 2, 3),
    cmd: 'npm test\n```literal```',
    cwd: 'C:/work/Mudex',
    durationMs: 1250,
    code: 0,
    changedFiles: ['src/App.tsx'],
    changedStats: [{ file: 'src/App.tsx', added: 4, deleted: 2 }],
    verify: [{ script: 'npm test', ok: true, code: 0, tail: 'all passed', ts: Date.UTC(2026, 0, 2, 3, 1) }],
    stderr: 'warning: sample',
    work: ['updated App.tsx'],
    reverted: true,
  }],
}, { exportedAt: Date.UTC(2026, 0, 2, 4), projectFallback: 'C:/fallback' });
assert.match(richTranscript, /- 작업 폴더: C:\/fallback/);
assert.match(richTranscript, /- 내보낸 시각: 2026-01-02T04:00:00\.000Z/);
assert.match(richTranscript, /\*\*실행 명령\*\*\n\n````\nnpm test\n```literal```\n````/);
assert.match(richTranscript, /\*\*종료 코드:\*\* 0/);
assert.match(richTranscript, /\*\*변경 통계:\*\*\n- `src\/App\.tsx`: \+4 \/ -2/);
assert.match(richTranscript, /검증 결과:[\s\S]*통과 · `npm test` · 종료 코드 0/);
assert.match(richTranscript, /\*\*stderr\*\*[\s\S]*warning: sample/);
assert.match(richTranscript, /\*\*작업 로그\*\*[\s\S]*updated App\.tsx/);
assert.match(richTranscript, /\*\*파일 변경:\*\* 되돌림/);

const combinedTranscript = formatSessionTranscripts([
  { id: 'first', title: '첫 번째 대화', messages: [{ role: 'user', text: '요청 1' }] },
  { id: 'second', title: '두 번째 대화', messages: [{ role: 'user', text: '요청 2' }] },
], { exportedAt: Date.UTC(2026, 0, 2, 5) });
assert.ok(combinedTranscript.indexOf('# 첫 번째 대화') < combinedTranscript.indexOf('# 두 번째 대화'));
assert.match(combinedTranscript, /요청 1[\s\S]*---[\s\S]*요청 2/);
assert.equal(formatSessionTranscripts(null), '');

console.log('Session transcript formatting checks passed.');
