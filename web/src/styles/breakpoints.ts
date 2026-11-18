/**
 * The canonical width breakpoints (BF overhaul cross-wave contract). A stylesheet writes a width
 * query only with one of these numbers: `(max-width: N)` below it, `(min-width: N+1)` from just
 * above it. Code that has to agree with a stylesheet (useMediaQuery, matchMedia) builds its query
 * with `below()` or `above()` so the two can never disagree by a pixel.
 *
 *   compact  480   a small phone: one column, tightest padding
 *   phone    640   a phone held upright: stacked rows, full-width actions
 *   tablet   768   a tablet held upright or a phone on its side
 *   narrow   900   a narrow laptop window: a side rail folds into a top bar
 *   laptop  1100   a laptop: four-up grids go to two
 *   wide    1400   a wide desktop: the work column stops growing
 *
 * Height queries (short windows, 400% zoom) are not widths and are outside this list.
 */
export const BREAKPOINTS = {
  compact: 480,
  phone: 640,
  tablet: 768,
  narrow: 900,
  laptop: 1100,
  wide: 1400,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** The canonical widths, smallest first. */
export const BREAKPOINT_WIDTHS: readonly number[] = Object.values(BREAKPOINTS);

/** A media query for widths at or below the breakpoint, as the stylesheets write it. */
export function below(name: Breakpoint): string {
  return `(max-width: ${BREAKPOINTS[name]}px)`;
}

/** A media query for widths above the breakpoint, the other side of `below()`. */
export function above(name: Breakpoint): string {
  return `(min-width: ${BREAKPOINTS[name] + 1}px)`;
}

/**
 * Widths still in a stylesheet that are not canonical yet, each with why it waits and where it goes.
 * Every one is either pinned by the MP-0278-06 breakpoint register (docs/adr/completion/css-ownership.md,
 * checked by css-ownership.test.ts) or mirrored by a useMediaQuery in a component, so moving it is a
 * change to that register or component in the same commit, not a stylesheet edit alone.
 */
export const LEGACY_WIDTHS: Readonly<Record<number, { to: number; why: string }>> = {
  360: { to: 480, why: 'shell.css breadcrumb at 320px (SF-0207-05); register row' },
  420: { to: 480, why: 'listening, lucy, polish, shell phone tightening; register rows' },
  520: { to: 480, why: 'style.css, foundation, listening one-column stops; register rows' },
  560: { to: 640, why: 'style.css, polish, shell phone stacks; register rows' },
  599: { to: 640, why: 'business/forms.css, mirrored by ui/DataTable.tsx useMediaQuery' },
  620: { to: 640, why: 'timeline, Library and vibe cards; register rows and e2e at 620' },
  621: { to: 641, why: 'polish.css vibe skeleton band, pairs with 620' },
  760: { to: 768, why: 'the shell: tokens.css and shell.css, mirrored by views/Now.tsx useMediaQuery' },
  761: { to: 769, why: 'the side rail above the shell breakpoint, pairs with 760' },
  767: { to: 768, why: 'business/forms.css, mirrored by business/console/HqConsole.tsx' },
  850: { to: 900, why: 'polish.css Make a Mix paths; register row' },
  1023: { to: 1100, why: 'business/console.css, mirrored by business/console/HqConsole.tsx' },
  1024: { to: 1100, why: 'Library and timeline fold; register rows and e2e at 1024' },
  1040: { to: 1100, why: 'vibe cards and Listen side column; register rows' },
};
