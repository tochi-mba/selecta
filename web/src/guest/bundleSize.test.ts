import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OutputBundle } from 'rollup';
import { describe, expect, it } from 'vitest';
import { GUEST_JS_LIMIT, jsBytesFor } from '../../rooms.vite';

const chunk = (fileName: string, code: string, imports: string[] = [], extra: object = {}) => ({
  type: 'chunk', fileName, code, imports, dynamicImports: [], isEntry: false, name: fileName, ...extra,
});

describe('the guest page JavaScript budget (SC-0416-02)', () => {
  it('counts the entry and every chunk it loads, once each, uncompressed', () => {
    const bundle = {
      'guest.js': chunk('guest.js', 'x'.repeat(100), ['dom.js', 'shared.js'], { isEntry: true, name: 'guest' }),
      'dom.js': chunk('dom.js', 'y'.repeat(30), ['shared.js']),
      'shared.js': chunk('shared.js', 'z'.repeat(5)),
      'main.js': chunk('main.js', 'w'.repeat(10_000), ['shared.js'], { isEntry: true, name: 'main' }),
    } as unknown as OutputBundle;
    expect(jsBytesFor(bundle, 'guest')).toBe(135);
  });

  it('is under 100 KB in the last build', () => {
    const report = resolve(__dirname, '../../dist/guest-size.json');
    // The build itself fails over the limit; this reads its report when a build is present.
    if (!existsSync(report)) return;
    const { guest_js_bytes: bytes } = JSON.parse(readFileSync(report, 'utf8')) as { guest_js_bytes: number };
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(GUEST_JS_LIMIT);
  });
});
