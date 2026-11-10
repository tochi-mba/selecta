import { describe, expect, it } from 'vitest';

/**
 * FP-0264-03/04 (ADR-0264): the edge roles are distinct tokens, light mode sets raw colours only in its
 * palette blocks, and the brand lime appears in light only as a filled shape with dark ink and a dark
 * edge, never as a thin line or the only sign of focus or selection on cream.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const tokens = fs.readFileSync(`${SOURCE}styles/tokens.css`, 'utf8');

/** the custom properties of the first block that starts with `head` */
function block(head: string): Record<string, string> {
  const start = tokens.indexOf(head);
  expect(start, head).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let end = start;
  for (let i = tokens.indexOf('{', start); i < tokens.length; i += 1) {
    if (tokens[i] === '{') depth += 1;
    if (tokens[i] === '}' && --depth === 0) { end = i; break; }
  }
  const body = tokens.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}
const dark = block(':root {');
const light = { ...dark, ...block(":root[data-theme='light']") };

const hex = (value: string): [number, number, number] => {
  const clean = value.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(clean.slice(i, i + 2), 16) / 255) as [number, number, number];
};
/** resolves var() chains and `color-mix(in srgb, A N%, B)` to a hex colour */
function resolve(theme: Record<string, string>, value: string): string {
  const v = value.trim();
  const ref = v.match(/^var\((--[a-z0-9-]+)\)$/);
  if (ref) return resolve(theme, theme[ref[1]]);
  const mix = v.match(/^color-mix\(in srgb, (.+?) (\d+)%, (.+)\)$/);
  if (mix) {
    const a = hex(resolve(theme, mix[1]));
    const b = hex(resolve(theme, mix[3]));
    const t = Number(mix[2]) / 100;
    return `#${a.map((c, i) => Math.round((c * t + b[i] * (1 - t)) * 255).toString(16).padStart(2, '0')).join('')}`;
  }
  expect(v, `unresolvable ${value}`).toMatch(/^#[0-9a-f]{6}$/i);
  return v.toLowerCase();
}
const luminance = (value: string) => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hex(value).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const LIME = '#e8ff3a';

describe('semantic edge roles (FP-0264-03)', () => {
  const ROLES = ['--edge-interactive', '--edge-decorative', '--edge-selected', '--edge-error', '--edge-focus'];

  for (const [name, theme] of [['Dark', dark], ['Light', light]] as const) {
    it(`${name}: interactive, selected, error and focus edges are distinct from decoration and reach 3:1 on every surface`, () => {
      const colours = ROLES.map((role) => resolve(theme, `var(${role})`));
      expect(new Set(colours).size, colours.join(' ')).toBeGreaterThanOrEqual(4);
      expect(resolve(theme, 'var(--edge-interactive)')).not.toBe(resolve(theme, 'var(--edge-decorative)'));
      for (const surface of ['--surface-base', '--surface-raised', '--surface-control']) {
        const behind = resolve(theme, `var(${surface})`);
        for (const role of ['--edge-interactive', '--edge-selected', '--edge-error', '--edge-focus']) {
          expect(contrast(resolve(theme, `var(${role})`), behind), `${name} ${role} on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }

  it('sets raw light-mode colours only in the palette blocks of tokens.css', () => {
    const sheets = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css') && name !== 'tokens.css').map((name) => `styles/${name}`)];
    for (const sheet of sheets) {
      const css = fs.readFileSync(`${SOURCE}${sheet}`, 'utf8');
      for (const match of css.matchAll(/(?:data-theme=['"]light['"]|prefers-color-scheme:\s*light)[^{]*\{([^}]*)\}/g)) {
        expect(match[1], `${sheet} overrides a light colour outside the palette`).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
      }
    }
    // the two light palette blocks are identical, so System-light and chosen Light can't drift apart
    expect(block("@media (prefers-color-scheme: light)")).toEqual(block(":root[data-theme='light']"));
  });
});

describe('the brand lime in Light (FP-0264-04)', () => {
  it('is only ever a filled shape with dark ink and a dark edge', () => {
    expect(resolve(light, 'var(--primary-fill)')).toBe(LIME);
    expect(contrast(resolve(light, 'var(--primary-ink)'), LIME)).toBeGreaterThanOrEqual(7);
    expect(contrast(resolve(light, 'var(--primary-edge)'), resolve(light, 'var(--surface-base)'))).toBeGreaterThanOrEqual(3);
    expect(resolve(light, 'var(--word-fill)')).toBe(LIME);
    expect(contrast(resolve(light, 'var(--word-ink)'), LIME)).toBeGreaterThanOrEqual(7);
  });

  it('never carries focus, selection, playing, a link or an interactive edge on cream', () => {
    for (const role of ['--focus', '--selected', '--playing', '--link', '--edge-interactive', '--edge-selected', '--edge-focus', '--status-working', '--status-action']) {
      const colour = resolve(light, `var(${role})`);
      expect(colour, role).not.toBe(LIME);
      expect(contrast(colour, resolve(light, 'var(--surface-base)')), `${role} on cream`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps Dark depth: lime stays the focus and selection colour there', () => {
    expect(resolve(dark, 'var(--focus)')).toBe(LIME);
    expect(resolve(dark, 'var(--surface-raised)')).not.toBe(resolve(dark, 'var(--surface-base)'));
    expect(resolve(dark, 'var(--surface-control)')).not.toBe(resolve(dark, 'var(--surface-raised)'));
  });
});
