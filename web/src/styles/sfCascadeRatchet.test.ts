import { describe, expect, it } from 'vitest';

/**
 * SF-0236-04: the CSS consolidation plan in docs/engineering/css-ownership.md ("Consolidation plan")
 * records how many selectors are restated across sheets and how many brittle `!important`s remain.
 * This recounts both from the real sheets and holds them under the ceilings in that table, so
 * consolidation can only move one way. When a step lands, lower the ceiling there.
 */
// Same loader as spacing-tokens.test.ts: Vitest hands CSS ?raw imports back empty.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const doc = fs.readFileSync(`${SOURCE}../../docs/engineering/css-ownership.md`, 'utf8');
const SHEETS = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)];
const SYSTEM_COLOUR = /\b(Canvas|CanvasText|Highlight|HighlightText|ButtonText|ButtonFace|LinkText|GrayText|Mark|MarkText)\b/;

type Rule = { sheet: string; selectors: string[]; declarations: string[] };

function rules(sheet: string): Rule[] {
  const css = fs.readFileSync(SOURCE + sheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Rule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = match[1].trim().replace(/\s+/g, ' ');
    // keyframe steps are not selectors
    if (head.startsWith('@') || /^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(head)) continue;
    found.push({ sheet, selectors: head.split(',').map((part) => part.trim()).filter(Boolean), declarations: match[2].split(';').map((part) => part.trim()).filter(Boolean) });
  }
  return found;
}

const ALL = SHEETS.flatMap(rules);

function ceiling(measure: string): number {
  const start = doc.indexOf('## Consolidation plan (SF-0236-04)');
  expect(start, 'the consolidation plan is in css-ownership.md').toBeGreaterThanOrEqual(0);
  const row = doc.slice(start).split('\n').find((line) => line.startsWith(`| ${measure} |`));
  expect(row, `"${measure}" has a row in the plan`).toBeTruthy();
  const cells = row!.split('|').map((cell) => cell.trim()).filter(Boolean);
  return Number(cells[2]);
}

function restatedSelectors(): Map<string, Set<string>> {
  const where = new Map<string, Set<string>>();
  for (const rule of ALL) {
    for (const selector of rule.selectors) {
      if (!where.has(selector)) where.set(selector, new Set());
      where.get(selector)!.add(rule.sheet);
    }
  }
  return new Map([...where].filter(([, sheets]) => sheets.size > 1));
}

function brittleImportant(): string[] {
  const found: string[] = [];
  for (const rule of ALL) {
    for (const declaration of rule.declarations) {
      if (!declaration.includes('!important')) continue;
      const property = declaration.slice(0, declaration.indexOf(':')).trim();
      const motion = /^(animation|transition|scroll-behavior)/.test(property);
      const hidden = rule.selectors.some((selector) => selector.includes('[hidden]'));
      const forced = SYSTEM_COLOUR.test(declaration);
      if (!motion && !hidden && !forced) found.push(`${rule.sheet} ${rule.selectors.join(', ')} { ${declaration} }`);
    }
  }
  return found;
}

describe('SF-0236-04 CSS consolidation ratchet', () => {
  it('the count is real: a selector restated in two sheets is found', () => {
    const restated = restatedSelectors();
    // a known overlap at the baseline: element defaults restated by the polish layer
    expect([...(restated.get('button') ?? [])]).toEqual(expect.arrayContaining(['style.css', 'styles/polish.css']));
    expect(restated.size).toBeGreaterThan(0);
  });

  it('selectors restated across sheets never rise above the plan’s ceiling', () => {
    const limit = ceiling('Selectors styled in more than one sheet');
    expect(limit).toBeGreaterThan(0);
    expect(restatedSelectors().size).toBeLessThanOrEqual(limit);
  });

  it('brittle !important overrides never rise above the plan’s ceiling', () => {
    const limit = ceiling('`!important` declarations outside motion, `hidden` and forced colours');
    const brittle = brittleImportant();
    expect(brittle.length, brittle.join('\n')).toBeLessThanOrEqual(limit);
  });
});
