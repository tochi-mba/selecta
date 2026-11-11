import { describe, expect, it } from 'vitest';

/** UF-0368-01, -02 and -07: the cascade is intentional. docs/engineering/css-ownership.md records
 * the load order with each sheet's owner and every `!important`; tokens.css is the one source of every
 * semantic token and raw colour. The selector-level register is ADR-0278's, checked by
 * css-ownership.test.ts. */

// Vitest hands CSS ?raw imports back empty, so sheets are read from disk (as spacing-tokens.test.ts does).
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const doc = fs.readFileSync(`${SOURCE}../../docs/engineering/css-ownership.md`, 'utf8');
const main = fs.readFileSync(`${SOURCE}main.tsx`, 'utf8');
const SHEETS = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)];
const css = (sheet: string) => fs.readFileSync(`${SOURCE}${sheet}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const section = (title: string) => doc.split(`## ${title}`)[1].split('\n## ')[0];
const rows = (text: string) => text.split('\n').filter((line) => /^\| (\d+|`)/.test(line)).map((line) => line.split('|').map((cell) => cell.trim()));
const name = (cell: string) => cell.replace(/`/g, '');

describe('UF cascade ownership', () => {
  it('main.tsx loads the sheets in the documented order', () => {
    const loaded = [...main.matchAll(/import '\.\/([^']+\.css)';/g)].map((match) => match[1]);
    const documented = rows(section('Load order')).map((cells) => name(cells[2]));
    expect(loaded).toEqual(documented);
  });

  it('every app stylesheet is documented, including the ones a page imports itself', () => {
    for (const sheet of SHEETS) expect(doc, `${sheet} has no owner in css-ownership.md`).toContain(`\`${sheet}\``);
  });

  it('every !important is a listed exception, with its exact count', () => {
    const listed = Object.fromEntries(rows(section('`!important` exceptions')).map((cells) => [name(cells[1]), Number(cells[2])]));
    const found = Object.fromEntries(SHEETS.map((sheet) => [sheet, (css(sheet).match(/!important/g) ?? []).length]).filter(([, count]) => count));
    expect(found).toEqual(listed);
  });

  it('raw colours appear only in tokens.css', () => {
    for (const sheet of SHEETS.filter((sheet) => sheet !== 'styles/tokens.css')) {
      expect(css(sheet).match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g), sheet).toBeNull();
    }
  });

  it('text, surface, focus, selection, status, border, edge and spacing tokens are defined only in tokens.css', () => {
    const role = /(?:^|[;{\s])(--(?:text|surface|focus|selected|selection|status|border|edge|space|danger|playing)[a-z0-9-]*)\s*:/g;
    for (const sheet of SHEETS.filter((sheet) => sheet !== 'styles/tokens.css')) {
      expect([...css(sheet).matchAll(role)].map((match) => match[1]), sheet).toEqual([]);
    }
    const base = css('styles/tokens.css').split(/\n\}/)[0];
    for (const token of ['--text', '--text-soft', '--surface-base', '--surface-raised', '--focus', '--selected', '--border', '--edge-focus', '--space-1', '--status-ready']) {
      expect(base.match(new RegExp(`${token}:`, 'g')), `${token} defined once in the base :root`).toHaveLength(1);
    }
  });
});
