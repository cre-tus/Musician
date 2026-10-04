'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { formatStateError } = require('./build-checks');

const root = path.resolve(__dirname, '..');
const stateFile = path.join(root, 'build', 'build-status.json');

try {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  console.log(`State: ${state.state}`);
  if (state.reason) console.log(`Reason: ${state.reason}`);
  if (state.pid) console.log(`PID: ${state.pid}`);
  if (state.startedAt) console.log(`Started: ${state.startedAt}`);
  if (state.finishedAt) console.log(`Finished: ${state.finishedAt}`);
  if (state.artifact) console.log(`Artifact: ${state.artifact.path} (${(state.artifact.bytes / 1048576).toFixed(1)} MB)`);
  if (state.error) console.log(`Error: ${formatStateError(state.error)}`);
  if (state.notificationSent === true) console.log('Notification: sent');
  else if (state.notificationSent === false) console.log('Notification: failed (check Windows notification settings)');
  else if (state.notificationSent === null) console.log('Notification: unavailable on this platform');
  if (state.state === 'install-pending') {
    console.log('Next: close the running Musician app, then run npm run dist:install (no rebuild needed).');
  }
  if (state.state === 'failed' || state.state === 'install-pending') process.exitCode = 1;
} catch {
  console.log('No Musician build has been started.');
}
