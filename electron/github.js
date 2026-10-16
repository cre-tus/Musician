'use strict';

// GitHub PR/CI without the gh CLI: the git CLI supplies local context
// (remote, branch, HEAD), api.github.com REST does the rest. The token is
// optional — public-repo reads work unauthenticated (60 req/h); mutations
// without one return an honest NEED_TOKEN instead of failing obscurely.
// `fetchFn`/`runGit` are injected so unit tests never touch the network.

const API_BASE = 'https://api.github.com';
const TIMEOUT_MS = 15000;

function parseGitHubRemote(url) {
  const raw = String(url || '').trim();
  let m = raw.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = raw.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

function needRepo(ctx) {
  if (!ctx || !ctx.owner || !ctx.repo) return 'NO_GITHUB_REMOTE';
  return null;
}

async function ghRequest({ fetchFn, token, method = 'GET', apiPath, body }) {
  if (typeof fetchFn !== 'function') return { ok: false, error: 'NO_FETCH' };
  const upper = String(method || 'GET').toUpperCase();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'musician-app',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (timer.unref) timer.unref();
  try {
    const res = await fetchFn(`${API_BASE}${apiPath}`, { method: upper, headers, body: payload, signal: ctrl.signal });
    const status = res && typeof res.status === 'number' ? res.status : 0;
    let data = null;
    try {
      data = res ? await res.json() : null;
    } catch {
      data = null;
    }
    if (status === 401 || status === 403) {
      const msg = data && data.message ? String(data.message) : '';
      if (/rate limit/i.test(msg)) return { ok: false, status, error: 'RATE_LIMITED', reset: res.headers && typeof res.headers.get === 'function' ? res.headers.get('x-ratelimit-reset') : null };
      return { ok: false, status, error: status === 401 ? 'BAD_TOKEN' : 'FORBIDDEN' };
    }
    if (status === 404) return { ok: false, status, error: 'NOT_FOUND' };
    if (status < 200 || status >= 300) return { ok: false, status, error: (data && data.message) || `HTTP_${status}` };
    return { ok: true, status, data };
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}

async function getRepoContext({ runGit }, cwd) {
  if (typeof runGit !== 'function' || !cwd) return { ok: false, error: 'NO_ARGS' };
  const remote = await runGit(cwd, ['remote', 'get-url', 'origin']);
  if (!remote.ok) return { ok: false, error: 'NO_ORIGIN' };
  const parsed = parseGitHubRemote(String(remote.stdout || '').split('\n')[0]);
  if (!parsed) return { ok: false, error: 'NO_GITHUB_REMOTE' };
  const branch = await runGit(cwd, ['branch', '--show-current']);
  const sha = await runGit(cwd, ['rev-parse', 'HEAD']);
  return {
    ok: true,
    owner: parsed.owner,
    repo: parsed.repo,
    branch: branch.ok ? String(branch.stdout || '').trim() : '',
    sha: sha.ok ? String(sha.stdout || '').trim() : '',
  };
}

async function findOpenPr(deps, { owner, repo, branch }) {
  const missing = needRepo({ owner, repo });
  if (missing) return { ok: false, error: missing };
  if (!branch) return { ok: false, error: 'NO_BRANCH' };
  const r = await ghRequest({ ...deps, apiPath: `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open` });
  if (!r.ok) return r;
  const list = Array.isArray(r.data) ? r.data : [];
  const pr = list[0];
  if (!pr) return { ok: true, pr: null };
  return {
    ok: true,
    pr: {
      number: pr.number,
      title: pr.title || '',
      state: pr.state || 'open',
      url: pr.html_url || '',
      body: pr.body || '',
      head: (pr.head && pr.head.ref) || branch,
      base: (pr.base && pr.base.ref) || '',
      createdAt: pr.created_at || null,
    },
  };
}

async function getDefaultBranch(deps, { owner, repo }) {
  const missing = needRepo({ owner, repo });
  if (missing) return { ok: false, error: missing };
  const r = await ghRequest({ ...deps, apiPath: `/repos/${owner}/${repo}` });
  if (!r.ok) return r;
  return { ok: true, base: (r.data && r.data.default_branch) || 'main' };
}

async function createPr(deps, { owner, repo, head, base, title, body }) {
  const missing = needRepo({ owner, repo });
  if (missing) return { ok: false, error: missing };
  if (!deps.token) return { ok: false, error: 'NEED_TOKEN' };
  if (!head || !base || !title) return { ok: false, error: 'NO_ARGS' };
  const r = await ghRequest({ ...deps, method: 'POST', apiPath: `/repos/${owner}/${repo}/pulls`, body: { head, base, title, body: body || '' } });
  if (!r.ok) return r;
  return { ok: true, pr: { number: r.data.number, title: r.data.title || '', state: r.data.state || 'open', url: r.data.html_url || '', body: r.data.body || '' } };
}

async function updatePr(deps, { owner, repo, number, title, body }) {
  const missing = needRepo({ owner, repo });
  if (missing) return { ok: false, error: missing };
  if (!deps.token) return { ok: false, error: 'NEED_TOKEN' };
  if (!number) return { ok: false, error: 'NO_ARGS' };
  const patch = {};
  if (typeof title === 'string' && title.trim()) patch.title = title;
  if (typeof body === 'string') patch.body = body;
  const r = await ghRequest({ ...deps, method: 'PATCH', apiPath: `/repos/${owner}/${repo}/pulls/${number}`, body: patch });
  if (!r.ok) return r;
  return { ok: true, pr: { number: r.data.number, title: r.data.title || '', state: r.data.state || 'open', url: r.data.html_url || '', body: r.data.body || '' } };
}

function normalizeComments(issues, reviews) {
  const out = [];
  for (const c of Array.isArray(issues) ? issues : []) {
    if (!c || typeof c !== 'object') continue;
    out.push({
      id: `issue-${c.id}`,
      kind: 'comment',
      author: (c.user && c.user.login) || '',
      body: String(c.body || '').slice(0, 4000),
      path: null,
      line: null,
      createdAt: c.created_at || '',
      url: c.html_url || '',
    });
  }
  for (const c of Array.isArray(reviews) ? reviews : []) {
    if (!c || typeof c !== 'object') continue;
    out.push({
      id: `review-${c.id}`,
      kind: 'review',
      author: (c.user && c.user.login) || '',
      body: String(c.body || '').slice(0, 4000),
      path: typeof c.path === 'string' ? c.path : null,
      line: typeof c.line === 'number' ? c.line : (typeof c.original_line === 'number' ? c.original_line : null),
      createdAt: c.created_at || c.submitted_at || '',
      url: c.html_url || '',
    });
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return out.slice(0, 100);
}

async function listPrComments(deps, { owner, repo, number }) {
  const missing = needRepo({ owner, repo });
  if (missing) return { ok: false, error: missing };
  if (!number) return { ok: false, error: 'NO_ARGS' };
  const [issues, reviews] = await Promise.all([
    ghRequest({ ...deps, apiPath: `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100` }),
    ghRequest({ ...deps, apiPath: `/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100` }),
  ]);
  if (!issues.ok) return issues;
  if (!reviews.ok) return reviews;
  return { ok: true, comments: normalizeComments(issues.data, reviews.data) };
}

async function getCheckRuns(deps, { owner, repo, sha }) {
  const missing = needRepo({ owner, repo });
  if (missing) return { ok: false, error: missing };
  if (!sha) return { ok: false, error: 'NO_SHA' };
  const r = await ghRequest({ ...deps, apiPath: `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100` });
  if (!r.ok) return r;
  const runs = Array.isArray(r.data && r.data.check_runs) ? r.data.check_runs : [];
  let ok = 0;
  let failed = 0;
  let pending = 0;
  const rows = runs.slice(0, 50).map((c) => {
    const conclusion = c.conclusion || null;
    const status = c.status || '';
    if (conclusion === 'success') ok += 1;
    else if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'action_required') failed += 1;
    else pending += 1;
    return {
      name: c.name || '',
      status,
      conclusion,
      url: c.html_url || c.details_url || '',
    };
  });
  return { ok: true, total: runs.length, okCount: ok, failedCount: failed, pendingCount: pending, runs: rows };
}

// Raw-text GET for non-JSON endpoints (Actions job logs). Same auth and
// timeout discipline as ghRequest; follows the signed-URL redirect.
async function ghText({ fetchFn, token, apiPath }) {
  if (typeof fetchFn !== 'function') return { ok: false, error: 'NO_FETCH' };
  const headers = { 'User-Agent': 'musician-app', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (timer.unref) timer.unref();
  try {
    const res = await fetchFn(`${API_BASE}${apiPath}`, { headers, signal: ctrl.signal });
    const status = res && typeof res.status === 'number' ? res.status : 0;
    if (status === 401 || status === 403) return { ok: false, status, error: status === 401 ? 'BAD_TOKEN' : 'FORBIDDEN' };
    if (status < 200 || status >= 300) return { ok: false, status, error: `HTTP_${status}` };
    return { ok: true, status, text: res ? await res.text() : '' };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

const CI_RUNS_MAX = 5;
const CI_FAILED_JOBS_MAX = 3;
const CI_LOG_TAIL = 6000;

// Failed CI jobs for a head SHA: workflow run -> jobs -> failed steps plus
// the tail of each failed job's log, ready to paste into the conversation.
async function getFailedJobLogs(deps, { owner, repo, sha }) {
  const missing = needRepo({ owner, repo });
  if (missing) return { ok: false, error: missing };
  if (!sha) return { ok: false, error: 'NO_SHA' };
  const runsR = await ghRequest({ ...deps, apiPath: `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=${CI_RUNS_MAX}` });
  if (!runsR.ok) return runsR;
  const runs = (runsR.data && Array.isArray(runsR.data.workflow_runs) ? runsR.data.workflow_runs : []).slice(0, CI_RUNS_MAX);
  const jobs = [];
  for (const run of runs) {
    if (jobs.length >= CI_FAILED_JOBS_MAX) break;
    const jobsUrl = run && run.jobs_url ? String(run.jobs_url) : '';
    const m = jobsUrl.match(/^https:\/\/api\.github\.com(\/repos\/[^/]+\/[^/]+\/actions\/runs\/\d+\/jobs)/);
    const jobsR = await ghRequest({ ...deps, apiPath: m ? `${m[1]}?per_page=50` : '' });
    if (!jobsR.ok || !m) continue;
    const list = jobsR.data && Array.isArray(jobsR.data.jobs) ? jobsR.data.jobs : [];
    for (const job of list) {
      if (jobs.length >= CI_FAILED_JOBS_MAX) break;
      if (!job || job.conclusion !== 'failure') continue;
      const failedSteps = (Array.isArray(job.steps) ? job.steps : [])
        .filter((s) => s && s.conclusion === 'failure')
        .map((s) => s.name || '')
        .filter(Boolean)
        .slice(0, 10);
      let tail = '';
      if (job.id) {
        const logR = await ghText({ ...deps, apiPath: `/repos/${owner}/${repo}/actions/jobs/${job.id}/logs` });
        if (logR.ok) tail = String(logR.text || '').replace(/\r/g, '').slice(-CI_LOG_TAIL);
      }
      jobs.push({
        runName: (run && run.name) || '',
        jobName: job.name || '',
        failedSteps,
        url: job.html_url || '',
        tail,
      });
    }
  }
  return { ok: true, jobs };
}

module.exports = {
  parseGitHubRemote,
  ghRequest,
  ghText,
  getRepoContext,
  findOpenPr,
  getDefaultBranch,
  createPr,
  updatePr,
  normalizeComments,
  listPrComments,
  getCheckRuns,
  getFailedJobLogs,
};
