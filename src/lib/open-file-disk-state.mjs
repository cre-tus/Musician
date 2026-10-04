export function createUnavailableRestoredFile(path, draft) {
  const name = String(path || '').split(/[\\/]/).pop() || String(path || '파일');
  return {
    path,
    name,
    original: typeof draft?.original === 'string' ? draft.original : '',
    content: typeof draft?.content === 'string' ? draft.content : '',
    dirty: !!draft,
    showDiff: false,
    diskState: 'unavailable',
  };
}

export function reconcileOpenFileDiskState(file, result) {
  if (!result?.ok) {
    if (result?.error === 'FILE_MISSING' && (file.diskState !== 'missing' || file.externalContent !== undefined)) {
      return { ...file, diskState: 'missing', externalContent: undefined };
    }
    if (result?.error && result.error !== 'FILE_MISSING' && file.diskState !== 'unavailable') {
      return { ...file, diskState: 'unavailable', externalContent: undefined };
    }
    return file;
  }
  if (typeof result.content !== 'string') return file;
  if (!file.dirty) {
    if (file.original === result.content && file.content === result.content && !file.diskState) return file;
    return { ...file, original: result.content, content: result.content, dirty: false, diskState: undefined, externalContent: undefined };
  }
  const diskState = result.content === file.original ? undefined : 'changed';
  const externalContent = diskState ? result.content : undefined;
  if (file.diskState === diskState && file.externalContent === externalContent) return file;
  return { ...file, diskState, externalContent };
}
