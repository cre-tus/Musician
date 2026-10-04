import assert from 'node:assert/strict';
import { mirrorStoredKey, seedDurableKeys } from '../src/lib/durable-state.mjs';

function memStore(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

// Seed fills only missing keys; existing values are never clobbered.
{
  const api = { get: async (k) => ({ ok: true, value: `file:${k}` }) };
  const storage = memStore({ keep: 'local' });
  const r = await seedDurableKeys(api, [
    { key: 'keep', storage },
    { key: 'gone', storage },
  ]);
  assert.deepEqual(r, { seeded: 1, skipped: 1 });
  assert.deepEqual(storage.dump(), { keep: 'local', gone: 'file:gone' });
}

// Non-string or failed reads seed nothing and never throw.
{
  const api = { get: async () => ({ ok: false }) };
  const storage = memStore();
  assert.deepEqual(await seedDurableKeys(api, [{ key: 'x', storage }]), { seeded: 0, skipped: 1 });
  const throwing = { get: async () => { throw new Error('ipc down'); } };
  assert.deepEqual(await seedDurableKeys(throwing, [{ key: 'x', storage }]), { seeded: 0, skipped: 1 });
  assert.deepEqual(await seedDurableKeys(null, [{ key: 'x', storage }]), { seeded: 0, skipped: 1 });
  assert.deepEqual(storage.dump(), {});
}

// Mirror forwards the read-back value, including deletions as null.
{
  const calls = [];
  const api = { set: async (k, v) => { calls.push([k, v]); return { ok: true }; } };
  const storage = memStore({ a: '1' });
  assert.equal(mirrorStoredKey(api, storage, 'a'), '1');
  assert.equal(mirrorStoredKey(api, storage, 'missing'), null);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, [['a', '1'], ['missing', null]]);
}

// Mirror never throws, even with a dead bridge.
{
  const storage = memStore({ a: '1' });
  assert.equal(mirrorStoredKey(null, storage, 'a'), '1');
  assert.equal(mirrorStoredKey({ set: async () => { throw new Error('x'); } }, storage, 'a'), '1');
  await new Promise((r) => setTimeout(r, 20));
}

console.log('Durable state checks passed.');
