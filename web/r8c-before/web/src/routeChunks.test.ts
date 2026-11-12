import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = (name: string) => readFileSync(resolve(process.cwd(), 'src', name), 'utf8');

describe('S3-0073-06 route loading boundaries', () => {
  afterEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(window, 'requestIdleCallback');
  });

  it('keeps secondary pages behind dynamic imports while audio remains in the entry bundle', () => {
    const app = source('App.tsx');
    const routes = source('routeChunks.ts');

    expect(app).toContain("from './routeChunks'");
    for (const page of ['Mix', 'MyMixes', 'Links', 'Workshop']) {
      expect(app).not.toContain(`from './views/${page}'`);
      expect(routes).toContain(`import('./views/${page}')`);
    }
    expect(app).toContain("from './player'");
    expect(app).toContain("from './audio/focus'");
    expect(routes).not.toMatch(/import\(['"]\.\/(?:player|audio\/)/);
  });

  it('queues one idle warm-up after the first paint instead of loading pages during render', async () => {
    const queued: Array<() => void> = [];
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: vi.fn((run: () => void) => {
        queued.push(run);
        return 1;
      }),
    });
    const { warmRouteChunks } = await import('./routeChunks');

    warmRouteChunks();
    warmRouteChunks();

    expect(window.requestIdleCallback).toHaveBeenCalledOnce();
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    expect(queued).toHaveLength(1);
  });
});
