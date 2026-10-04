'use strict';
// Pure build-pipeline state rules shared by the worker and the tests.
// The final result is always the plain Musician.exe: no -next names, no
// dated names, and a previous staging file must never pass as this run's.

function isFreshStaged(staged, startedMs) {
  return !!staged && Number(staged.mtimeMs) >= Number(startedMs);
}

function installMatchesStaged(staged, installed) {
  return !!staged && !!installed && Number(staged.bytes) === Number(installed.bytes);
}

function finalTargetAllowed(targetPath) {
  return String(targetPath).split(/[\\/]/).pop() === 'Musician.exe';
}

function buildError(code, message) {
  return { code: String(code), message: String(message) };
}

// State files written before structured errors carry a plain string.
function formatStateError(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err.code) return `${err.code}: ${err.message || ''}`.trimEnd();
  return String((err && err.message) || err);
}

module.exports = { isFreshStaged, installMatchesStaged, finalTargetAllowed, buildError, formatStateError };
