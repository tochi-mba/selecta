import { describe, expect, it } from 'vitest';
import { ALL_SHEETS, appSource, readSheet, readSource } from '../test/sheets';
import { above, below, BREAKPOINT_WIDTHS, BREAKPOINTS, LEGACY_WIDTHS } from './breakpoints';

/**
 * BF overhaul cross-wave contract: one set of width breakpoints, defined in breakpoints.ts. A sheet
 * (any `.css` under web/src) or a component's media query writes a width only as a canonical
 * breakpoint (`max-width: N`, `min-width: N+1`) or as one of the named LEGACY_WIDTHS, each of which
 * says why it has not moved yet. Height queries (short windows, 400% zoom) are not widths.
 */
const LEGACY = Object.keys(LEGACY_WIDTHS).map(Number);

/** Whether a width in a query is allowed: `max` takes N, `min` takes N+1 (the other side of N). */
function allowed(side: 'min' | 'max', width: number) {
  if (LEGACY.includes(width)) return true;
  return side === 'max' ? BREAKPOINT_WIDTHS.includes(width) : BREAKPOINT_WIDTHS.includes(width - 1);
}

/** Every width written in a media query in the text, with its side. */
function widths(text: string) {
  const out: Array<{ side: 'min' | 'max'; width: number; unit: string }> = [];
  for (const query of text.matchAll(/@media([^{]*)\{/g)) {
    for (const match of query[1].matchAll(/\((min|max)-width:\s*([\d.]+)(px|em|rem)\)/g)) out.push({ side: match[1] as 'min' | 'max', width: Number(match[2]), unit: match[3] });
  }
  return out;
}

describe('canonical breakpoints (BF overhaul)', () => {
  it('are the six contract widths, smallest first, and below/above meet without a gap', () => {
    expect(BREAKPOINT_WIDTHS).toEqual([480, 640, 768, 900, 1100, 1400]);
    for (const name of Object.keys(BREAKPOINTS) as Array<keyof typeof BREAKPOINTS>) {
      expect(below(name)).toBe(`(max-width: ${BREAKPOINTS[name]}px)`);
      expect(above(name)).toBe(`(min-width: ${BREAKPOINTS[name] + 1}px)`);
    }
  });

  it('every legacy width says where it goes and why it waits, and none is already canonical', () => {
    expect(LEGACY.length).toBeGreaterThan(0);
    for (const width of LEGACY) {
      const entry = LEGACY_WIDTHS[width];
      expect(BREAKPOINT_WIDTHS, `${width} is canonical, so it is not legacy`).not.toContain(width);
      expect(BREAKPOINT_WIDTHS.includes(entry.to) || BREAKPOINT_WIDTHS.includes(entry.to - 1), `${width} moves to ${entry.to}`).toBe(true);
      expect(entry.why.length, `${width} says why`).toBeGreaterThan(15);
    }
  });

  it('every stylesheet writes widths only in px from the canonical set or a named legacy width', () => {
    const off: string[] = [];
    for (const file of ALL_SHEETS) {
      for (const item of widths(readSheet(file))) {
        if (item.unit !== 'px' || !allowed(item.side, item.width)) off.push(`${file}: ${item.side}-width: ${item.width}${item.unit}`);
      }
    }
    expect(off).toEqual([]);
  });

  it('every legacy width is still in use, so the list cannot outlive its migration', () => {
    const used = new Set<number>();
    for (const file of ALL_SHEETS) for (const item of widths(readSheet(file))) used.add(item.width);
    for (const file of appSource(/\.tsx?$/)) for (const match of readSource(file).matchAll(/\((?:min|max)-width:\s*(\d+)px\)/g)) used.add(Number(match[1]));
    expect(LEGACY.filter((width) => !used.has(width))).toEqual([]);
  });

  it('a component media query uses below()/above(), or a named legacy width it mirrors from a sheet', () => {
    const off: string[] = [];
    for (const file of appSource(/\.tsx?$/).filter((name) => name !== 'styles/breakpoints.ts')) {
      for (const match of readSource(file).matchAll(/\((min|max)-width:\s*(\d+)px\)/g)) {
        const width = Number(match[2]);
        // a canonical width in code is written with below()/above(), never retyped
        if (!LEGACY.includes(width) && !(match[1] === 'min' && LEGACY.includes(width - 1))) off.push(`${file}: ${match[0]}`);
      }
    }
    expect(off).toEqual([]);
  });
});
