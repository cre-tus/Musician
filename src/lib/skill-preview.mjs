// Viewable GitHub page for a skill search result. Prefers the API-provided
// page URL when it is an https github.com link; otherwise rebuilds the repo
// page from a valid owner/name. Returns '' when nothing safe can be built.
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function validRepo(repo) {
  if (!REPO_RE.test(repo)) return false;
  const [owner, name] = repo.split('/');
  return owner !== '.' && owner !== '..' && name !== '.' && name !== '..';
}

export function skillPreviewUrl(candidate) {
  const row = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : null;
  if (!row) return '';
  const repo = typeof row.repo === 'string' ? row.repo : '';
  const fallback = validRepo(repo) ? `https://github.com/${repo}` : '';
  const url = typeof row.url === 'string' ? row.url : '';
  if (url === 'https://github.com/' || url.startsWith('https://github.com/')) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.toLowerCase() === 'github.com') return url;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
