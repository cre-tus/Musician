'use strict';
// Claude Code handoff: list/read ~/.claude/projects sessions for a project,
// mirroring the Codex rollout flow. Records keep text in message.content (a
// string or content blocks); agent-*.jsonl files are subagent logs, never
// main sessions.

const fs = require('node:fs');
const path = require('node:path');
const { createProjectPathMatcher } = require('./project-path');

function claudeHome(homeDir) {
  if (process.env.CLAUDE_CONFIG_DIR && String(process.env.CLAUDE_CONFIG_DIR).trim()) {
    return String(process.env.CLAUDE_CONFIG_DIR);
  }
  return path.join(String(homeDir || ''), '.claude');
}

function claudeSessionFiles(dir, out = []) {
  if (out.length >= 2500) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (out.length >= 2500) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) claudeSessionFiles(full, out);
    else if (/\.jsonl$/i.test(entry.name) && !/^agent-.*\.jsonl$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function claudeText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n');
}

function readHeadText(file, maxBytes = 256 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, maxBytes);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function claudeMeta(file) {
  try {
    const base = path.basename(file, '.jsonl');
    let id = null;
    let cwd = null;
    let title = '';
    for (const line of readHeadText(file).split(/\r?\n/)) {
      if (!line) continue;
      let row = null;
      try { row = JSON.parse(line); } catch { continue; }
      if (!row || typeof row !== 'object') continue;
      if (!id && typeof row.sessionId === 'string' && row.sessionId) id = row.sessionId;
      if (!cwd && typeof row.cwd === 'string' && row.cwd) cwd = row.cwd;
      if (!title && row.message && row.message.role === 'user') {
        const text = claudeText(row.message.content).trim().split(/\r?\n/, 1)[0];
        if (text) title = text.slice(0, 80);
      }
      if (id && cwd && title) break;
    }
    if (!cwd) return null;
    return { id: id || base, cwd, title: title || id || base, file };
  } catch { return null; }
}

function projectClaudeSessions(cwd, { homeDir } = {}) {
  if (!cwd) return [];
  const projectPaths = createProjectPathMatcher();
  return claudeSessionFiles(path.join(claudeHome(homeDir), 'projects'))
    .map(claudeMeta)
    .filter((m) => m && projectPaths.sameProjectPath(m.cwd, cwd))
    .map((m) => {
      let updatedAt = '';
      try { updatedAt = fs.statSync(m.file).mtime.toISOString(); } catch { /* ignore */ }
      return { id: m.id, title: m.title, updatedAt, file: m.file };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function readClaudeContext(file) {
  const stat = fs.statSync(file);
  const max = 6 * 1024 * 1024;
  const start = Math.max(0, stat.size - max);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  let raw = buf.toString('utf8');
  if (start > 0) raw = raw.slice(raw.indexOf('\n') + 1);
  const messages = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      const role = row && row.message && row.message.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = claudeText(row.message.content).trim();
      if (text) messages.push({ role, text: text.slice(0, 5000) });
    } catch { /* skip partial or unknown records */ }
  }
  return messages.slice(-12).map((m) => `${m.role === 'user' ? '사용자' : 'Claude'}: ${m.text}`).join('\n\n').slice(-24000);
}

// Scripted follow-up on a prior session: `claude -p --resume <id> <message>`.
function claudeQueueArgs(sessionId, text) {
  return ['-p', '--resume', String(sessionId), String(text)];
}

module.exports = { claudeHome, claudeSessionFiles, claudeMeta, projectClaudeSessions, readClaudeContext, claudeQueueArgs };
