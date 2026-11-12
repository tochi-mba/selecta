import { describe, expect, it } from 'vitest';

/**
 * SF-0241-05: during a phased rollout there is still one player and one edit model. A redesigned
 * page can't bring its own player or its own copy of the mix: the set player is made once (App.tsx),
 * previews share one element (audio/focus.ts), the Studio's own preview context is the only other
 * audio context, and every mix change goes through api.ts to the server, which owns the revision.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;

const files = fs.readdirSync(SOURCE, { recursive: true })
  .map((name) => name.replace(/\\/g, '/'))
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.startsWith('cloud/'));

const makers = (pattern: RegExp) => files.filter((name) => pattern.test(fs.readFileSync(`${SOURCE}${name}`, 'utf8'))).sort();

describe('one player and one edit model', () => {
  it('the set player is constructed in exactly one place', () => {
    expect(makers(/new SetPlayer\(/)).toEqual(['App.tsx']);
  });

  it('previews share one audio element, and only the player and the Studio open an audio context', () => {
    expect(makers(/new Audio\(/)).toEqual(['audio/focus.ts']);
    expect(makers(/new AudioContext\(/)).toEqual(['player.ts', 'studio.ts']);
  });

  it('no page keeps a second writable copy of the mix: changes are sent to the server through api.ts', () => {
    expect(makers(/fetch\(\s*[`'"]\/api\/mix/)).toEqual([]);
  });
});
