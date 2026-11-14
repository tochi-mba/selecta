import { afterEach, describe, expect, it, vi } from 'vitest';
import { storagePreflight } from './store';

const original = navigator.storage;
afterEach(() => Object.defineProperty(navigator, 'storage', { configurable: true, value: original }));
describe('browser quota admission', () => {
  it('rejects a partial write when staging+copy reserve cannot fit', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: vi.fn().mockResolvedValue({ quota: 10_000_000, usage: 9_000_000 }), persisted: async () => false, getDirectory: async () => { throw new Error('Not needed by quota-only tests'); } },
    });
    await expect(storagePreflight(4_000_000)).rejects.toMatchObject({ state: 'storage_pressure' });
  });
  it('does not discriminate against phones or assume quota is permanent', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: vi.fn().mockResolvedValue({ quota: 200_000_000, usage: 1_000_000 }), persisted: async () => false, getDirectory: async () => { throw new Error('Not needed by quota-only tests'); } },
    });
    const result = await storagePreflight(10_000_000);
    expect(result.available).toBe(199_000_000);
    expect(result.persistent).toBe(false);
  });
  it('reports unknown quota without pretending to know remaining storage', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true, value: { estimate: vi.fn().mockResolvedValue({}), persisted: async () => false, getDirectory: async () => { throw new Error('Not needed by quota-only tests'); } },
    });
    expect((await storagePreflight(4096)).available).toBeNull();
  });
});
