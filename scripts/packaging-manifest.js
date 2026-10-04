'use strict';

// Static packaging check: every relative require() inside packaged JS must
// resolve to a file on disk AND be covered by package.json build.files, so a
// missing entry (like the old scripts/windows-toast.js omission) fails tests
// instead of failing at runtime in the packaged app.

const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const PACKAGED_SCAN_DIRS = ['electron', 'browser-mcp'];
const PACKAGED_SCAN_FILES = ['scripts/windows-toast.js'];

function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += next || ''; i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i += 1; continue; }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function collectRequires(source) {
  const found = [];
  const clean = stripComments(source);
  let m;
  const reqRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reqRe.exec(clean)) !== null) found.push(m[1]);
  const importRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = importRe.exec(clean)) !== null) found.push(m[1]);
  return found;
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* try next */ }
  }
  return null;
}

function patternCovers(pattern, relPosix) {
  if (pattern.endsWith('/**/*')) {
    const prefix = pattern.slice(0, -'/**/*'.length);
    return relPosix === prefix || relPosix.startsWith(`${prefix}/`);
  }
  return pattern === relPosix;
}

function coveredByFiles(patterns, absPath, root) {
  const rel = path.relative(root, absPath).split(path.sep).join('/');
  return patterns.some((pattern) => patternCovers(pattern, rel));
}

function packageNameOf(spec) {
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return spec.split('/')[0];
}

function listJsFiles(dir) {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) entries.push(...listJsFiles(full));
    else if (name.endsWith('.js')) entries.push(full);
  }
  return entries;
}

function checkPackagingManifest(root) {
  const resolvedRoot = path.resolve(root);
  const violations = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(resolvedRoot, 'package.json'), 'utf8'));
  const patterns = (pkg.build && pkg.build.files) || [];

  const scanFiles = [];
  for (const dir of PACKAGED_SCAN_DIRS) {
    const abs = path.join(resolvedRoot, dir);
    if (fs.existsSync(abs)) scanFiles.push(...listJsFiles(abs));
  }
  for (const file of PACKAGED_SCAN_FILES) {
    const abs = path.join(resolvedRoot, file);
    if (fs.existsSync(abs)) scanFiles.push(abs);
  }
  if (scanFiles.length === 0) violations.push('no packaged JS files found to scan');

  for (const file of scanFiles) {
    const rel = path.relative(resolvedRoot, file).split(path.sep).join('/');
    if (!coveredByFiles(patterns, file, resolvedRoot)) {
      violations.push(`${rel}: packaged file itself is not covered by build.files`);
    }
    const source = fs.readFileSync(file, 'utf8');
    for (const spec of collectRequires(source)) {
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (!target) {
          violations.push(`${rel}: require('${spec}') does not resolve to a file`);
          continue;
        }
        if (!coveredByFiles(patterns, target, resolvedRoot)) {
          const targetRel = path.relative(resolvedRoot, target).split(path.sep).join('/');
          violations.push(`${rel}: require('${spec}') -> ${targetRel} is not covered by build.files`);
        }
        continue;
      }
      if (spec === 'electron' || spec.startsWith('node:') || builtinModules.includes(spec)) continue;
      const name = packageNameOf(spec);
      if (!name) {
        violations.push(`${rel}: require('${spec}') has an unparsable package name`);
        continue;
      }
      const manifest = path.join(resolvedRoot, 'node_modules', ...name.split('/'), 'package.json');
      if (!fs.existsSync(manifest)) {
        violations.push(`${rel}: require('${spec}') package ${name} is not installed`);
        continue;
      }
      const probe = path.join(resolvedRoot, 'node_modules', ...name.split('/'), 'package.json');
      if (!coveredByFiles(patterns, probe, resolvedRoot)) {
        violations.push(`${rel}: require('${spec}') package ${name} is not covered by build.files node_modules entries`);
      }
    }
  }

  for (const resource of ((pkg.build && pkg.build.extraResources) || [])) {
    const from = path.join(resolvedRoot, resource.from || '');
    for (const filter of (resource.filter || [])) {
      if (!fs.existsSync(path.join(from, filter))) {
        violations.push(`extraResources ${resource.from} -> ${resource.to}: missing ${filter}`);
      }
    }
  }
  return violations;
}

module.exports = { checkPackagingManifest };
