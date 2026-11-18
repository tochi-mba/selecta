import { describe, expect, it } from 'vitest';
import { readSource } from '../test/sheets';

/**
 * The guest page and the room display load without tokens.css (bundle budgets: guest/budget.ts and
 * rooms.vite.ts), so each keeps a small token block of its own, a recorded exception to the one
 * design system. Every value in those blocks names the tokens.css token it was copied from in a
 * trailing comment; this test resolves that token (following var() chains in tokens.css) and fails
 * the moment the two disagree, so the copy can never drift from the source.
 */
const tokens = readSource('styles/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** A token's first definition in tokens.css (the base :root block, Dark), var() chains followed. */
function resolve(name: string, seen: string[] = []): string | undefined {
  expect(seen, `${name} refers to itself`).not.toContain(name);
  const value = tokens.match(new RegExp(`(?:^|[;{\\s])${name}:\\s*([^;]+);`))?.[1].trim();
  const alias = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
  return alias ? resolve(alias, [...seen, name]) : value;
}

const normal = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

describe.each(['guest/guest.css', 'display/display.css'])('%s mini-palette', (file) => {
  const sheet = readSource(file);
  const copies = [...sheet.matchAll(/^\s*(--[\w-]+):\s*([^;]+);\s*\/\*\s*tokens\.css (--[\w-]+)/gm)]
    .map((match) => ({ name: match[1], value: match[2], source: match[3] }));

  it('copies a real set of tokens, each naming its tokens.css source', () => {
    expect(copies.length).toBeGreaterThan(8);
    // every literal value in a :root block is a copy with a named source; roles may only alias them
    const blocks = [...sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/:root\s*\{([^}]*)\}/g)].map((match) => match[1]);
    const declared = blocks.flatMap((body) => [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => ({ name: match[1], value: match[2].trim() })));
    const unsourced = declared.filter((item) => !/^var\(--[\w-]+\)$/.test(item.value))
      .filter((item) => !copies.some((copy) => copy.name === item.name && normal(copy.value) === normal(item.value)));
    expect(unsourced.map((item) => `${item.name}: ${item.value}`)).toEqual([]);
  });

  it('every copied value equals the tokens.css token it names', () => {
    const drift = copies.filter((copy) => {
      const source = resolve(copy.source);
      return source === undefined || normal(source) !== normal(copy.value);
    }).map((copy) => `${copy.name}: ${copy.value} vs tokens.css ${copy.source}: ${resolve(copy.source) ?? 'missing'}`);
    expect(drift).toEqual([]);
  });

  it('paints through the roles tokens.css names, aliased to the copies', () => {
    for (const role of ['--surface-base', '--focus', '--selected']) expect(sheet, role).toMatch(new RegExp(`${role}: var\\(--`));
    expect(tokens).toMatch(/--surface-base:/);
  });
});
