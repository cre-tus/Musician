export interface DurableStateApi {
  get: (key: string) => Promise<{ ok: boolean; value?: string | null }>;
  set: (key: string, value: string | null) => Promise<unknown>;
}
export interface DurableStateWriter {
  set: (key: string, value: string | null) => Promise<unknown>;
}
export interface DurableSeed {
  key: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
}
export function seedDurableKeys(api: DurableStateApi | null | undefined, seeds: DurableSeed[]): Promise<{ seeded: number; skipped: number }>;
export function mirrorStoredKey(api: DurableStateWriter | null | undefined, storage: Pick<Storage, 'getItem'>, key: string): string | null;
