import { describe, expect, it } from 'vitest';

/**
 * ADR-0276 static guards: the parts of surface depth, borders, shadows and accent hierarchy a stylesheet
 * can be checked for without a browser. The measured proof is web/e2e/mp-0276-surface-depth.e2e.ts.
 */
// Read from disk through Node's own loader, as spacing-tokens.test.ts does (CSS ?raw imports are empty in Vitest).
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const FILES = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)];
const COMPONENTS = FILES.filter((file) => file !== 'styles/tokens.css');
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = read('styles/tokens.css');

type Rule = { file: string; selector: string; body: string };
const rules: Rule[] = COMPONENTS.flatMap((file) => [...read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((match) => ({ file, selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] })));
const declarations = (property: RegExp) => rules.flatMap((rule) => [...rule.body.matchAll(new RegExp(`(?:^|;|\\s)(${property.source})\\s*:\\s*([^;]+)`, 'g'))]
  .map((match) => ({ ...rule, property: match[1], value: match[2].trim() })));

describe('surface roles (MP-0276-01)', () => {
  it('defines base, raised, control, panel, overlay and scrim', () => {
    for (const role of ['base', 'raised', 'control', 'panel', 'overlay', 'scrim']) {
      expect(tokens, `--surface-${role}`).toMatch(new RegExp(`--surface-${role}:`));
    }
    // the overlay is lifted in Dark and plain in Light, where the shadow carries depth
    expect(tokens).toMatch(/--surface-overlay: color-mix\(in srgb, var\(--ink\) 6%, var\(--panel\)\);/);
    expect(tokens.match(/--surface-overlay: var\(--panel\);/g)).toHaveLength(2);
  });

  it('paints every background through a role, never a palette colour', () => {
    const raw = declarations(/background(?:-color)?/).filter((item) => /var\(--(?:bg|panel|panel-2)\)/.test(item.value));
    expect(raw.map((item) => `${item.file} ${item.selector}: ${item.value}`)).toEqual([]);
  });

  it('dims the page with the scrim and floats overlays on the overlay surface', () => {
    const shell = read('styles/shell.css');
    expect(shell).toMatch(/\.overlay \{[^}]*background: var\(--surface-scrim\);/);
    expect(shell).toMatch(/\.overlay-panel \{[^}]*background: var\(--surface-overlay\);/);
    expect(read('styles/lucy.css')).toMatch(/dialog\.lucy-dialog::backdrop \{ background: var\(--surface-scrim\); \}/);
  });
});

describe('overlay depth (MP-0276-06)', () => {
  it('gives every floating surface the overlay shadow and edge, and nothing else a raw shadow', () => {
    for (const [file, selector] of [['styles/shell.css', '.overlay-panel'], ['styles/shell.css', '.menu-list'], ['styles/shell.css', '.toast-row'],
      ['styles/shell.css', '.tooltip'], ['styles/foundation.css', '.popover-panel'], ['styles/lucy.css', 'dialog.lucy-dialog']] as const) {
      const rule = rules.find((item) => item.file === file && item.selector === selector && /box-shadow/.test(item.body));
      expect(rule?.body, `${selector} has no overlay shadow`).toMatch(/box-shadow: var\(--shadow-overlay\)/);
    }
    // a drop shadow is a token; inline offsets are markers and glows, not depth
    const raw = declarations(/box-shadow/).filter((item) => /\d+px \d+px rgb/.test(item.value));
    expect(raw.map((item) => `${item.file} ${item.selector}`)).toEqual([]);
    expect(tokens.match(/--shadow-overlay:/g)).toHaveLength(3);
  });
});

describe('corners and line weights (MP-0276-03)', () => {
  it('takes every radius from the role scale', () => {
    const allowed = /^(?:0|50%|inherit|var\(--radius(?:-sm|-pill|-mark|-hair)?\)(?: var\(--radius(?:-sm|-hair)?\))*(?: 0)*|calc\(var\(--radius\) \* 1\.5\)|0 var\(--radius-sm\) var\(--radius-sm\) 0|var\(--radius\) var\(--radius\) 0 0|var\(--radius-hair\) var\(--radius-hair\) 0 0)$/;
    const off = declarations(/border-radius/).filter((item) => !allowed.test(item.value))
      // the drawn tie between two words in a seam diagram is a curve, not a corner
      .filter((item) => !(item.selector === '.music-seam-diagram.words .word-tie' && item.value === '40%'));
    expect(off.map((item) => `${item.file} ${item.selector}: ${item.value}`)).toEqual([]);
  });

  it('draws every state marker bar at the marker weight', () => {
    // a bar down one side, inset by its x offset; inset rings (0 0 0 2px) are pressed and changed cells
    const bars = declarations(/box-shadow/).filter((item) => /inset (?!0 )\S+ 0 0 /.test(item.value));
    expect(bars.length).toBeGreaterThan(15);
    expect(bars.filter((item) => !/inset var\(--marker\) 0 0 /.test(item.value)).map((item) => `${item.file} ${item.selector}`)).toEqual([]);
    expect(tokens).toMatch(/--marker: 3px;/);
    expect(tokens).toMatch(/--separator: 1px;/);
  });
});

describe('lime emphasis (MP-0276-04)', () => {
  it('reaches lime only through a role that means something', () => {
    const direct = rules.filter((rule) => /var\(--accent\)/.test(rule.body));
    expect(direct.map((rule) => `${rule.file} ${rule.selector}`)).toEqual([]);
  });

  it('paints motifs and charts in the quieter motif colour', () => {
    const music = read('styles/music-objects.css');
    expect(music).toMatch(/\.song-motif \{[^}]*color: var\(--motif\);/);
    expect(music).toMatch(/\.mix-signature \{[^}]*color: var\(--motif\);/);
    expect(music).toMatch(/\.vibe-card \.vibe-motif \{[^}]*color: var\(--motif\);/);
    expect(read('style.css')).toMatch(/\.energy-arc-preview polyline \{[^}]*stroke: var\(--motif\);/);
    expect(tokens).toMatch(/--motif: color-mix\(in srgb, var\(--accent\) 55%, var\(--soft\)\);/);
  });
});

describe('forced colours (MP-0276-08)', () => {
  it('turns every shadow-only state into a border or outline', () => {
    const depth = read('styles/depth.css');
    for (const selector of ['.library-rows .song-row.selected', '.timeline .song.selected', '.song.playing', '.editor-scope.is-current',
      '.request-row.active', '.request-row.stuck', '.editor-scope.is-draft', '.palette-item.on', '.overlay-panel']) {
      expect(depth, selector).toContain(selector);
    }
    expect(depth).toMatch(/@media \(forced-colors: active\)/);
  });
});
