'use strict';
// Safe cleanup for build residue: stale root exes (next/dated names — the
// live result is always the plain Musician.exe) and portable unpack dirs in
// %TEMP%. An unpack dir only matches when it contains BOTH Musician.exe and
// resources/app.asar (never a blind name glob). Refuses to do anything while
// a Musician process runs; unknown process state also refuses.
// CLI: node scripts/dist-clean.js [--dry-run] [--yes]
//   default and --dry-run print the plan; --yes deletes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

function isStaleRootExe(name) {
  const base = String(name).split(/[\\/]/).pop();
  if (base === 'Musician.exe') return false;
  if (base === 'Musician-next.exe') return true;
  return /^Musician-\d{8}T\d{6}Z(-\d+)?\.exe$/.test(base);
}

function defaultExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isStaleUnpackDir(dir, exists = defaultExists) {
  const d = String(dir);
  return exists(path.join(d, 'Musician.exe')) && exists(path.join(d, 'resources', 'app.asar'));
}

function defaultReaddir(d) {
  try {
    return fs.readdirSync(d);
  } catch {
    return [];
  }
}

function planClean({ root, tempDir, readdir = defaultReaddir, exists = defaultExists }) {
  const exes = readdir(root)
    .filter((n) => isStaleRootExe(n))
    .map((n) => path.join(root, n));
  const unpackDirs = readdir(tempDir)
    .map((n) => path.join(tempDir, n))
    .filter((d) => isStaleUnpackDir(d, exists));
  return { exes, unpackDirs };
}

function musicianRunning(run = () => execSync('tasklist /FI "IMAGENAME eq Musician.exe" /FO TABLE', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) {
  let out;
  try {
    out = String(run());
  } catch {
    return true;
  }
  return out.split('\n').some((line) => /^musician\.exe\s+\d+/i.test(line.trim()));
}

function removeTarget(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

async function main(argv) {
  const args = new Set(argv);
  const execute = args.has('--yes');
  if (musicianRunning()) {
    console.error('REFUSED: a Musician process is running (or process state is unknown). Close the app first.');
    process.exitCode = 1;
    return;
  }
  const root = path.join(__dirname, '..');
  const plan = planClean({ root, tempDir: os.tmpdir() });
  const total = plan.exes.length + plan.unpackDirs.length;
  for (const e of plan.exes) console.log(`exe: ${e}`);
  for (const d of plan.unpackDirs) console.log(`unpack: ${d}`);
  if (!execute) {
    console.log(`DRY RUN: ${total} target(s). Re-run with --yes to delete.`);
    return;
  }
  for (const p of [...plan.exes, ...plan.unpackDirs]) removeTarget(p);
  console.log(`CLEANED: ${total} target(s) removed.`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e && e.message ? e.message : e);
    process.exitCode = 1;
  });
}

module.exports = { isStaleRootExe, isStaleUnpackDir, planClean, musicianRunning, removeTarget };
