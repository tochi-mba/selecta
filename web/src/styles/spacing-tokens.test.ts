import { describe, expect, it } from 'vitest';

/**
 * MP-0273-01: every margin, padding and gap in the app's own stylesheets is a spacing token
 * role or a documented exception. Raw pixels outside the list below fail here, so a new
 * value has to be named in tokens.css and docs/engineering/spacing-token-map.md first.
 */
// Vitest hands CSS ?raw imports back empty, and the app's tsconfig has no Node types, so the
// sheets are read from disk through Node's own loader. Vitest runs from web/, so paths are taken from there.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const doc = fs.readFileSync(`${SOURCE}../../docs/engineering/spacing-token-map.md`, 'utf8');
const FILES = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css') && name !== 'tokens.css').map((name) => `styles/${name}`)];

/** 0 and a 1px hairline (border compensation) are always allowed. */
const ALWAYS = new Set(['0px', '1px', '-1px']);

/** Documented exceptions: file, selector, property and the raw value, each with a reason. */
const EXCEPTIONS = [
  { file: 'styles/creation.css', selector: '.story-seam', property: 'margin-inline-start', value: '17px', reason: 'centres the seam line under the 36px story number on phones (36 / 2 - 1)' },
  { file: 'styles/lucy.css', selector: '.lucy-msg.is-user article', property: 'margin-left', value: '80px', reason: 'clamp ceiling for the conversation indent, proportional to the viewport' },
  { file: 'styles/lucy.css', selector: '.lucy-msg.is-assistant article', property: 'margin-right', value: '60px', reason: 'clamp ceiling for the conversation indent, proportional to the viewport' },
  { file: 'styles/music-objects.css', selector: '.energy-overview button', property: 'padding', value: '3px', reason: 'musical geometry: the energy bar inset matches --grid-beat-gap so bars read as one grid' },
] as const;

const SPACING = /^(?:(?:margin|padding)(?:-[a-z-]+)?|gap|row-gap|column-gap)$/;

type Use = { file: string; selector: string; property: string; value: string };

/** Every raw px literal in a spacing declaration, with the innermost rule's selector. */
function rawSpacing(file: string, css: string): Use[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const uses: Use[] = [];
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().replace(/\s+/g, ' ');
    for (const declaration of rule[2].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim();
      if (!SPACING.test(property)) continue;
      for (const match of declaration.slice(colon + 1).matchAll(/(?<![\w.])-?\d*\.?\d+px\b/g)) {
        uses.push({ file, selector, property, value: match[0] });
      }
    }
  }
  return uses;
}

const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8');
const all = FILES.flatMap((file) => rawSpacing(file, read(file)));
const exempt = (use: Use) => EXCEPTIONS.some((entry) => entry.file === use.file && use.selector.includes(entry.selector)
  && entry.property === use.property && entry.value === use.value);

describe('spacing tokens (MP-0273-01)', () => {
  it('finds the stylesheets it guards', () => {
    expect(FILES).toContain('style.css');
    expect(FILES).toContain('styles/shell.css');
    expect(FILES.length).toBeGreaterThanOrEqual(10);
  });

  it('flags raw px spacing, so the guard is not vacuous', () => {
    const planted = rawSpacing('x.css', '.a { padding: 7px var(--space-2); gap: 0px; } @media (max-width: 9px) { .b { margin-top: 13px } }');
    expect(planted.map((use) => use.value)).toEqual(['7px', '0px', '13px']);
    expect(planted[2].selector).toBe('.b');
    expect(rawSpacing('x.css', '.a { --row-gap: 5px; scroll-padding-top: 9px; min-height: 30px; }')).toEqual([]);
  });

  it('allows only tokens, a hairline or a documented exception', () => {
    const offenders = all.filter((use) => !ALWAYS.has(use.value) && !exempt(use));
    expect(offenders, offenders.map((use) => `${use.file} ${use.selector} { ${use.property}: ${use.value} }`).join('\n')).toEqual([]);
  });

  it('has no stale exception', () => {
    for (const entry of EXCEPTIONS) {
      expect(all.some((use) => exempt(use) && use.file === entry.file && use.value === entry.value), `${entry.file} ${entry.selector}`).toBe(true);
    }
  });

  it('every spacing token used is defined, and the token map documents it', () => {
    const tokens = read('styles/tokens.css');
    const used = new Set(FILES.flatMap((file) => [...read(file).matchAll(/var\(--((?:space|rhythm|grid|icon|field|list|timeline|control-pad|page-end)[\w-]*)/g)].map((match) => match[1])));
    expect(used.size).toBeGreaterThan(10);
    for (const entry of EXCEPTIONS) expect(doc, `exception ${entry.selector} undocumented`).toContain(entry.selector);
    for (const name of used) {
      expect(tokens, `--${name} missing from tokens.css`).toMatch(new RegExp(`--${name}:`));
      expect(doc, `--${name} missing from the token map`).toContain(`--${name}`);
    }
  });
});

/** MP-0273-08: the musical 1-3px gaps belong to their own grids, and nothing else borrows them. */
const MUSICAL: Record<string, string[]> = {
  '--grid-beat-gap': ['.studio-lane', '.beat-pips', '.seam-visual-bars', '.music-seam-diagram'],
  '--grid-bar-gap': ['.energy-overview ol', '.lucy-energy-bars', '.lucy-seam-strip'],
  '--grid-cell-gap': ['.energy-thumb'],
};

describe('musical exception geometry (MP-0273-08)', () => {
  const uses = FILES.flatMap((file) => {
    const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((rule) =>
      [...rule[2].matchAll(/var\((--grid-[\w-]+)\)/g)].map((match) => ({ file, token: match[1], selector: rule[1].trim() })));
  });

  it('each grid token is used only by the grids that own it', () => {
    for (const use of uses) {
      expect(MUSICAL[use.token], `${use.token} is not a musical token`).toBeDefined();
      expect(MUSICAL[use.token].some((owner) => use.selector.includes(owner)), `${use.file} ${use.selector} borrows ${use.token}`).toBe(true);
    }
  });

  it('every owning grid still draws with its token, and the map lists it', () => {
    for (const [token, owners] of Object.entries(MUSICAL)) {
      for (const owner of owners) {
        expect(uses.some((use) => use.token === token && use.selector.includes(owner)), `${owner} lost ${token}`).toBe(true);
        expect(doc, `${owner} missing from the token map`).toContain(owner);
      }
    }
  });

  it('the tokens stay between 1 and 3px', () => {
    const tokens = read('styles/tokens.css');
    for (const token of Object.keys(MUSICAL)) {
      const value = Number(tokens.match(new RegExp(`${token}:\\s*(\\d+)px`))?.[1]);
      expect(value, token).toBeGreaterThanOrEqual(1);
      expect(value, token).toBeLessThanOrEqual(3);
    }
  });
});
