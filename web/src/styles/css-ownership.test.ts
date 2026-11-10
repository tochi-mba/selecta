import { describe, expect, it } from 'vitest';

/**
 * ADR-278 CSS ownership. docs/adr/completion/css-ownership.md is the register: every stylesheet has a
 * named owner, every sheet that styles one of the seven shared class names is listed against it, every
 * width or height breakpoint has an owning sheet, and CSS changes follow the review rules. These checks
 * read the real files, so the register cannot drift from the source. Bleed between views is measured
 * in the browser by web/e2e/mp-0278-css-ownership.e2e.ts.
 */
// Same loader as spacing-tokens.test.ts: Vitest hands CSS ?raw imports back empty.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8');
const doc = fs.readFileSync(`${SOURCE}../../docs/adr/completion/css-ownership.md`, 'utf8');
const template = fs.readFileSync(`${SOURCE}../../.github/pull_request_template.md`, 'utf8');

const ALL_CSS = fs.readdirSync(SOURCE, { recursive: true }).map((name) => name.replace(/\\/g, '/')).filter((name) => name.endsWith('.css')).sort();
const SHARED = ['style.css', ...ALL_CSS.filter((name) => name.startsWith('styles/'))];
const TOKENS = ['card', 'panel', 'row', 'display', 'count', 'song', 'seam'] as const;

/** The rows of the markdown table under a heading, as arrays of cells. */
function table(heading: string): string[][] {
  const start = doc.indexOf(heading);
  expect(start, `${heading} is in css-ownership.md`).toBeGreaterThanOrEqual(0);
  // the first table after the heading: its consecutive | lines, header and divider dropped
  const lines = doc.slice(start + heading.length).split('\n');
  const first = lines.findIndex((line) => line.startsWith('|'));
  const end = lines.findIndex((line, index) => index > first && !line.startsWith('|'));
  return lines.slice(first + 2, end).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}
const ticked = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

/** Selectors of every style rule, with comments removed and at-rule preludes skipped. */
function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim()).filter((selector) => !selector.startsWith('@'));
}

/** Every (query, file) pair for width and height breakpoints. */
function breakpoints(): string[] {
  const pairs = new Set<string>();
  for (const file of SHARED) {
    for (const match of read(file).matchAll(/@media\s*\(((?:min|max)-(?:width|height):\s*\d+px)\)/g)) pairs.add(`${match[1]} @ ${file}`);
  }
  return [...pairs].sort();
}

describe('stylesheet owners (MP-0278-02)', () => {
  it('every stylesheet in web/src has a named owner and the component that loads it', () => {
    const owned = [...table('## Files and owners'), ...table('Feature-local sheets')].map((row) => ticked(row[0])[0]);
    for (const file of ALL_CSS) expect(owned, `${file} has no owner in css-ownership.md`).toContain(file);
    for (const file of owned) expect(ALL_CSS, `css-ownership.md names ${file}, which is gone`).toContain(file);
    for (const row of [...table('## Files and owners'), ...table('Feature-local sheets')]) {
      expect(row[1].length, `${row[0]} says what it owns`).toBeGreaterThan(10);
      for (const loader of ticked(row[2])) {
        const name = ticked(row[0])[0];
        const relative = loader === 'main.tsx' ? name.replace(/^styles\//, './styles/').replace(/^style\.css$/, './style.css') : name.split('/').pop()!;
        expect(read(loader), `${loader} loads ${name}`).toContain(relative);
      }
    }
  });

  it('the documented load order is the order main.tsx imports the shared sheets', () => {
    const imports = [...read('main.tsx').matchAll(/import '\.\/(.+\.css)';/g)].map((match) => match[1].replace(/^styles\//, '').replace(/\.css$/, ''));
    const sentence = doc.match(/Load order \(`web\/src\/main\.tsx`\): ([\s\S]+?)\. Later/)![1].replace(/\s+/g, ' ');
    const documented = sentence.split(', ').map((name) => name.replace(/\.css$/, ''));
    expect(documented).toEqual(imports);
  });
});

describe('repeated selectors (MP-0278-01)', () => {
  const rows = table('## Repeated selectors (MP-0278-01)');
  for (const token of TOKENS) {
    it(`every sheet that styles .${token} is reported against its base rule`, () => {
      const pattern = new RegExp(`\\.${token}(?![\\w-])`);
      const found = SHARED.filter((file) => selectors(read(file)).some((selector) => pattern.test(selector))).sort();
      const row = rows.find((cells) => ticked(cells[0])[0] === `.${token}`);
      expect(row, `.${token} has a row`).toBeDefined();
      const reported = [...ticked(row![1]).filter((cell) => cell.endsWith('.css')), ...ticked(row![2])].sort();
      expect(reported, `.${token}: sheets in the register vs sheets in the source`).toEqual(found);
      expect(found.length, `.${token} is really repeated`).toBeGreaterThan(1);
      expect(row![3].length, `.${token} has a verdict`).toBeGreaterThan(10);
    });
  }
});

describe('breakpoint precedence (MP-0278-06)', () => {
  it('every width and height breakpoint has an owning sheet, and nothing undocumented is used', () => {
    const documented = table('## Breakpoints (MP-0278-06)').map((row) => `${ticked(row[0])[0]} @ ${ticked(row[1])[0]}`).sort();
    expect(documented).toEqual(breakpoints());
  });

  it('620, 760, 1024 and the short-height rules are among them', () => {
    const found = breakpoints().join('\n');
    for (const query of ['max-width: 620px', 'max-width: 760px', 'min-width: 761px', 'max-width: 1024px', 'max-height: 520px', 'max-height: 420px']) {
      expect(found).toContain(query);
    }
  });

  it('the shell breakpoint is the same number in the tokens and in the shell sheet', () => {
    expect(read('styles/tokens.css')).toMatch(/@media \(max-width: 760px\)/);
    expect(read('styles/shell.css')).toMatch(/@media \(min-width: 761px\)/);
  });
});

describe('review rules (MP-0278-08)', () => {
  it('the pull request template asks for the owning selector, the numeric delta and the visual evidence', () => {
    const section = template.slice(template.indexOf('## CSS changes'));
    expect(template).toContain('## CSS changes');
    for (const column of ['Owning selector', 'Numeric delta', 'Visual evidence']) expect(section).toContain(column);
    expect(section).toContain('css-ownership.md');
  });

  it('the register states the same three rules', () => {
    const rules = doc.slice(doc.indexOf('## Review rules for CSS changes (MP-0278-08)'));
    for (const rule of ['**Owning selector:**', '**Numeric delta:**', '**Visual evidence:**']) expect(rules).toContain(rule);
  });
});
