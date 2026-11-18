import { describe, expect, it } from 'vitest';
import { POLLING } from './state/pollingPolicy';
import { ALL_SHEETS, appSource, fs, readSheet, readSource, ROOT, SOURCE_FILES } from './test/sheets';

/**
 * BF overhaul W6 bans: the patterns the overhaul removed, kept out by reading the real source.
 * - window.confirm / alert / prompt: a question goes through ui/ConfirmDialog (focus trap, inert page,
 *   focus return, the undo toast where the action is reversible).
 * - glyph icons: a mark is an <Icon> (ui/Icon.tsx, docs/engineering/icon-inventory.md) or drawn by
 *   CSS, never a typed symbol whose look depends on the font.
 * - raw setInterval: a repeating timer is written `window.setInterval` (or useVisiblePoll) in a file
 *   listed in state/pollingPolicy.ts, so the polling register sees every one.
 * - hidden file pickers: an <input type="file"> taken out of the tab order is opened by a real
 *   button; one hidden only visually inside a label shows a focus ring on that label.
 * - em dashes: never in web/src source or in the docs (the owner's rule; copy uses hyphens).
 */
const CODE = appSource(/\.tsx?$/);
/** Source with comments removed, so a sentence about a ban is not a use of it. */
const code = (file: string) => readSource(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/**
 * Lines the ban catches in files another agent of the overhaul still owns. Each is reported to the
 * coordinator and leaves this list in the commit that fixes it; the test fails if one is fixed and
 * left here, so the list can only shrink.
 */
const AWAITING_OWNER: Record<string, string[]> = {
  glyph: ['cloud/CloudApp.tsx', 'cloud/Library.tsx'],
};

describe('native dialogs (ConfirmDialog replaces them)', () => {
  it('no component calls or holds window.confirm, alert or prompt', () => {
    const uses = CODE.filter((file) => /(?<![\w.])(?:(?:window|globalThis|self)\.)?(?:confirm|alert|prompt)\((?!\)\s*:)|\b(?:window|globalThis)\.(?:confirm|alert|prompt)\b/.test(code(file)));
    expect(uses).toEqual([]);
  });
});

// Code points are written as numbers, so this file never holds the symbols it bans.
const chars = (...codes: number[]) => String.fromCodePoint(...codes);
const span = (from: number, to: number) => `${chars(from)}-${chars(to)}`;

describe('glyph icons', () => {
  // check marks, crosses, notes, triangles and media symbols, warning, stars, pencils, gears, menus, hearts, emoji
  const GLYPH = new RegExp(`[${span(0x2713, 0x2718)}${span(0x266a, 0x266c)}${span(0x25b2, 0x25c0)}${span(0x23e9, 0x23fa)}${chars(0x26a0, 0x2605, 0x2606, 0x270e, 0x270f, 0x2699, 0x2630, 0x22ee, 0x22ef, 0x2764, 0x2665)}]|[${span(0x1f300, 0x1faff)}]`, 'u');
  // an arrow or a multiplication sign as a button's whole face is an icon; between two words, or as
  // a decorative separator beside hidden words ("into"), it is typography ("120 → 124 BPM") and stays
  const LONE = new RegExp(String.raw`<button[^>]*>\s*(?:\{\s*['"])?[${span(0x2190, 0x21ff)}${chars(0xd7)}](?:['"]\s*\})?\s*</button>`);

  it('no component or script types a symbol where an Icon belongs', () => {
    const found = CODE.filter((file) => GLYPH.test(code(file)) || LONE.test(code(file)));
    expect(found.filter((file) => !AWAITING_OWNER.glyph.includes(file))).toEqual([]);
  });

  it('no stylesheet draws a mark with a typed symbol in content', () => {
    const found = ALL_SHEETS.filter((file) => [...readSheet(file).matchAll(/content:\s*(['"])(.*?)\1/g)].some((match) => GLYPH.test(match[2])));
    expect(found).toEqual([]);
  });

  it('the files awaiting their owner still have the glyph, so a fix also empties the list', () => {
    for (const file of AWAITING_OWNER.glyph) expect(GLYPH.test(code(file)), file).toBe(true);
  });
});

describe('timers (state/pollingPolicy.ts)', () => {
  it('every repeating timer is window.setInterval, which the polling register can see', () => {
    // a React state setter named setInterval (Billing's month/year choice) is not the timer
    const bare = CODE.filter((file) => {
      const text = code(file);
      if (/\[\s*\w+\s*,\s*setInterval\s*\]\s*=\s*useState/.test(text)) return false;
      return /(?<![\w.])setInterval\(|\b(?:globalThis|self)\.setInterval\(/.test(text);
    });
    expect(bare).toEqual([]);
  });

  it('every file with window.setInterval is listed in the polling policy', () => {
    const listed = new Set(POLLING.map((rule) => rule.file));
    expect(CODE.filter((file) => /window\.setInterval\(/.test(code(file)) && !listed.has(file))).toEqual([]);
  });
});

describe('file pickers keep a keyboard path', () => {
  const pickers = CODE.flatMap((file) => [...readSource(file).matchAll(/<input\b[^>]*type="file"[^>]*>/g)].map((match) => ({ file, tag: match[0], at: match.index! })));

  it('finds the pickers', () => {
    expect(pickers.length).toBeGreaterThan(3);
  });

  it('a picker out of the tab order is opened by a button through its ref', () => {
    const off: string[] = [];
    for (const { file, tag } of pickers) {
      if (!/\shidden[\s/>]|tabIndex=\{-1\}|aria-hidden="true"|display:\s*'none'/.test(tag)) continue;
      const ref = tag.match(/ref=\{(\w+)\}/)?.[1];
      const opened = ref && new RegExp(`<button\\b[^>]*onClick=\\{[^}]*\\b${ref}\\.current\\??!?\\.click\\(\\)`).test(readSource(file));
      if (!opened) off.push(`${file}: ${tag}`);
    }
    expect(off).toEqual([]);
  });

  it('a picker hidden only visually inside a label shows the focus ring on that label', () => {
    const sheets = ALL_SHEETS.map(readSheet).join('\n');
    const off: string[] = [];
    for (const { file, tag, at } of pickers) {
      const before = readSource(file).slice(0, at);
      const label = before.slice(before.lastIndexOf('<label')).match(/^<label\b[^>]*className="([\w-]+)/)?.[1];
      if (!label || before.lastIndexOf('</label>') > before.lastIndexOf('<label')) continue;
      const hides = new RegExp(`\\.${label} input[^{]*\\{[^}]*clip`).test(sheets);
      if (hides && !new RegExp(`\\.${label}:focus-within`).test(sheets)) off.push(`${file}: .${label} hides ${tag} with no focus ring`);
    }
    expect(off).toEqual([]);
  });
});

describe('em dashes', () => {
  const DASH = String.fromCodePoint(0x2014);
  it('none in web/src source, sheets or pages', () => {
    const files = SOURCE_FILES.filter((name) => /\.(?:tsx?|css|html|json)$/.test(name) && !/\.test\.tsx?$/.test(name));
    expect(files.filter((file) => readSource(file).includes(DASH))).toEqual([]);
    const pages = ['index.html', 'guest.html', 'display.html', 'kiosk.html', 'cloud-harness.html', 'business-harness.html'];
    expect(pages.filter((page) => fs.existsSync(`${ROOT}web/${page}`) && fs.readFileSync(`${ROOT}web/${page}`, 'utf8').includes(DASH))).toEqual([]);
  });

  it('none in the docs', () => {
    const docs = fs.readdirSync(`${ROOT}docs`, { recursive: true }).map((name) => name.replace(/\\/g, '/')).filter((name) => name.endsWith('.md'));
    expect(docs.length).toBeGreaterThan(100);
    expect(docs.filter((name) => fs.readFileSync(`${ROOT}docs/${name}`, 'utf8').includes(DASH))).toEqual([]);
  });
});
