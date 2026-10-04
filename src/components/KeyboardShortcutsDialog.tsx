import React, { useEffect, useRef } from 'react';
import { XIcon } from './icons';
import { scheduleAfterPaint } from '../lib/after-paint.mjs';
import { shortcutGroupId, splitShortcutKeys } from '../lib/shortcut-display.mjs';

const groups = [
  {
    title: '탐색',
    shortcuts: [
      ['Ctrl+P', '파일 빠르게 열기'],
      ['Ctrl+N', '새 스레드 시작'],
      ['Ctrl+Shift+P / Ctrl+K / F1', '명령 팔레트'],
      ['> / # / @ (명령 팔레트)', '명령 / 세션 / 열린 탭 결과만 검색'],
      ['Ctrl+Shift+E', '파일 탐색기 열기'],
      ['Ctrl+Alt+S', '세션 검색 열기'],
      ['Ctrl+Alt+R', '예약된 프롬프트 관리'],
      ['Ctrl+L', '브라우저 탭에서 주소창 선택'],
      ['Ctrl+F (브라우저 탭)', '웹페이지에서 찾기'],
      ['Alt+← / Alt+→', '브라우저 뒤로 / 앞으로'],
      ['Ctrl+R / F5', '브라우저 새로고침'],
      ['Esc', '브라우저 로딩 중지'],
      ['↑ / ↓ · ← / → (탐색기)', '항목 이동 · 폴더 접기/펼치기 · 펼친 폴더의 첫 항목으로 이동'],
      ['F2 / Delete', '포커스된 탐색기 항목 이름 변경 / 삭제'],
      ['Ctrl+B', '사이드바 표시/숨기기'],
      ['Ctrl+Alt+E', '채팅/편집기 패널 표시/숨기기'],
      ['Ctrl+,', '설정 열기'],
      ['Ctrl+F (설정)', '설정 옵션 검색'],
      ['Ctrl+Shift+`', '새 터미널 열기'],
      ['Ctrl+R (터미널)', '명령 기록 검색'],
      ['Ctrl+L (터미널)', '터미널 화면 지우기'],
      ['Ctrl+Shift+/', '키보드 단축키 도움말'],
    ],
  },
  {
    title: '대화와 파일',
    shortcuts: [
      ['Ctrl+F', '현재 대화에서 찾기'],
      ['Ctrl+Shift+F', '파일 내용 검색 (선택한 한 줄 미리 채움)'],
      ['Ctrl+Shift+T', '닫은 탭 다시 열기'],
      ['Ctrl+Alt+PageUp / PageDown', '최근 사용 세션 전환'],
      ['↑ / ↓ · Home / End (사이드바)', '세션 목록 키보드 이동'],
      ['Ctrl+S', '현재 파일 저장'],
      ['Ctrl+Shift+S', '변경 파일 모두 저장'],
      ['Ctrl+Shift+V (Markdown)', '원문/미리보기 전환'],
      ['/new', '슬래시 명령 (입력 시작)'],
    ],
  },
  {
    title: '탭과 편집기',
    shortcuts: [
      ['Ctrl+Tab / Ctrl+Shift+Tab', '최근 사용한 탭 전환'],
      ['Ctrl+1 – Ctrl+9', '번호로 탭 이동 (9는 마지막 탭)'],
      ['Ctrl+PageDown / Ctrl+PageUp', '다음 / 이전 탭'],
      ['Ctrl+Shift+← / → / PageUp / PageDown', '현재 탭 순서 이동'],
      ['Ctrl+W', '현재 탭 닫기'],
      ['Ctrl+Shift+W', '모든 탭 닫기'],
      ['Ctrl+G', '줄 또는 줄:열로 이동'],
      ['Alt+← / Alt+→ (편집기)', '이전 / 다음 코드 위치'],
      ['Ctrl+Shift+O', '현재 파일에서 기호로 이동'],
      ['F12 / Shift+F12', '정의로 이동 / 참조 찾기'],
      ['Alt+F12', '정의 미리보기'],
      ['Ctrl+F12', '형식 정의로 이동'],
      ['Shift+Alt+F', '현재 파일 서식 정리'],
      ['Ctrl+K Ctrl+F', '선택 영역 서식 정리'],
      ['Ctrl+K Ctrl+0 / Ctrl+K Ctrl+J', '코드 모두 접기 / 펼치기'],
      ['Alt+Z', '줄바꿈 켜기/끄기'],
      ['Ctrl+= / Ctrl+-', '편집기 글자 크기 조절'],
      ['Ctrl+0', '편집기 글자 크기 초기화'],
    ],
  },
];

export default function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) scheduleAfterPaint(() => target.focus({ preventScroll: true }));
    };
  }, []);

  return (
    <div className="shortcuts-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Tab') {
            event.preventDefault();
            closeButtonRef.current?.focus();
          }
        }}
      >
        <header className="shortcuts-dialog-head">
          <div>
            <h2 id="shortcuts-dialog-title">키보드 단축키</h2>
            <p>자주 쓰는 탐색·대화·편집기 명령</p>
          </div>
          <button ref={closeButtonRef} type="button" className="icon-btn" aria-label="단축키 도움말 닫기" onClick={onClose}><XIcon size={15} /></button>
        </header>
        <div className="shortcuts-groups">
          {groups.map((group, groupIndex) => (
            <section key={group.title} aria-labelledby={shortcutGroupId(groupIndex)}>
              <h3 id={shortcutGroupId(groupIndex)}>{group.title}</h3>
              <dl>
                {group.shortcuts.map(([keys, label]) => (
                  <div className="shortcut-row" key={keys}>
                    <dt>{label}</dt>
                    <dd>
                      {splitShortcutKeys(keys).map((part, partIndex) =>
                        part.type === 'sep'
                          ? <span key={partIndex} className="shortcut-sep" aria-hidden="true">{part.text}</span>
                          : <kbd key={partIndex}>{part.text}</kbd>,
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
