import { describe, expect, it } from 'vitest';

/**
 * S4-0090-09 and S4-0094-09: when Windows forces its own colours, every rule Selecta writes for that
 * mode speaks only in system colours, so nothing it draws can vanish into the user's palette, and
 * the boundaries that carry meaning (selection, toggles, the current page, disabled controls,
 * statuses and overlay edges) each have a forced-colours rule. The browser half lives in
 * web/e2e/s4-forced-colours.e2e.ts.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const SHEETS = fs.readdirSync(SOURCE, { recursive: true }).map((file) => file.replace(/\\/g, '/')).filter((file) => file.endsWith('.css'));
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/** the body of every `@media (forced-colors: active)` block, with the sheet it came from */
function forcedBlocks(): { sheet: string; body: string }[] {
  const found: { sheet: string; body: string }[] = [];
  for (const sheet of SHEETS) {
    const css = strip(fs.readFileSync(SOURCE + sheet, 'utf8'));
    let at = css.indexOf('forced-colors: active');
    while (at >= 0) {
      const open = css.indexOf('{', at);
      let depth = 0;
      let end = open;
      for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        if (css[i] === '}' && --depth === 0) { end = i; break; }
      }
      found.push({ sheet, body: css.slice(open + 1, end) });
      at = css.indexOf('forced-colors: active', end);
    }
  }
  return found;
}

const SYSTEM = /^(?:Canvas|CanvasText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|ButtonBorder|Field|FieldText|Highlight|HighlightText|SelectedItem|SelectedItemText|Mark|MarkText|GrayText|AccentColor|AccentColorText|transparent|currentColor|currentcolor|none|inherit|initial|unset)$/;
const COLOUR_PROPERTY = /(?:^|-)(?:color|background|background-color|background-image|fill|stroke|outline|border(?:-[a-z-]+)?|box-shadow)$/;
const NOT_COLOUR = /(?:radius|width|style|offset|spacing|collapse)$/;
const KEYWORDS = /\b(?:solid|dashed|dotted|double|inset|none)\b/;

describe('S4-0090-09 / S4-0094-09 forced-colours rules', () => {
  const blocks = forcedBlocks();

  it('there are forced-colours rules in the shared sheets', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(20);
  });

  it('paint only with system colours, never a palette token or a literal colour', () => {
    const strays: string[] = [];
    for (const { sheet, body } of blocks) {
      for (const [, property, value] of body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
        if (!COLOUR_PROPERTY.test(property) || NOT_COLOUR.test(property)) continue;
        if (/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(value)) strays.push(`${sheet} ${property}: ${value}`);
        // a var() here may only be a width such as --marker, never a colour role
        for (const [, token] of value.matchAll(/var\((--[a-z0-9-]+)/g)) {
          if (!/^--(?:marker|separator|space-[a-z0-9]+)$/.test(token)) strays.push(`${sheet} ${property}: ${value}`);
        }
        const words = value.replace(/var\([^)]*\)/g, '').replace(/repeating-linear-gradient|linear-gradient|-?\d+deg|-?[\d.]+(?:px|%|em)?|[(),!]|important/g, ' ').split(/\s+/).filter(Boolean);
        for (const word of words) {
          if (!SYSTEM.test(word) && !KEYWORDS.test(word)) strays.push(`${sheet} ${property}: ${value} (${word})`);
        }
      }
    }
    expect(strays).toEqual([]);
  });

  it('every boundary that carries meaning has a forced-colours rule', () => {
    const all = blocks.map((block) => block.body).join('\n');
    const needed: Record<string, RegExp> = {
      'a selected row': /\.selected\b/,
      'a pressed toggle': /aria-pressed='true'/,
      'a checked choice': /:checked/,
      'the current page or item': /aria-current='(?:page|true)'/,
      'a disabled control': /:disabled|aria-disabled='true'/,
      'a failed status': /failed/,
      'an overlay edge': /\.overlay-panel/,
      'a menu edge': /\.menu-list/,
      'the playing song': /\.playing/,
      'focus': /:focus-visible|outline/,
    };
    const missing = Object.entries(needed).filter(([, pattern]) => !pattern.test(all)).map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('a rule that opts out of forced colours repaints itself in system colours', () => {
    for (const { sheet, body } of blocks) {
      for (const [, selector, rule] of body.matchAll(/([^{}]+)\{([^{}]*forced-color-adjust:\s*none[^{}]*)\}/g)) {
        expect(rule, `${sheet} ${selector.trim()}`).toMatch(/\b(?:CanvasText|ButtonText|Highlight|LinkText|GrayText|Canvas|ButtonFace)\b/);
      }
    }
  });
});
