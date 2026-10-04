export function findTextMatchRanges(text, query, caseSensitive = false, wholeWord = false) {
  const source = String(text || '');
  const rawQuery = String(query || '');
  if (!source || !rawQuery) return [];

  const sourceChars = [];
  for (let offset = 0; offset < source.length;) {
    const point = String.fromCodePoint(source.codePointAt(offset));
    const folded = caseSensitive ? point : point.toLocaleLowerCase();
    for (const character of folded) sourceChars.push({ character, start: offset, end: offset + point.length });
    offset += point.length;
  }
  const queryChars = Array.from(caseSensitive ? rawQuery : rawQuery.toLocaleLowerCase());
  const ranges = [];
  let cursor = 0;
  while (cursor <= sourceChars.length - queryChars.length) {
    let matched = true;
    for (let index = 0; index < queryChars.length; index += 1) {
      if (sourceChars[cursor + index].character !== queryChars[index]) {
        matched = false;
        break;
      }
    }
    if (!matched) {
      cursor += 1;
      continue;
    }
    const start = sourceChars[cursor].start;
    const end = sourceChars[cursor + queryChars.length - 1].end;
    if (wholeWord) {
      const isWordCharacter = (character) => !!character && /[\p{L}\p{N}_]/u.test(character);
      const before = start > 0 ? Array.from(source.slice(Math.max(0, start - 2), start)).at(-1) : '';
      const after = Array.from(source.slice(end, end + 2))[0] || '';
      if (isWordCharacter(before) || isWordCharacter(after)) {
        cursor += 1;
        continue;
      }
    }
    const previous = ranges[ranges.length - 1];
    if (previous && start < previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
    cursor += queryChars.length;
  }
  return ranges;
}
