import { describe, expect, it } from 'vitest';

// Same disk access as importBoundaries.test.ts: the app's tsconfig has no Node types.
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const inventory = fs.readFileSync(`${node.cwd()}/../docs/adr/selecta-3-api.md`, 'utf8');

/**
 * ADR-0071 (S3-0071-01): docs/adr/selecta-3-api.md lists every call the local app makes. A page that
 * starts calling a new address without adding it there fails here, so the inventory can't fall behind.
 * Cloud, admin and Lucy have their own clients and contracts and are left to their own ADRs.
 */

const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}', '!./cloud/**', '!./admin/**', '!./lucy/**', '!./guest/**', '!./rooms/**', '!./devices/**'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const CALL = /\b(?:get|post|del|send)(?:<[^>]*>)?\(\s*[`'](\/[a-z_-]+(?:\/[a-z_-]+)?)/g;

function called(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(CALL)) found.set(match[1], [...(found.get(match[1]) ?? []), file]);
  }
  return found;
}

describe('S3-0071-01 the API inventory names every call the local app makes', () => {
  it('finds the calls it is checking', () => {
    expect(called().size).toBeGreaterThan(20);
  });

  it('every address a local page calls is in docs/adr/selecta-3-api.md', () => {
    const named = (path: string) => new RegExp(`[\\s\`]${path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![a-z_-])`).test(inventory);
    const missing = [...called().entries()].filter(([path]) => !named(path)).map(([path, files]) => `${path} (${files.join(', ')})`);
    expect(missing).toEqual([]);
  });
});
