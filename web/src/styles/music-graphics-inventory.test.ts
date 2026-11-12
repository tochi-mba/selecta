import { describe, expect, it } from 'vitest';

/**
 * FP-0266-01/03: docs/engineering/music-graphics-inventory.md lists every musical graphic state. This keeps
 * it true: each row's source file exists and draws that mark, each CSS rule exists, and every colour in it
 * is a theme token or a forced-colours system colour, so a theme change always repaints it.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; existsSync(path: string): boolean };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const doc = fs.readFileSync(`${SOURCE}../../docs/engineering/music-graphics-inventory.md`, 'utf8');
const rows = doc.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Graphic') && !line.startsWith('|---'))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
const code = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
const squash = (text: string) => text.replace(/\s+/g, ' ');

/** the class or marker each source file must use to draw the row's mark */
const marker = (selector: string) => selector.match(/\.([a-z][a-z-]*)/)?.[1] ?? selector;

describe('music graphics inventory (FP-0266-01)', () => {
  it('covers playhead, seek, countdown, spectrum, seam, energy and Studio states', () => {
    expect(rows.length).toBeGreaterThanOrEqual(25);
    const graphics = new Set(rows.map(([graphic]) => graphic));
    for (const name of ['Waveform playhead', 'Seek marker', 'Transition countdown', 'Live spectrum (15 styles)', 'Seam diagram', 'Energy overview', 'Studio cell', 'Studio lane']) {
      expect(graphics.has(name), name).toBe(true);
    }
  });

  for (const [graphic, state, sourceCell, ruleCell] of rows) {
    it(`${graphic}, ${state}: source and rule exist, colours are tokens`, () => {
      const [selector, file] = code(ruleCell);
      const css = squash(fs.readFileSync(`${SOURCE}${file}`, 'utf8'));
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const blocks = [...css.matchAll(new RegExp(`(?:^|[}\\s])${escaped} \\{([^}]*)\\}`, 'g'))].map((match) => match[1]);
      expect(blocks.length, `${selector} in ${file}`).toBeGreaterThan(0);
      for (const block of blocks) expect(block, `${selector} holds a raw colour`).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
      const sources = code(sourceCell);
      expect(sources.length).toBeGreaterThan(0);
      const drawn = sources.map((source) => fs.readFileSync(`${SOURCE}${source}`, 'utf8')).join('\n');
      if (graphic !== 'Live spectrum (15 styles)') expect(drawn, `${marker(selector)} drawn in ${sources}`).toContain(marker(selector));
    });
  }

  it('reads the spectrum colours from the live theme, and repaints on a theme change', () => {
    const now = fs.readFileSync(`${SOURCE}views/Now.tsx`, 'utf8');
    expect(now).toContain("getPropertyValue('--accent')");
    expect(now).toMatch(/\[player, active, stage, reduceMotion, theme, paletteRevision, spectrumShape, detail\]/);
    const modes = fs.readFileSync(`${SOURCE}views/spectrumVisuals.ts`, 'utf8');
    expect(modes).toContain('SPECTRUM_MODES');
  });
});

/**
 * FP-0266-03: every meaningful musical mark reads against the surfaces it is drawn on, in Light and in
 * Dark. Contrast is computed from luminance alone, so a pass here is also a pass in grayscale; the
 * inventory's "Without colour" column carries the shape or words for anyone who can't see hue at all.
 */
describe('theme-pair mark readability (FP-0266-03)', () => {
  const tokens = fs.readFileSync(`${SOURCE}styles/tokens.css`, 'utf8');
  const block = (head: string): Record<string, string> => {
    const start = tokens.indexOf(head);
    let depth = 0;
    let end = start;
    for (let i = tokens.indexOf('{', start); i < tokens.length; i += 1) {
      if (tokens[i] === '{') depth += 1;
      if (tokens[i] === '}' && --depth === 0) { end = i; break; }
    }
    const body = tokens.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
    return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
  };
  const dark = block(':root {');
  const light = { ...dark, ...block(":root[data-theme='light']") };
  const channels = (value: string) => [0, 2, 4].map((i) => Number.parseInt(value.slice(1 + i, 3 + i), 16) / 255);
  const resolve = (theme: Record<string, string>, value: string): string => {
    const v = value.trim();
    const ref = v.match(/^var\((--[a-z0-9-]+)\)$/);
    if (ref) return resolve(theme, theme[ref[1]]);
    const mix = v.match(/^color-mix\(in srgb, (.+?) (\d+)%, (.+)\)$/);
    if (mix) {
      const a = channels(resolve(theme, mix[1]));
      const b = channels(resolve(theme, mix[3]));
      const t = Number(mix[2]) / 100;
      return `#${a.map((c, i) => Math.round((c * t + b[i] * (1 - t)) * 255).toString(16).padStart(2, '0')).join('')}`;
    }
    expect(v, `unresolvable ${value}`).toMatch(/^#[0-9a-f]{6}$/i);
    return v.toLowerCase();
  };
  const luminance = (value: string) => {
    const [r, g, b] = channels(value).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** the colour tokens that carry a musical state in the inventory, and what each one marks */
  const MARKS: Record<string, string> = {
    '--ink': 'playhead, played waveform, Studio cell on',
    '--focus': 'seek marker, Studio keyboard focus',
    '--playing': 'seam on the waveform, countdown, Studio playing cell',
    '--selected': 'chosen energy song, wanted route song, soloed lane',
    '--status-ready': 'rendered seam edge, measured energy bar',
    '--status-planned': 'queued seam edge',
    '--status-working': 'rendering seam edge',
    '--status-failed': 'failed seam edge',
  };
  const doc = fs.readFileSync(`${SOURCE}../../docs/engineering/music-graphics-inventory.md`, 'utf8');

  it('names only marks the inventory actually uses', () => {
    for (const token of Object.keys(MARKS)) expect(doc, token).toContain(`\`${token}\``);
  });

  for (const [name, theme] of [['Light', light], ['Dark', dark]] as const) {
    for (const [token, marks] of Object.entries(MARKS)) {
      it(`${name}: ${token} (${marks}) reaches 3:1 on the page and on raised panels`, () => {
        for (const surface of ['--surface-base', '--surface-raised']) {
          const ratio = contrast(resolve(theme, `var(${token})`), resolve(theme, `var(${surface})`));
          expect(ratio, `${name} ${token} on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});
