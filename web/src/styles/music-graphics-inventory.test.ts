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
    expect(now).toMatch(/\[player, active, stage, reduceMotion, theme, paletteRevision, spectrumShape\]/);
    const modes = fs.readFileSync(`${SOURCE}views/spectrumVisuals.ts`, 'utf8');
    expect(modes).toContain('SPECTRUM_MODES');
  });
});
