import { describe, expect, it } from 'vitest';

/**
 * FP-0270-01/02: docs/engineering/layer-precedence.md is the inventory of every fixed and sticky layer
 * and the table of what yields when they meet. This keeps it true: every inventory row's selector must
 * use the stacking token it names, the tokens must keep their order, and every CSS rule the precedence
 * table cites must still be in the stylesheets.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const doc = fs.readFileSync(`${SOURCE}../../docs/engineering/layer-precedence.md`, 'utf8');
const sheet = (name: string) => fs.readFileSync(`${SOURCE}styles/${name}`, 'utf8');
const squash = (text: string) => text.replace(/\s+/g, ' ');
const allCss = squash([...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map(sheet), fs.readFileSync(`${SOURCE}style.css`, 'utf8')].join('\n'));

const section = (heading: string) => {
  const start = doc.indexOf(`## ${heading}`);
  const end = doc.indexOf('\n## ', start + 3);
  return doc.slice(start, end < 0 ? undefined : end);
};
const rows = (text: string) => text.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Layer') && !line.startsWith('| Situation') && !line.startsWith('|---'))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
const code = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

const ORDER = ['--layer-sticky', '--layer-header', '--layer-nav', '--layer-player', '--layer-sheet', '--layer-dialog', '--layer-toast'];

describe('layer inventory (FP-0270-01)', () => {
  it('keeps the stacking tokens in their documented order', () => {
    const tokens = sheet('tokens.css');
    const values = ORDER.map((name) => Number(tokens.match(new RegExp(`${name}:\\s*(\\d+);`))?.[1]));
    expect(values.every(Number.isFinite)).toBe(true);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
    expect(code(section('Stacking tokens, lowest first'))).toEqual(ORDER);
  });

  const inventory = rows(section('Layer inventory'));
  it('lists every layer', () => expect(inventory.length).toBeGreaterThanOrEqual(14));

  for (const [layer, selectorCell, fileCell, tokenCell] of inventory) {
    it(`${layer} uses ${tokenCell}`, () => {
      const [selector] = code(selectorCell);
      const [file] = code(fileCell);
      const [token] = code(tokenCell);
      const css = sheet(file);
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const blocks = [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => squash(match[1]));
      expect(blocks.length, `${selector} in ${file}`).toBeGreaterThan(0);
      expect(blocks.some((block) => block.includes(`z-index: var(${token})`)), `${selector} z-index ${token}`).toBe(true);
    });
  }

  it('has no raw stacking number on a shell-level fixed layer', () => {
    for (const file of ['shell.css', 'foundation.css']) {
      for (const match of sheet(file).matchAll(/position:\s*fixed;[^}]*?z-index:\s*([^;]+);/g)) {
        expect(match[1].trim(), file).toMatch(/^var\(--layer-/);
      }
    }
  });
});

describe('precedence table (FP-0270-02)', () => {
  const table = rows(section('Precedence when layers meet'));
  it('covers keyboard, Stage, dialog, toast, short landscape and menus', () => {
    const situations = table.map(([situation]) => situation.toLowerCase()).join(' ');
    for (const word of ['keyboard', 'stage', 'dialog', 'notices', 'short landscape', 'menu']) expect(situations).toContain(word);
  });

  for (const [situation, , , madeSo] of table) {
    it(`${situation}: the cited CSS is in the stylesheets`, () => {
      const rules = code(madeSo).filter((snippet) => snippet.includes('{') || snippet.includes('var('));
      for (const rule of rules) expect(allCss, rule).toContain(squash(rule));
    });
  }

  it('keeps a notice under any dialog, so consent is never covered', () => {
    const z = (selector: string) => squash(sheet('shell.css')).match(new RegExp(`(?:^| )\\${selector} \\{[^}]*z-index: var\\((--layer-[a-z]+)\\)`))?.[1];
    expect(ORDER.indexOf(z('.toasts')!)).toBeLessThan(ORDER.indexOf(z('.overlay')!));
    expect(ORDER.indexOf(z('.mini')!)).toBeLessThan(ORDER.indexOf(z('.toasts')!));
    expect(ORDER.indexOf(z('.nav')!)).toBeLessThan(ORDER.indexOf(z('.mini')!));
  });
});
