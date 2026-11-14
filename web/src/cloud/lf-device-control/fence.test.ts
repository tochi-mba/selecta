import { describe, expect, it } from 'vitest';
import { advanceBrowserFence, browserFenceKey, restoreBrowserFence } from './fence';

function memoryStorage(failWrites = false) {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('Quota or privacy mode');
      map.set(key, value);
    },
    map,
  };
}

describe('durable browser speaker fencing', () => {
  it('restores a persisted generation and advances before a future reload', () => {
    const storage = memoryStorage();
    const key = browserFenceKey('w1', 'venue-zone');
    expect(restoreBrowserFence(storage, key)).toBe(0);
    expect(advanceBrowserFence(storage, key, 0, 17)).toBe(17);
    expect(restoreBrowserFence(storage, key)).toBe(17);
    expect(() => advanceBrowserFence(storage, key, 17, 16)).toThrow('stale');
  });

  it('refuses corrupt or unrepresentable persisted generations instead of silently resetting', () => {
    const storage = memoryStorage();
    const key = browserFenceKey('w1', 'zone');
    storage.setItem(key, 'NaN');
    expect(() => restoreBrowserFence(storage, key)).toThrow('Invalid');
    storage.setItem(key, '999999999999999999999');
    expect(() => restoreBrowserFence(storage, key)).toThrow('Invalid');
    storage.setItem(key, '-1');
    expect(() => restoreBrowserFence(storage, key)).toThrow('Invalid');
  });

  it('fails closed if storage cannot persist registration or a new audible fence', () => {
    const storage = memoryStorage(true);
    const key = browserFenceKey('w1', 'zone');
    expect(() => restoreBrowserFence(storage, key)).toThrow('unavailable');
    expect(() => advanceBrowserFence(storage, key, 1, 2)).toThrow('unavailable');
  });
});
