import { describe, expect, it } from 'vitest';

/**
 * S4-0111-01: the import direction written in docs/adr/completion/architecture.md is enforced, not
 * just described. Shared parts (`ui`, `state`, `audio`) never reach up into page views, so a page
 * can be rebuilt without a hidden second store or a cycle through a shared control.
 */
// Same disk access as styles/spacing-tokens.test.ts: the app's tsconfig has no Node types.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const SHARED = ['ui', 'state', 'audio'];

const sources = (folder: string) => fs.readdirSync(`${SOURCE}${folder}/`)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => `${folder}/${name}`);

const importsOf = (file: string) => [...fs.readFileSync(`${SOURCE}${file}`, 'utf8')
  .matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

describe('frontend import direction', () => {
  it('shared ui, state and audio modules never import a page view or the app shell', () => {
    const offending = SHARED.flatMap(sources).flatMap((file) => importsOf(file)
      .filter((path) => /(^|\/)views\//.test(path) || /\.\.\/(App|RuntimeApp)$/.test(path))
      .map((path) => `${file} -> ${path}`));
    expect(offending).toEqual([]);
  });

  it('only api.ts talks to the local server with fetch, apart from the listed byte streams', () => {
    // LocalBackup uploads and downloads backup archives as raw bytes, which api.ts's JSON helpers don't carry.
    const streams = ['views/LocalBackup.tsx'];
    const direct = [...SHARED, 'views'].flatMap(sources)
      .filter((file) => /\bfetch\(\s*[`'"]\/api\//.test(fs.readFileSync(`${SOURCE}${file}`, 'utf8')));
    expect(direct).toEqual(streams);
  });

  it('the guard sees a real import line', () => {
    expect(importsOf('views/Studio.tsx')).toContain('../audio/focus');
  });
});
