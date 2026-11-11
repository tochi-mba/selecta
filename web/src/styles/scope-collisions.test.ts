import { describe, expect, it } from 'vitest';

/** T0023 and T0026: the style audit's scope-collision checks (docs/engineering/css-ownership.md,
 * "Scope collisions"). The Listen hand-off card's `.handoff` classes belong to Listen alone, and no
 * page stylesheet styles a bare class that another page's stylesheet also styles. */

// Vitest hands CSS ?raw imports back empty, so sheets are read from disk (as css-ownership.test.ts does).
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options?: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const css = (sheet: string) => fs.readFileSync(`${SOURCE}${sheet}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const APP_SHEETS = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)];
/** One sheet per area of the app; each is only meant to style its own pages. */
const PAGE_SHEETS = ['styles/listening.css', 'styles/creation.css', 'styles/operations.css', 'styles/lucy.css'];
/** Shared on purpose: `.page` is always compounded with the page's own class (`.page.mix`, `.page.lucy`);
 * `.draft-list` is My Mixes' list, and creation.css only adds the `.long` modifier the editor's long-list
 * rendering needs. */
const SHARED_ON_PURPOSE = new Set(['page', 'draft-list']);

const selectors = (sheet: string) => [...css(sheet).matchAll(/([^{}@;]+)\{/g)].flatMap((match) => match[1].split(',').map((part) => part.trim()));
const subjectClass = (selector: string) => selector.match(/^\.([a-zA-Z][\w-]*)/)?.[1];

const VIEWS = fs.readdirSync(SOURCE, { recursive: true })
  .map((name) => name.replace(/\\/g, '/'))
  .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'));
const classNames = (file: string) => [...fs.readFileSync(`${SOURCE}${file}`, 'utf8').matchAll(/className=(?:"([^"]*)"|\{\s*`([^`]*)`\s*\}|\{\s*'([^']*)'\s*\})/g)]
  .flatMap((match) => (match[1] ?? match[2] ?? match[3]).split(/\s+/));

describe('CSS scope collisions (T0023, T0026)', () => {
  it('only Listen renders the .handoff card classes', () => {
    const users = VIEWS.filter((file) => classNames(file).some((name) => /^handoff(?:-[\w]+)?$/.test(name)));
    expect(users).toEqual(['views/Now.tsx']);
  });

  it('.handoff rules live only in the base layout, Listen and the shared musical objects', () => {
    const owners = APP_SHEETS.filter((sheet) => selectors(sheet).some((selector) => /\.handoff(?![\w-]*-handoff)(?:-[\w-]+)?\b/.test(selector) && !/\.link-handoff/.test(selector)));
    expect(owners.sort()).toEqual(['style.css', 'styles/listening.css', 'styles/music-objects.css'].sort());
  });

  it('no bare class is styled by two page stylesheets', () => {
    const owners = new Map<string, Set<string>>();
    for (const sheet of PAGE_SHEETS) {
      for (const selector of selectors(sheet)) {
        const name = subjectClass(selector);
        if (name) owners.set(name, (owners.get(name) ?? new Set()).add(sheet));
      }
    }
    const shared = [...owners].filter(([name, sheets]) => sheets.size > 1 && !SHARED_ON_PURPOSE.has(name)).map(([name, sheets]) => `${name}: ${[...sheets].join(', ')}`);
    expect(shared).toEqual([]);
  });

  it('page stylesheets never restyle bare elements globally', () => {
    for (const sheet of PAGE_SHEETS) {
      const bare = selectors(sheet).filter((selector) => /^(?:html|body|main|button|input|select|textarea|a|h[1-6]|p|ul|ol|li|section|label)(?:[\s:>[]|$)/.test(selector));
      expect(bare, sheet).toEqual([]);
    }
  });
});
