import type { SubscriptionUsage } from '../types';
export type UsageCacheStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function saveLastUsage(storage: UsageCacheStorage, usage: SubscriptionUsage, now?: number): void;
export function loadLastUsage(storage: UsageCacheStorage, now?: number): SubscriptionUsage | null;
