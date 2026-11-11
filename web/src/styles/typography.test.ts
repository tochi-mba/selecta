import { describe, expect, it } from 'vitest';

/**
 * ADR-0275 static checks: the type roles exist and step down, every role a stylesheet asks for is
 * defined, and the numbers that change in place are tabular. Geometry proof lives in
 * web/e2e/mp-0275-typography.e2e.ts.
 */
// Same loader as spacing-tokens.test.ts: Vitest hands CSS ?raw imports back empty.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8');
const FILES = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)];
const tokens = read('styles/tokens.css');

/** The smallest size a role can take, in px: the first length in its font shorthand. */
function floor(role: string) {
  const value = tokens.match(new RegExp(`--type-${role}:\\s*([^;]+);`))?.[1] ?? '';
  const size = value.replace(/^\d{3}\s+/, '').replace(/^clamp\(/, '').replace(/var\(--text-(\w+)\)/, (_, step: string) => tokens.match(new RegExp(`--text-${step}:\\s*([\\d.]+rem)`))![1]);
  const length = size.match(/([\d.]+)(rem|px)/)!;
  return Number(length[1]) * (length[2] === 'rem' ? 16 : 1);
}

describe('type roles (MP-0275-01)', () => {
  it('every role a stylesheet uses is defined in tokens.css', () => {
    const used = new Set(FILES.flatMap((file) => [...read(file).matchAll(/var\(--(type-[\w-]+)\)/g)].map((match) => match[1])));
    expect(used.size).toBeGreaterThan(4);
    for (const name of used) expect(tokens, `--${name} is used but never defined`).toMatch(new RegExp(`--${name}:`));
  });

  it('display, page, section, song, meta and caption step down in size', () => {
    const order = ['display', 'page', 'section', 'song', 'meta', 'caption'].map(floor);
    for (let index = 1; index < order.length; index += 1) expect(order[index], `step ${index}`).toBeLessThan(order[index - 1]);
  });

  it('.display and .display.small take their metrics from the display and page roles', () => {
    const style = read('style.css');
    expect(style).toMatch(/\.display \{\s*font: var\(--type-display\);/);
    expect(style).toMatch(/\.display\.small \{ font: var\(--type-page\);/);
  });
});

describe('focal titles (MP-0275-03)', () => {
  it('the Listen and Stage title fit reads its floor from the --title-floor token', () => {
    expect(tokens).toMatch(/--title-floor:\s*24px;/);
    expect(read('views/Now.tsx')).toContain("getPropertyValue('--title-floor')");
  });
});

describe('stable numbers (MP-0275-05)', () => {
  const sheet = read('styles/typography.css');
  const tabular = sheet.match(/([^{}]+)\{ font-variant-numeric: tabular-nums; \}/)?.[1] ?? '';
  it('time, BPM, percentage and count surfaces are tabular', () => {
    for (const selector of ['.mini-song span', '.song-facts dd', '.library-count', '.editor-scope .status', '.countdown-meta', '.vibe-tempo', '.mix-head .lede']) {
      expect(tabular, selector).toContain(selector);
    }
  });

  it('typography.css loads last, so it owns these rules', () => {
    const imports = [...read('main.tsx').matchAll(/import '\.\/(styles\/[\w-]+\.css|style\.css)';/g)].map((match) => match[1]);
    expect(imports.at(-1)).toBe('styles/typography.css');
  });
});

describe('international names (MP-0275-08)', () => {
  it('Library and editor song names resolve their own direction', () => {
    expect(read('views/LibraryRow.tsx')).toMatch(/<b dir="auto" title=\{title\}>/);
    expect(read('views/LibraryRow.tsx')).toMatch(/<span dir="auto" title=\{song\.artist/);
    expect(read('views/EditorRows.tsx')).toMatch(/<b dir="auto" title=\{item\.title\}>/);
  });

  it('no stylesheet makes CJK or long names unbreakable', () => {
    for (const file of FILES) expect(read(file), file).not.toMatch(/word-break:\s*keep-all/);
  });
});

describe('text-only zoom (MP-0275-07)', () => {
  it('the page text starts from the root size, so the browser text size setting scales it', () => {
    expect(read('style.css')).toMatch(/body \{[^}]*font: var\(--text-md\)\/1\.5 var\(--body\);/);
    // the default look is unchanged: --text-md is 1rem, 16px at the browser's default text size
    expect(tokens).toMatch(/--text-md:\s*1rem;/);
  });

  it('no app stylesheet fixes a font size in px, which text-only zoom could not scale', () => {
    for (const file of FILES) {
      const fixed = [...read(file).matchAll(/(?:^|[;{\s])font(?:-size)?:\s*([^;}]*\d(?:\.\d+)?px[^;}]*)/gm)].map((match) => match[1].trim());
      expect(fixed, file).toEqual([]);
    }
  });
});
