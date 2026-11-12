import { describe, expect, it } from 'vitest';

/**
 * SF-0243-07 static guards: what a stylesheet can show about stylus and finger targets without a
 * device. A real stylus and touch-screen check is still a person's job (see the Flow checklist).
 */
// Read from disk through Node's own loader, as optical-alignment.test.ts does.
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const FILES = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)];
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The inside of every `@media` block whose query matches, with the file it came from. */
function mediaBlocks(query: RegExp) {
  const found: { file: string; body: string }[] = [];
  for (const file of FILES) {
    const css = read(file);
    for (const match of css.matchAll(/@media([^{]*)\{/g)) {
      if (!query.test(match[1])) continue;
      let depth = 1;
      let at = (match.index ?? 0) + match[0].length;
      const start = at;
      while (depth > 0 && at < css.length) {
        if (css[at] === '{') depth += 1;
        else if (css[at] === '}') depth -= 1;
        at += 1;
      }
      found.push({ file, body: css.slice(start, at - 1) });
    }
  }
  return found;
}
const rulesIn = (body: string) => [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] }));
const allRules = FILES.flatMap((file) => rulesIn(read(file)).map((rule) => ({ file, ...rule })));
const px = (value: string) => {
  const exact = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (exact) return Number(exact[1]);
  // --control-height is 44px for every coarse pointer, compact density included (tokens.css)
  return /^var\(--control-height\)$/.test(value.trim()) ? 44 : NaN;
};
// An inline term hint sits inside a sentence, so WCAG 2.2's inline exception applies; it still clears 24px.
const INLINE = new Set(['.term-hint-button']);

describe('SF-0243-07 stylus and coarse pointers', () => {
  const coarse = mediaBlocks(/pointer:\s*coarse/);

  it('every coarse-pointer target is at least 44px, and an inline term hint at least 24px', () => {
    expect(coarse.length).toBeGreaterThan(3);
    const sizes = coarse.flatMap(({ file, body }) => rulesIn(body).flatMap((rule) =>
      [...rule.body.matchAll(/(?:^|;|\s)(min-height|min-width)\s*:\s*([^;]+)/g)]
        .map((declaration) => ({ file, selector: rule.selector, property: declaration[1], size: px(declaration[2]) }))));
    expect(sizes.length).toBeGreaterThan(5);
    for (const size of sizes) {
      const floor = INLINE.has(size.selector) ? 24 : 44;
      expect(size.size, `${size.file} ${size.selector} ${size.property}`).toBeGreaterThanOrEqual(floor);
    }
  });

  it('compact density goes back to 44px controls under a coarse pointer', () => {
    const tokens = coarse.filter((block) => block.file === 'styles/tokens.css').map((block) => block.body).join('\n');
    expect(tokens).toMatch(/\[data-density='compact'\][^{]*\{\s*--control-height:\s*44px/);
  });

  it('the Studio squares and the reorder handle are full-height targets', () => {
    const cell = allRules.filter((rule) => rule.selector === '.studio-cell' && /min-height\s*:/.test(rule.body));
    expect(cell.map((rule) => px(/min-height\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? ''))).toContain(44);
    const grip = allRules.find((rule) => rule.selector === '.timeline .grip' && /min-height\s*:/.test(rule.body));
    expect(grip?.body).toMatch(/min-height:\s*var\(--control-height\)/);
  });

  it('a pen or finger on the grid, the arc or the waveform still scrolls the page; only the handle takes it', () => {
    const touch = (selector: string) => allRules.find((rule) => rule.selector === selector && /touch-action\s*:/.test(rule.body))?.body ?? '';
    expect(touch('.studio-grid .studio-cell')).toMatch(/touch-action:\s*pan-y/);
    expect(touch('.energy-horizon.intention')).toMatch(/touch-action:\s*pan-y/);
    expect(touch('.energy-arc-preview')).toMatch(/touch-action:\s*pan-y/);
    expect(touch('.strip.can-seek')).toMatch(/touch-action:\s*pan-y/);
    expect(touch('.timeline .grip')).toMatch(/touch-action:\s*none/);
  });

  it('hover-only hints are kept to precise pointers, so a pen or finger never leaves one stuck on', () => {
    const fine = mediaBlocks(/hover:\s*hover\)\s*and\s*\(pointer:\s*fine/);
    expect(fine.length).toBeGreaterThan(0);
    for (const block of fine) for (const rule of rulesIn(block.body)) expect(rule.selector).toMatch(/:hover/);
    // the same hint is reachable without hovering
    expect(allRules.some((rule) => rule.selector === '.vibe-card:focus-within .vibe-tempo')).toBe(true);
  });
});
