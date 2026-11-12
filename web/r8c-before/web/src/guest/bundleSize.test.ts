import { describe, expect, it } from 'vitest';
import { BundleItem, GUEST_JS_LIMIT, jsBytesFor } from './budget';

const chunk = (fileName: string, code: string, imports: string[] = [], extra: object = {}): BundleItem => ({
  type: 'chunk', fileName, code, imports, dynamicImports: [], isEntry: false, name: fileName, ...extra,
});

// The build (rooms.vite.ts) fails over the limit and writes dist/guest-size.json; the Rooms
// browser test also measures the JavaScript a phone really downloads.
describe('the guest page JavaScript budget (SC-0416-02)', () => {
  it('counts the entry and every chunk it loads, once each, uncompressed', () => {
    const bundle = {
      'guest.js': chunk('guest.js', 'x'.repeat(100), ['dom.js', 'shared.js'], { isEntry: true, name: 'guest' }),
      'dom.js': chunk('dom.js', 'y'.repeat(30), ['shared.js']),
      'shared.js': chunk('shared.js', 'é'.repeat(5)),
      'main.js': chunk('main.js', 'w'.repeat(10_000), ['shared.js'], { isEntry: true, name: 'main' }),
      'guest.css': { type: 'asset', fileName: 'guest.css' },
    } as Record<string, BundleItem>;
    expect(jsBytesFor(bundle, 'guest')).toBe(140);
  });

  it('is 100 KB', () => {
    expect(GUEST_JS_LIMIT).toBe(102_400);
  });
});
