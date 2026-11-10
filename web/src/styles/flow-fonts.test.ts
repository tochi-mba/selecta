import { describe, expect, it } from 'vitest';

/**
 * Flow SF-0202-06: type costs nothing to load and looks the same offline. Every family is an
 * installed-system stack ending in a generic family; no web font file is downloaded or bundled.
 */
// Same loader as spacing-tokens.test.ts: Vitest hands CSS ?raw imports back empty.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const CSS = fs.readdirSync(SOURCE, { recursive: true }).map((name) => name.replace(/\\/g, '/')).filter((name) => name.endsWith('.css'));
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8');
const GENERIC = /(?:^|,)\s*(?:system-ui|sans-serif|serif|monospace|ui-monospace|ui-sans-serif|ui-serif|inherit)\s*$/;

describe('fonts (SF-0202-06)', () => {
  it('no stylesheet or page loads a web font', () => {
    for (const file of CSS) {
      const text = read(file);
      expect(text, file).not.toMatch(/@font-face|fonts\.googleapis|\.woff2?\b|\.ttf\b|\.otf\b/);
    }
    expect(fs.readFileSync(`${SOURCE}../index.html`, 'utf8')).not.toMatch(/fonts\.(googleapis|gstatic)|\.woff2?\b/);
  });

  it('every font family token falls back to a generic family', () => {
    const tokens = read('styles/tokens.css');
    const families = [...tokens.matchAll(/--(?:font|display|mono|body|sans|serif)[\w-]*:\s*([^;]+);/g)].map((match) => match[1].trim()).filter((value) => !value.startsWith('var('));
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) expect(family).toMatch(GENERIC);
  });
});
