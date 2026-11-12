import { describe, expect, it } from 'vitest';

/**
 * ADR-296 (MP-0296-01, MP-0296-02): every animated surface is listed in
 * docs/engineering/motion-inventory.md, and every duration in the app's stylesheets is a motion
 * token tied to a purpose there, or a listed loop or clock-bound exception.
 */
// Vitest hands CSS ?raw imports back empty, so the sheets are read from disk (as spacing-tokens.test.ts does).
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const doc = fs.readFileSync(`${SOURCE}../../docs/engineering/motion-inventory.md`, 'utf8');
const tokens = fs.readFileSync(`${SOURCE}styles/tokens.css`, 'utf8');
const FILES = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css') && name !== 'tokens.css').map((name) => `styles/${name}`)];
const sheets = FILES.map((file) => ({ file, text: fs.readFileSync(`${SOURCE}${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));

/** Raw durations kept on purpose, each named in the inventory. */
const EXCEPTIONS = new Map([
  ['button-working', '0.9s'],
  ['skeleton-breathe', '1.4s'],
  ['lucy-slide', '1.6s'],
  ['request-pulse', '1.8s'],
  ['pending-flow', '2.4s'],
  ['.handoff-progress i', '70ms'],
]);

const TOKENS = { feedback: 80, fast: 120, reveal: 160, handoff: 200, overlay: 220, slow: 240 } as const;

type Use = { file: string; selector: string; declaration: string };

function declarations(): Use[] {
  const uses: Use[] = [];
  for (const { file, text } of sheets) {
    for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = block[1].trim();
      for (const part of block[2].split(';')) {
        const declaration = part.trim();
        if (/^(transition|animation)(-duration)?\s*:/.test(declaration)) uses.push({ file, selector, declaration });
      }
    }
  }
  return uses;
}

describe('motion tokens', () => {
  it('MP-0296-02 the six tokens keep their documented 80 to 240ms values and purposes', () => {
    for (const [name, ms] of Object.entries(TOKENS)) {
      expect(tokens, `--motion-${name}`).toMatch(new RegExp(`--motion-${name}:\\s*${ms}ms;`));
      const row = doc.split('\n').find((line) => line.startsWith(`| \`--motion-${name}\``));
      expect(row, `--motion-${name} purpose row`).toBeTruthy();
      expect(row!.split('|')[3].trim().length, `--motion-${name} has a purpose`).toBeGreaterThan(20);
    }
    // Still and reduced motion take every token to 0ms
    for (const name of Object.keys(TOKENS)) expect(tokens.match(new RegExp(`--motion-${name}:\\s*0ms;`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('MP-0296-02 every stylesheet duration is a motion token or a listed exception', () => {
    const offenders: string[] = [];
    let tokened = 0;
    for (const use of declarations()) {
      if (/:\s*(none|inherit|initial)\s*(!important)?$/.test(use.declaration)) continue;
      // reduced-motion overrides that zero everything out
      if (/0ms\s*!important/.test(use.declaration)) continue;
      const raw = [...use.declaration.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)].map((match) => match[0]);
      if (!raw.length) { tokened += Number(/var\(--motion-/.test(use.declaration)); continue; }
      const allowed = [...EXCEPTIONS].some(([key, value]) => (use.declaration.includes(key) || use.selector === key) && raw.every((duration) => duration === value));
      if (!allowed) offenders.push(`${use.file} ${use.selector}: ${use.declaration}`);
    }
    expect(offenders).toEqual([]);
    expect(tokened, 'declarations timed by a token').toBeGreaterThan(10);
  });

  it('MP-0296-01 every keyframe animation and every exception is in the motion inventory', () => {
    const names = sheets.flatMap(({ text }) => [...text.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]));
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) expect(doc, `@keyframes ${name}`).toContain(`\`${name}\``);
    for (const [name, value] of EXCEPTIONS) expect(doc, `exception ${name}`).toContain(value);
    for (const surface of ['Buttons', 'Dialog', 'cards', 'Skeleton', 'Drag', 'Spectrum', 'Lyric']) expect(doc, surface).toContain(surface);
  });
});
