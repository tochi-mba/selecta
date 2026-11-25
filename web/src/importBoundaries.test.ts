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
// engine, media and dsp are the browser runtime (ADR-0457/0458/0459): shared by every Cloud
// surface, so they may never reach up into a page or the app shell either.
// feel is the feel system's engines (ADR-0477): used by the shell and by every page, so it may
// never reach up into one. It is a flat folder on purpose: this guard does not read subfolders.
const SHARED = ['ui', 'state', 'audio', 'engine', 'media', 'dsp', 'feel'];

const sources = (folder: string) => fs.readdirSync(`${SOURCE}${folder}/`)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => `${folder}/${name}`);

const importsOf = (file: string) => [...fs.readFileSync(`${SOURCE}${file}`, 'utf8')
  .matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

describe('frontend import direction', () => {
  it('shared ui, state, audio and browser-runtime modules never import a page view or the app shell', () => {
    const offending = SHARED.flatMap(sources).flatMap((file) => importsOf(file)
      .filter((path) => /(^|\/)views\//.test(path) || /\.\.\/(App|RuntimeApp)$/.test(path))
      .map((path) => `${file} -> ${path}`));
    expect(offending).toEqual([]);
  });

  it('only api.ts talks to the local server with fetch; byte streams use its fetchBytes (T0068)', () => {
    // Raw backup, audio and listening-report bytes go through api.ts's fetchBytes, not fetch.
    const direct = [...SHARED, 'views', 'lucy'].flatMap(sources)
      .filter((file) => /\bfetch\(\s*[`'"]\/api\//.test(fs.readFileSync(`${SOURCE}${file}`, 'utf8')));
    expect(direct).toEqual([]);
  });

  it('the guard sees a real import line', () => {
    expect(importsOf('views/Studio.tsx')).toContain('../audio/focus');
  });

  it('views reach the server only through the injected request, never get, post or del (ADR-0462)', () => {
    const offending = sources('views').flatMap((file) => {
      const source = fs.readFileSync(`${SOURCE}${file}`, 'utf8');
      const named = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]\.\.\/api['"]/g)]
        .flatMap((match) => match[1].split(',').map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]))
        .filter((imported) => ['get', 'post', 'del'].includes(imported))
        .map((imported) => `${file}: imports ${imported}`);
      // a namespace import would hide the same call behind api.get(...)
      const namespace = /import\s*\*\s*as\s+\w+\s+from\s*['"]\.\.\/api['"]/.test(source) ? [`${file}: imports the whole local client`] : [];
      return [...named, ...namespace];
    });
    expect(offending).toEqual([]);
  });

  // Modules ADR-0462 lists as mode-specific: they only ever ask this computer's own server, and no
  // Cloud shell mounts what uses them (exports are local jobs; the early Library read runs before
  // the app knows its mode, in a local build only).
  const LOCAL_ONLY = ['views/exportStore.ts', 'views/libraryPrefetch.ts'];

  it('shared views and the shell take bytes and requests from the injected layer, not the local defaults (BF-0462-02)', () => {
    const offending = [...sources('views'), ...sources('shell')].filter((file) => !LOCAL_ONLY.includes(file)).flatMap((file) => {
      const source = fs.readFileSync(`${SOURCE}${file}`, 'utf8');
      const named = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]\.\.\/api['"]/g)]
        .flatMap((match) => match[1].split(',').map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]))
        .filter((imported) => ['get', 'post', 'del', 'request', 'send', 'fetchBytes'].includes(imported))
        .map((imported) => `${file}: imports ${imported}`);
      // clientFor() with nothing passed falls back to the local client silently
      const defaulted = [...source.matchAll(/\b(clientFor)\(\s*\)/g)].map((match) => `${file}: ${match[1]}() with no request`);
      return [...named, ...defaulted];
    });
    expect(offending).toEqual([]);
  });

  it('the local-only list names real modules, so it cannot quietly excuse a renamed view', () => {
    expect(sources('views')).toEqual(expect.arrayContaining(LOCAL_ONLY));
  });

  it('the request guard reads every view, not a hand-kept list', () => {
    expect(sources('views')).toEqual(expect.arrayContaining(['views/Library.tsx', 'views/Drafts.tsx', 'views/libraryPrefetch.ts']));
  });
});
