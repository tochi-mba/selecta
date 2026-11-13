import { describe, expect, it } from 'vitest';

/**
 * Flow SF-0202-07, the part a stylesheet can be checked for: running copy (dialog bodies, hints,
 * notes and ledes) reads at a comfortable leading and line length. Only titles, single-line
 * counters and glyph buttons are set tighter. Whether the copy is comfortable to read is the
 * reading study's part.
 */
// Same loader as spacing-tokens.test.ts: Vitest hands CSS ?raw imports back empty.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const FILES = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)];
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = read('styles/tokens.css');

type Rule = { file: string; selector: string; body: string };
const rules: Rule[] = FILES.flatMap((file) => [...read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ file, selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] })));
const declared = (property: string) => rules.flatMap((rule) => [...rule.body.matchAll(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, 'g'))]
  .map((match) => ({ ...rule, value: match[1].trim() })));

/** Selectors that set a single line: a big title, a counter or a glyph inside a button. */
const SINGLE_LINE = /track-title|\.count\b|button\b|\bi\b|term-hint-button|\.display\b/;
const READING = /overlay-body|\.hint\b|note|lede|help|nudge|empty-state|lucy-text|small\b/;

describe('reading rhythm (SF-0202-07)', () => {
  it('sets the page body at 1.5 leading, which every dialog body inherits', () => {
    const body = rules.find((rule) => rule.file === 'style.css' && rule.selector === 'body');
    expect(body?.body).toMatch(/font:\s*var\(--text-md\)\/1\.5 /);
    const overlay = rules.filter((rule) => /\.overlay-body\b/.test(rule.selector));
    expect(overlay.length).toBeGreaterThan(0);
    for (const rule of overlay) expect(rule.body, rule.selector).not.toMatch(/line-height|font:/);
  });

  it('keeps every leading under 1.4 to a title, counter or glyph button', () => {
    const tight = declared('line-height').filter((item) => Number(item.value) < 1.4);
    expect(tight.filter((item) => !SINGLE_LINE.test(item.selector)).map((item) => `${item.file} ${item.selector}: ${item.value}`)).toEqual([]);
    expect(declared('line-height').filter((item) => READING.test(item.selector) && Number(item.value) < 1.4)).toEqual([]);
  });

  it('gives the text roles meant for running words at least 1.4 leading', () => {
    for (const role of ['meta', 'caption']) {
      const leading = Number(tokens.match(new RegExp(`--type-${role}:[^;]*/\\s*([\\d.]+)`))?.[1]);
      expect(leading, role).toBeGreaterThanOrEqual(1.4);
    }
  });

  it('holds running copy to a 45 to 80 character line', () => {
    const measures = declared('max-width').filter((item) => /^\d+ch$/.test(item.value) && READING.test(item.selector));
    expect(measures.length).toBeGreaterThan(4);
    for (const item of measures) {
      const width = Number.parseInt(item.value, 10);
      expect(width, `${item.file} ${item.selector}`).toBeGreaterThanOrEqual(45);
      expect(width, `${item.file} ${item.selector}`).toBeLessThanOrEqual(80);
    }
  });
});
