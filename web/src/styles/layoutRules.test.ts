import { describe, expect, it } from 'vitest';
import allowed from './layoutRules.allow.json' with { type: 'json' };

/**
 * The layout rules (docs/engineering/css-ownership.md, "Layout rules"), held by a ratchet in the
 * style of sfCascadeRatchet.test.ts. Two things push a phone page sideways and are caught here:
 * - a bare `1fr` track in a phone query (`1fr` will not shrink below its content's width, so one
 *   long title widens the grid; `minmax(0, 1fr)` will);
 * - a fixed width of 200px or more outside a min-width query (use `min(Npx, 100%)`).
 * The rules that broke them before this test are listed in layoutRules.allow.json. A new one fails;
 * a listed one that is fixed must leave the list, so the list only shrinks.
 * `LAYOUT_RULES_WRITE=1` rewrites the list from the sheets, for the one-time baseline.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; writeFileSync(path: string, text: string): void; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; env: Record<string, string | undefined>; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const SHEETS = fs.readdirSync(SOURCE, { recursive: true }).map((name) => name.replace(/\\/g, '/')).filter((name) => name.endsWith('.css') && !name.startsWith('harness/')).sort();

/** The widest window a phone query is for. */
const PHONE_MAX = 760;
/** The narrowest fixed width that is too wide for a 320px phone once a page has its gutters. */
const TOO_WIDE = 200;

type Declaration = { sheet: string; at: string[]; selector: string; property: string; value: string };

/** Every declaration in a sheet, with the at-rules it sits in, by brace matching. */
export function declarations(sheet: string, css: string): Declaration[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Declaration[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      stack.push(text.slice(start, index).trim().replace(/\s+/g, ' '));
      start = index + 1;
    } else if (char === '}' || char === ';') {
      const body = text.slice(start, index).trim();
      const owner = stack[stack.length - 1];
      if (body && owner && !owner.startsWith('@') && body.includes(':')) {
        const colon = body.indexOf(':');
        found.push({ sheet, at: stack.filter((head) => head.startsWith('@')), selector: owner, property: body.slice(0, colon).trim().toLowerCase(), value: body.slice(colon + 1).trim() });
      }
      if (char === '}') stack.pop();
      start = index + 1;
    }
  }
  return found;
}

const phoneQuery = (at: string[]) => at.some((head) => /^@media/.test(head) && [...head.matchAll(/max-width:\s*(\d+(?:\.\d+)?)px/g)].some((match) => Number(match[1]) <= PHONE_MAX));
const widerQuery = (at: string[]) => at.some((head) => /^@(media|container)/.test(head) && /min-width/.test(head));

/** The value with each function (and `var()`) replaced, innermost first, by what `keep` makes of
 * its name and arguments. */
function unwrap(value: string, keep: (name: string, args: string[]) => string): string {
  let out = value;
  for (let again = true; again;) {
    const next = out.replace(/\b([a-z-]+)\(([^()]*)\)/g, (_all, name: string, args: string) => ` ${keep(name, args.split(','))} `);
    again = next !== out;
    out = next;
  }
  return out;
}

/** The tracks a grid really has on a phone: `minmax()` and friends say how they shrink. */
const bare = (value: string) => unwrap(value, (name, args) => (name === 'repeat' ? args.slice(1).join(' ') : ''));

/** The lengths that do not give way: a `min()` shrinks, a `minmax()` or `clamp()` floor does not. */
const floors = (value: string) => unwrap(value, (name, args) => {
  if (name === 'minmax' || name === 'clamp') return args[0];
  if (name === 'max' || name === 'repeat') return args.join(' ');
  return '';
});

/** A flex item that may not shrink (`flex: 0 0 300px`); one that may is not fixed. */
const rigidFlex = (value: string) => /^\s*\d+(\.\d+)?\s+0\s+/.test(value);

/** What breaks a rule, as `sheet selector { property: value }`. */
export function broken(rules: Declaration[]): string[] {
  const found = new Set<string>();
  for (const rule of rules) {
    const line = `${rule.sheet} ${rule.at.length ? `${rule.at.join(' ')} ` : ''}${rule.selector} { ${rule.property}: ${rule.value} }`;
    if (phoneQuery(rule.at) && /^(grid-template-columns|grid-auto-columns|grid)$/.test(rule.property) && /(^|\s)1fr\b/.test(bare(rule.value))) found.add(`bare 1fr on a phone: ${line}`);
    if (widerQuery(rule.at)) continue;
    const sizing = /^(width|min-width|grid-template-columns|inline-size|min-inline-size)$/.test(rule.property) || (rule.property === 'flex' && rigidFlex(rule.value));
    const wide = [...floors(rule.value).matchAll(/(\d+(?:\.\d+)?)px/g)].some((match) => Number(match[1]) >= TOO_WIDE);
    if (sizing && wide) found.add(`fixed width of ${TOO_WIDE}px or more: ${line}`);
  }
  return [...found].sort();
}

const NOW = broken(SHEETS.flatMap((sheet) => declarations(sheet, fs.readFileSync(SOURCE + sheet, 'utf8'))));

describe('layout rules ratchet', () => {
  it('the scanner sees each rule it is for', () => {
    const sample = declarations('x.css', '.a { width: 240px; } @media (max-width: 640px) { .b { grid-template-columns: 1fr auto; } .c { grid-template-columns: minmax(0, 1fr) auto; } .f { grid-template-columns: repeat(2, 1fr); } } @media (min-width: 900px) { .d { width: 400px; } } .e { width: min(320px, calc(100vw - var(--gap))); flex: 1 1 460px; } .g { grid-template-columns: minmax(420px, 1fr) 1fr; flex: 0 0 300px; }');
    expect(broken(sample)).toEqual([
      'bare 1fr on a phone: x.css @media (max-width: 640px) .b { grid-template-columns: 1fr auto }',
      'bare 1fr on a phone: x.css @media (max-width: 640px) .f { grid-template-columns: repeat(2, 1fr) }',
      'fixed width of 200px or more: x.css .a { width: 240px }',
      'fixed width of 200px or more: x.css .g { flex: 0 0 300px }',
      'fixed width of 200px or more: x.css .g { grid-template-columns: minmax(420px, 1fr) 1fr }',
    ]);
    expect(SHEETS.length).toBeGreaterThan(30);
  });

  if (node.env.LAYOUT_RULES_WRITE === '1') {
    it('writes the baseline', () => { fs.writeFileSync(`${SOURCE}styles/layoutRules.allow.json`, `${JSON.stringify(NOW, null, 2)}\n`); });
    return;
  }

  it('no sheet breaks a layout rule that was not already broken', () => {
    const known = new Set(allowed as string[]);
    expect(NOW.filter((line) => !known.has(line)), 'new layout rule breaks: use minmax(0, 1fr) on phones, and min(Npx, 100%) or a min-width query for wide things').toEqual([]);
  });

  it('a fixed rule leaves the list, so the list only shrinks', () => {
    const now = new Set(NOW);
    expect((allowed as string[]).filter((line) => !now.has(line)), 'fixed: remove these from layoutRules.allow.json').toEqual([]);
  });
});
