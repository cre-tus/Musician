'use strict';
// CLI skills (muse skills … --json) + GitHub skill search for the SkillsTab.
// Pure builders/parsers below are unit-tested in tests/cli-skills-test.js;
// the thin spawn/fetch runtime at the bottom stays untested like spawnCli.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnCli } = require('./spawn-cli');

const MAX_SEARCH_RESULTS = 10;
const MAX_PROBE_DIRS = 5;
const GITHUB_API = 'https://api.github.com';

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

// Normalize `muse skills list --json` stdout.
// -> { ok:true, skills:[{id,name,scope,description,path,activation}] }
// -> { ok:false, code, error }
function parseSkillsList(stdout) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(stdout == null ? '' : stdout));
  } catch {
    return { ok: false, code: 'INVALID_JSON', error: 'Could not parse skills output.' };
  }
  const root = asRecord(parsed);
  if (!root) return { ok: false, code: 'BAD_SHAPE', error: 'Unexpected skills output.' };
  if (root.error) {
    const err = asRecord(root.error) || {};
    return { ok: false, code: String(err.code || 'SKILLS_ERROR'), error: String(err.message || 'Skills command failed.') };
  }
  if (!Array.isArray(root.skills)) return { ok: false, code: 'BAD_SHAPE', error: 'Unexpected skills output.' };
  const skills = [];
  for (const entry of root.skills) {
    const row = asRecord(entry);
    if (!row || typeof row.id !== 'string' || !row.id) continue;
    skills.push({
      id: row.id,
      name: typeof row.name === 'string' && row.name ? row.name : row.id,
      scope: typeof row.scope === 'string' ? row.scope : '',
      description: typeof row.description === 'string' ? row.description : '',
      path: typeof row.path === 'string' ? row.path : '',
      activation: row.activation === 'off' ? 'off' : 'on',
    });
  }
  return { ok: true, skills };
}

// Normalize mutating CLI JSON ({installed}/{uninstalled}/{activation} or {error}).
function parseSkillsResult(stdout, what) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(stdout == null ? '' : stdout));
  } catch {
    return { ok: false, code: 'INVALID_JSON', error: 'Could not parse skills output.' };
  }
  const root = asRecord(parsed);
  if (!root) return { ok: false, code: 'BAD_SHAPE', error: 'Unexpected skills output.' };
  if (root.error) {
    const err = asRecord(root.error) || {};
    return { ok: false, code: String(err.code || 'SKILLS_ERROR'), error: String(err.message || `Could not ${what}.`) };
  }
  return { ok: true, data: root };
}

// Pure argv builder for `muse … --json`. Throws on bad action/params.
function skillsArgs(action, params) {
  const p = asRecord(params) || {};
  switch (action) {
    case 'list':
      return p.scope ? ['skills', 'list', '--source', String(p.scope), '--json'] : ['skills', 'list', '--json'];
    case 'install': {
      if (!p.path || typeof p.path !== 'string') throw new Error('skills install needs a path.');
      return ['skills', 'install', p.path, '--scope', 'user', '--json'];
    }
    case 'uninstall': {
      if (!p.id || typeof p.id !== 'string') throw new Error('skills uninstall needs an id.');
      return ['skills', 'uninstall', p.id, '--json'];
    }
    case 'enable':
    case 'disable': {
      if (!p.id || typeof p.id !== 'string') throw new Error(`skills ${action} needs an id.`);
      return ['skills', action, p.id, '--scope', 'user', '--json'];
    }
    default:
      throw new Error(`Unknown skills action: ${String(action)}.`);
  }
}

function buildRepoSearchUrl(query, perPage) {
  const size = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Number(perPage) || MAX_SEARCH_RESULTS));
  const params = new URLSearchParams({
    q: `${String(query || '').trim()} skill in:name,description`,
    sort: 'stars',
    order: 'desc',
    per_page: String(size),
  });
  return `${GITHUB_API}/search/repositories?${params.toString()}`;
}

// -> { ok:true, candidates:[{repo,url,stars,description}] } / { ok:false, code, error }
function parseRepoSearch(status, text) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(text == null ? '' : text));
  } catch {
    parsed = null;
  }
  const root = asRecord(parsed) || {};
  if (status === 403 || status === 429 || /rate limit/i.test(String(root.message || ''))) {
    return { ok: false, code: 'RATE_LIMITED', error: 'GitHub search rate limit reached. Try again in a minute.' };
  }
  if (status < 200 || status >= 300 || !Array.isArray(root.items)) {
    return { ok: false, code: 'GITHUB_ERROR', error: String(root.message || `GitHub search failed (${status}).`) };
  }
  const candidates = [];
  for (const item of root.items) {
    const row = asRecord(item);
    if (!row || typeof row.full_name !== 'string') continue;
    candidates.push({
      repo: row.full_name,
      url: typeof row.html_url === 'string' ? row.html_url : `https://github.com/${row.full_name}`,
      stars: typeof row.stargazers_count === 'number' ? row.stargazers_count : 0,
      description: typeof row.description === 'string' && row.description ? row.description : '',
    });
  }
  return { ok: true, candidates };
}

// Root SKILL.md first; otherwise probe up to N subdirectories for SKILL.md.
function skillContentsUrl(repo, dir) {
  const sub = dir ? `/${dir}` : '';
  return `${GITHUB_API}/repos/${repo}/contents${sub}/SKILL.md`;
}

function repoRootUrl(repo) {
  return `${GITHUB_API}/repos/${repo}/contents`;
}

// -> string[] of subdir names worth probing (dirs only, capped).
function skillDirCandidates(rootListingText) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(rootListingText == null ? '' : rootListingText));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const dirs = [];
  for (const entry of parsed) {
    const row = asRecord(entry);
    if (!row || row.type !== 'dir' || typeof row.name !== 'string') continue;
    if (row.name.startsWith('.')) continue;
    dirs.push(row.name);
    if (dirs.length >= MAX_PROBE_DIRS) break;
  }
  return dirs;
}

// -> { found:true } / { found:false } / { error:'RATE_LIMITED' }
function parseContentsProbe(status) {
  if (status === 200) return { found: true };
  if (status === 404) return { found: false };
  if (status === 403 || status === 429) return { found: false, error: 'RATE_LIMITED' };
  return { found: false, error: 'GITHUB_ERROR' };
}

function buildCloneArgs(url, dir) {
  return ['clone', '--depth', '1', String(url), String(dir)];
}

const AGENT_MAX_RESULTS = 5;

// Strict-JSON agent prompt: natural-language need -> GitHub skill candidates.
// The agent only lists candidates; star counts and SKILL.md verification run
// locally so the agent run stays short and the numbers stay honest.
function buildAgentSearchPrompt(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('EMPTY_QUERY');
  return [
    `Find Muse Code CLI skills on GitHub for this need: "${q}".`,
    'Rules:',
    '- List candidate repositories (single skill or skill collection).',
    '- Do NOT open repository contents; do NOT look up star counts.',
    `- Up to ${AGENT_MAX_RESULTS} candidates, best first.`,
    '- Reply with ONLY this JSON object, no markdown fences, no other text:',
    '{"results":[{"repo":"owner/name","description":"..."}]}',
  ].join('\n');
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

// -> { ok:true, candidates:[{repo,description,stars}] } / { ok:false, code }
function parseAgentSearchResult(text) {
  const raw = String(text == null ? '' : text).trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    const inline = body.match(/\{[\s\S]*\}/);
    if (inline) {
      try { parsed = JSON.parse(inline[0]); } catch { parsed = null; }
    }
  }
  const root = asRecord(parsed);
  if (!root || !Array.isArray(root.results)) return { ok: false, code: 'AGENT_PARSE_ERROR' };
  const candidates = [];
  for (const entry of root.results) {
    const row = asRecord(entry);
    if (!row || typeof row.repo !== 'string' || !REPO_RE.test(row.repo)) continue;
    candidates.push({
      repo: row.repo,
      description: typeof row.description === 'string' ? row.description : '',
      stars: typeof row.stars === 'number' ? row.stars : 0,
    });
    if (candidates.length >= AGENT_MAX_RESULTS) break;
  }
  return { ok: true, candidates };
}

function resolveInstallDir(cloneDir, skillSubdir) {
  return skillSubdir ? path.join(String(cloneDir), String(skillSubdir)) : String(cloneDir);
}

// ---- thin runtime (untested, mirrors the cli-test spawn pattern) ----
function collectChild(child, timeoutMs, label) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      resolve({ ok: false, code: 'TIMEOUT', error: `${label} timed out.` });
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: err && err.code === 'ENOENT' ? 'NOT_FOUND' : 'SPAWN_FAILED', error: String((err && err.message) || err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function runMuseSkills(cliPath, args, timeoutMs) {
  let child;
  try {
    child = spawnCli(cliPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return { ok: false, code: 'SPAWN_FAILED', error: String((err && err.message) || err) };
  }
  return collectChild(child, timeoutMs || 30000, 'muse skills');
}

function githubHeaders(env) {
  const headers = { 'User-Agent': 'musician', Accept: 'application/vnd.github+json' };
  const token = (env || process.env).GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchText(url, fetchImpl, timeoutMs) {
  const impl = fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try {
    const res = await impl(url, { headers: githubHeaders(), signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

// Free quota lookup (does not consume core). -> { ok, remaining, reset }
async function fetchRateLimit(fetchImpl) {
  let res;
  try {
    res = await fetchText(`${GITHUB_API}/rate_limit`, fetchImpl);
  } catch {
    return { ok: false };
  }
  if (res.status !== 200) return { ok: false };
  let parsed = null;
  try {
    parsed = asRecord(JSON.parse(res.text));
  } catch {
    return { ok: false };
  }
  const resources = parsed ? asRecord(parsed.resources) : null;
  const core = resources ? asRecord(resources.core) : null;
  if (!core || typeof core.remaining !== 'number' || typeof core.reset !== 'number') return { ok: false };
  return { ok: true, remaining: core.remaining, reset: core.reset };
}

function formatResetClock(resetEpoch) {
  const d = new Date(Number(resetEpoch) * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function rateLimitedResult(fetchImpl) {
  const out = { ok: false, code: 'RATE_LIMITED', error: 'GitHub search rate limit reached. Try again in a minute.' };
  const rl = await fetchRateLimit(fetchImpl);
  if (rl.ok) {
    const clock = formatResetClock(rl.reset);
    if (clock) {
      out.reset = clock;
      out.error = `GitHub search rate limit reached. Try again after ${clock}.`;
    }
  }
  return out;
}

function verifyOpts(opts) {
  const options = asRecord(opts) || {};
  const max = Number(options.maxVerified);
  return {
    cache: options.cache instanceof Map ? options.cache : null,
    maxVerified: Number.isFinite(max) && max > 0 ? Math.floor(max) : Infinity,
  };
}

async function locateSkillDir(repo, fetchImpl) {
  const root = await fetchText(skillContentsUrl(repo, ''), fetchImpl);
  const rootProbe = parseContentsProbe(root.status);
  if (rootProbe.error) return { error: rootProbe.error };
  if (rootProbe.found) return { subdir: '' };
  const listing = await fetchText(repoRootUrl(repo), fetchImpl);
  if (listing.status === 403 || listing.status === 429) return { error: 'RATE_LIMITED' };
  if (listing.status !== 200) return { error: 'GITHUB_ERROR' };
  for (const dir of skillDirCandidates(listing.text)) {
    const probe = await fetchText(skillContentsUrl(repo, dir), fetchImpl);
    const parsed = parseContentsProbe(probe.status);
    if (parsed.error) return { error: parsed.error };
    if (parsed.found) return { subdir: dir };
  }
  return { subdir: null };
}

// Retry only when the agent offered repos but none verified (wrong picks,
// not an empty query or a transport failure).
function shouldRetryAgentSearch(verified, parsed) {
  return !!(
    verified && verified.ok && Array.isArray(verified.results) && verified.results.length === 0
    && parsed && parsed.ok && Array.isArray(parsed.candidates) && parsed.candidates.length > 0
  );
}

// Confirm each candidate: SKILL.md probe first (root, else up to N
// subdirs), repo metadata (real stars) only for hits. Agent-supplied
// text is display-only. opts: { cache: Map(repo -> row|null),
// maxVerified: stop starting new candidates after N hits }.
// -> { ok:true, results:[{repo,url,stars,description,subdir}] } / { ok:false, code, error, reset? }
async function verifySkillCandidates(candidates, fetchImpl, opts) {
  const { cache, maxVerified } = verifyOpts(opts);
  const results = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (results.length >= maxVerified) break;
    const row = asRecord(candidate);
    if (!row || typeof row.repo !== 'string') continue;
    if (cache && cache.has(row.repo)) {
      const hit = cache.get(row.repo);
      if (hit) results.push(hit);
      continue;
    }
    let located;
    try {
      located = await locateSkillDir(row.repo, fetchImpl);
    } catch (err) {
      return { ok: false, code: 'NETWORK_ERROR', error: String((err && err.message) || err) };
    }
    if (located.error) {
      if (located.error === 'RATE_LIMITED') return rateLimitedResult(fetchImpl);
      if (cache) cache.set(row.repo, null);
      continue;
    }
    if (located.subdir == null) {
      if (cache) cache.set(row.repo, null);
      continue;
    }
    let meta;
    try {
      meta = await fetchText(`${GITHUB_API}/repos/${row.repo}`, fetchImpl);
    } catch (err) {
      return { ok: false, code: 'NETWORK_ERROR', error: String((err && err.message) || err) };
    }
    if (meta.status === 403 || meta.status === 429) return rateLimitedResult(fetchImpl);
    if (meta.status !== 200) {
      if (cache) cache.set(row.repo, null);
      continue;
    }
    let info = null;
    try { info = asRecord(JSON.parse(meta.text)); } catch { info = null; }
    const apiStars = info && typeof info.stargazers_count === 'number' ? info.stargazers_count : 0;
    const apiDesc = info && typeof info.description === 'string' ? info.description : '';
    const out = {
      repo: row.repo,
      url: `https://github.com/${row.repo}`,
      stars: apiStars,
      description: typeof row.description === 'string' && row.description ? row.description : apiDesc,
      subdir: located.subdir,
    };
    if (cache) cache.set(row.repo, out);
    results.push(out);
  }
  return { ok: true, results };
}

async function searchGithubSkills(query, fetchImpl, opts) {
  const { cache, maxVerified } = verifyOpts(opts);
  const q = String(query || '').trim();
  if (!q) return { ok: false, code: 'EMPTY_QUERY', error: 'Type what the skill should do.' };
  let first;
  try {
    first = await fetchText(buildRepoSearchUrl(q), fetchImpl);
  } catch (err) {
    return { ok: false, code: 'NETWORK_ERROR', error: String((err && err.message) || err) };
  }
  const repos = parseRepoSearch(first.status, first.text);
  // NOTE: a 403 here is the *search* quota (10/min), not core — no reset clock.
  if (!repos.ok) return repos;
  const results = [];
  for (const candidate of repos.candidates) {
    if (results.length >= maxVerified) break;
    if (cache && cache.has(candidate.repo)) {
      const hit = cache.get(candidate.repo);
      if (hit) results.push(hit);
      continue;
    }
    let located;
    try {
      located = await locateSkillDir(candidate.repo, fetchImpl);
    } catch (err) {
      return { ok: false, code: 'NETWORK_ERROR', error: String((err && err.message) || err) };
    }
    if (located.error) {
      if (located.error === 'RATE_LIMITED') return rateLimitedResult(fetchImpl);
      if (cache) cache.set(candidate.repo, null);
      continue;
    }
    if (located.subdir == null) {
      if (cache) cache.set(candidate.repo, null);
      continue;
    }
    const out = { ...candidate, subdir: located.subdir };
    if (cache) cache.set(candidate.repo, out);
    results.push(out);
  }
  return { ok: true, results };
}

async function installSkillFromRepo(repo, subdir, gitPath, cliPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musician-skill-'));
  try {
    const cloneUrl = `https://github.com/${repo}.git`;
    let child;
    try {
      child = spawn(gitPath || 'git', buildCloneArgs(cloneUrl, tmp).slice(1), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return { ok: false, code: 'SPAWN_FAILED', error: String((err && err.message) || err) };
    }
    const cloned = await collectChild(child, 120000, 'git clone');
    if (!cloned.ok) return { ok: false, code: cloned.code || 'CLONE_FAILED', error: cloned.error || 'Could not clone the repository.' };
    const dir = resolveInstallDir(tmp, subdir);
    const ran = await runMuseSkills(cliPath, skillsArgs('install', { path: dir }));
    if (!ran.ok) return { ok: false, code: ran.code || 'INSTALL_FAILED', error: ran.error || ran.stderr || 'Skill install failed.' };
    return parseSkillsResult(ran.stdout, 'install skill');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = {
  parseSkillsList,
  parseSkillsResult,
  skillsArgs,
  buildRepoSearchUrl,
  parseRepoSearch,
  skillContentsUrl,
  repoRootUrl,
  skillDirCandidates,
  parseContentsProbe,
  buildCloneArgs,
  resolveInstallDir,
  githubHeaders,
  buildAgentSearchPrompt,
  parseAgentSearchResult,
  shouldRetryAgentSearch,
  fetchRateLimit,
  formatResetClock,
  runMuseSkills,
  searchGithubSkills,
  verifySkillCandidates,
  installSkillFromRepo,
};
