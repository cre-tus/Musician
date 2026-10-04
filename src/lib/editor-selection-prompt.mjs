function codeFence(text) {
  const longest = Math.max(0, ...String(text || '').match(/`+/g)?.map((run) => run.length) || []);
  return '`'.repeat(Math.max(3, longest + 1));
}

export function formatEditorSelectionPrompt({ relativePath, startLine, endLine, language, text }) {
  const source = String(text || '');
  if (!source.trim()) return '';
  const path = String(relativePath || '열린 파일').replace(/[`\\]/g, '\\$&');
  const firstLine = Number.isInteger(startLine) && startLine > 0 ? startLine : 1;
  const lastLine = Number.isInteger(endLine) && endLine >= firstLine ? endLine : firstLine;
  const lineRange = firstLine === lastLine ? `줄 ${firstLine}` : `줄 ${firstLine}-${lastLine}`;
  const lang = String(language || '').replace(/[^\w+-]/g, '');
  const fence = codeFence(source);
  return `선택한 코드 영역을 참고해줘. 경로: \`${path}\` (${lineRange})\n\n${fence}${lang}\n${source}\n${fence}`;
}
