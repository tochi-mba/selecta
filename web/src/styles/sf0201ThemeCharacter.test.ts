import { describe, expect, it } from 'vitest';

/**
 * Flow SF-0201-02 and SF-0201-03, the parts a stylesheet can be checked for: Dark keeps readable
 * contrast and stacks its surfaces lighter as they rise (a shadow can't be seen on near-black), and
 * Light is its own palette, not Dark's colours turned inside out. The specimen reviews in dim and
 * bright rooms are the person's part.
 */
// Same loader as spacing-tokens.test.ts: Vitest hands CSS ?raw imports back empty.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const tokens = fs.readFileSync(`${node.cwd()}/src/styles/tokens.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

type Rgb = [number, number, number];
const PALETTE = ['bg', 'panel', 'panel-2', 'line', 'ink', 'soft', 'accent', 'warn', 'ok', 'request'] as const;

function block(opening: string): string {
  const start = tokens.indexOf(opening);
  expect(start, opening).toBeGreaterThanOrEqual(0);
  const end = tokens.indexOf('}', start);
  return tokens.slice(start, end);
}
function palette(body: string): Record<string, Rgb> {
  const out: Record<string, Rgb> = {};
  for (const name of PALETTE) {
    const hex = body.match(new RegExp(`--${name}:\\s*#([0-9a-f]{6});`, 'i'))?.[1];
    if (hex) out[name] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
  }
  return out;
}
const luminance = ([r, g, b]: Rgb) => {
  const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: Rgb, b: Rgb) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const dark = palette(block(':root {'));
const light = palette(block(":root[data-theme='light'] {"));
const lightBySystem = palette(block(":root:not([data-theme='dark']) {"));

describe('Dark depth for dim rooms (SF-0201-02)', () => {
  it('defines the whole palette', () => {
    expect(Object.keys(dark).sort()).toEqual([...PALETTE].sort());
  });

  it('lifts each surface lighter than the one it rests on', () => {
    expect(luminance(dark.bg)).toBeLessThan(luminance(dark.panel));
    expect(luminance(dark.panel)).toBeLessThan(luminance(dark['panel-2']));
    expect(tokens).toMatch(/--surface-overlay: color-mix\(in srgb, var\(--ink\) 6%, var\(--panel\)\);/);
  });

  it('keeps body text at AAA and quiet text at AA on every Dark surface', () => {
    for (const surface of ['bg', 'panel', 'panel-2'] as const) {
      expect(contrast(dark.ink, dark[surface]), `ink on ${surface}`).toBeGreaterThanOrEqual(7);
      expect(contrast(dark.soft, dark[surface]), `soft on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('never goes to pure black or pure white, which glare in a dark room', () => {
    expect(dark.bg).not.toEqual([0, 0, 0]);
    expect(dark.ink).not.toEqual([255, 255, 255]);
  });
});

describe('Light has its own character (SF-0201-03)', () => {
  it('is the same palette whether chosen by hand or by the system', () => {
    expect(lightBySystem).toEqual(light);
    expect(Object.keys(light).sort()).toEqual([...PALETTE].sort());
  });

  it('is not Dark with its colours inverted', () => {
    for (const name of PALETTE) {
      const inverted = dark[name].map((value) => 255 - value);
      const distance = Math.max(...light[name].map((value, at) => Math.abs(value - inverted[at])));
      expect(distance, `--${name} is Dark inverted`).toBeGreaterThan(8);
    }
  });

  it('chooses its own accent and primary fill instead of reusing Dark lime on paper', () => {
    expect(light.accent).not.toEqual(dark.accent);
    expect(contrast(light.accent, light.bg)).toBeGreaterThanOrEqual(7);
    const own = block(":root[data-theme='light'] {");
    for (const role of ['--primary-fill', '--primary-ink', '--primary-edge', '--shadow-raised', '--shadow-overlay']) {
      expect(own, role).toContain(`${role}:`);
    }
  });

  it('stays warm: the page and panels lean red over blue, like the Dark palette', () => {
    for (const name of ['bg', 'panel', 'panel-2', 'line'] as const) {
      expect(light[name][0], `light ${name}`).toBeGreaterThan(light[name][2]);
      expect(dark[name][0], `dark ${name}`).toBeGreaterThan(dark[name][2]);
    }
  });

  it('keeps body text at AAA and quiet text at AA on every Light surface', () => {
    for (const surface of ['bg', 'panel', 'panel-2'] as const) {
      expect(contrast(light.ink, light[surface]), `ink on ${surface}`).toBeGreaterThanOrEqual(7);
      expect(contrast(light.soft, light[surface]), `soft on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
