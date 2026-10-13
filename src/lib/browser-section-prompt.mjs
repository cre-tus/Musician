// Prompt block for "ask about this browser section": a page reference header
// plus the captured section as a quote. The user types their question after
// it in the composer — nothing is sent automatically.
function escapeInline(value) {
  return String(value || '').replace(/[`\\]/g, '\\$&');
}

function quoteLines(text) {
  return String(text || '')
    .trim()
    .slice(0, 4000)
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

export function formatBrowserSectionAnnotation({ pageTitle, pageUrl, tagPath, text, linkUrl, question }, uiLang = 'ko') {
  const prompt = formatBrowserSectionPrompt({ pageTitle, pageUrl, tagPath, text, linkUrl }, uiLang);
  if (!prompt) return '';
  const asked = String(question || '').trim().slice(0, 2000);
  if (!asked) return prompt;
  const label = uiLang === 'en' ? 'Question' : '질문';
  return `${prompt}\n\n${label}: ${asked}`;
}

export function formatBrowserSectionPrompt({ pageTitle, pageUrl, tagPath, text, linkUrl }, uiLang = 'ko') {
  const source = String(text || '');
  if (!source.trim()) return '';
  const en = uiLang === 'en';
  const title = escapeInline(pageTitle);
  const url = String(pageUrl || '');
  const section = escapeInline(tagPath);
  const head = en
    ? `Refer to this web page section. Page: \`${title}\` <${url}>${section ? ` (section: \`${section}\`)` : ''}`
    : `이 웹페이지 부분을 참고해줘. 페이지: \`${title}\` <${url}>${section ? ` (섹션: \`${section}\`)` : ''}`;
  const link = String(linkUrl || '').trim();
  const body = quoteLines(source);
  if (link) return `${head}\n${en ? 'Link' : '링크'}: <${link}>\n\n${body}`;
  return `${head}\n\n${body}`;
}
