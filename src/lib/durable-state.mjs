// Renderer side of the durable store: seed Web Storage from the file copy at
// boot (missing keys only), and mirror every local write back to the file.
// The api surface is { get(key), set(key, value|null) }; everything here is
// best-effort and never throws, so a dead bridge cannot break the UI.

export async function seedDurableKeys(api, seeds) {
  let seeded = 0;
  let skipped = 0;
  for (const { key, storage } of Array.isArray(seeds) ? seeds : []) {
    try {
      if (storage.getItem(key) != null) {
        skipped += 1;
        continue;
      }
      const r = await api.get(key);
      if (r && r.ok && typeof r.value === 'string') {
        storage.setItem(key, r.value);
        seeded += 1;
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return { seeded, skipped };
}

export function mirrorStoredKey(api, storage, key) {
  let value = null;
  try {
    value = storage.getItem(key);
  } catch {
    value = null;
  }
  try {
    Promise.resolve(api.set(key, value)).catch(() => {});
  } catch {
    /* fire-and-forget */
  }
  return value;
}
