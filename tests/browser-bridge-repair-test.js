'use strict';

// Bridge self-heal: repairBridgeFile() rewrites a stale/missing/corrupt
// browser-bridge.json so it points at the live bridge, and leaves a healthy
// file untouched. Uses a prototype stub — no Electron needed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserEngine } = require('../electron/browser');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-repair-'));
const file = path.join(dir, 'browser-bridge.json');
const engine = Object.create(BrowserEngine.prototype);
engine.bridge = {};
engine.bridgeInfo = { port: 51999, token: 'live-token' };
engine.userDataDir = dir;

// Missing file -> repaired.
assert.deepEqual(engine.repairBridgeFile(), { repaired: true, reason: null });
assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { port: 51999, token: 'live-token', pid: process.pid });

// Healthy file -> untouched (mtime preserved).
const mtime = fs.statSync(file).mtimeMs;
assert.deepEqual(engine.repairBridgeFile(), { repaired: false, reason: null });
assert.equal(fs.statSync(file).mtimeMs, mtime);

// Stale file (another instance's bridge) -> repaired.
fs.writeFileSync(file, JSON.stringify({ port: 1111, token: 'other', pid: 99999 }));
assert.deepEqual(engine.repairBridgeFile(), { repaired: true, reason: null });
assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'live-token');

// Corrupt file -> repaired.
fs.writeFileSync(file, '{oops');
assert.deepEqual(engine.repairBridgeFile(), { repaired: true, reason: null });
assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).port, 51999);

// No live bridge -> refuses to invent one.
const dead = Object.create(BrowserEngine.prototype);
dead.bridge = null;
dead.bridgeInfo = null;
dead.userDataDir = dir;
assert.deepEqual(dead.repairBridgeFile(), { repaired: false, reason: 'NO_BRIDGE' });

fs.rmSync(dir, { recursive: true, force: true });
console.log('Browser bridge repair checks passed.');
