import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Status, type StatusKind } from '../ui/controls';
import { LifecyclePill } from '../views/LucyProposal';
import { SongMotif } from '../ui/MusicObjects';

/**
 * LX-0364-01, -04 and -06: Lucy's stylesheet uses only the app's tokens, every token the shared
 * design-language page names exists, states always carry words and a mark, and the only animation is
 * real running work that Still and reduced motion both remove.
 * See docs/engineering/library-lucy-design-language.md.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const lucyCss = fs.readFileSync(`${SOURCE}styles/lucy.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokens = fs.readFileSync(`${SOURCE}styles/tokens.css`, 'utf8');
const doc = fs.readFileSync(`${SOURCE}../../docs/engineering/library-lucy-design-language.md`, 'utf8');

/** A selector list split at its own commas, not the ones inside :is(...) or :not(...). */
function topLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let part = '';
  for (const char of list) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(part); part = ''; } else part += char;
  }
  return [...parts, part].map((item) => item.trim()).filter(Boolean);
}

describe('LX-0364-01 tokens with scope boundaries', () => {
  it('Lucy’s CSS has no colour of its own: every colour is a token', () => {
    expect(lucyCss.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi) ?? []).toEqual([]);
  });

  it('every token the design-language page names is defined in tokens.css or the shell', () => {
    const shell = fs.readFileSync(`${SOURCE}styles/shell.css`, 'utf8') + fs.readFileSync(`${SOURCE}styles/foundation.css`, 'utf8');
    const named = [...new Set(doc.match(/`--[a-z0-9-]+`/g)?.map((name) => name.slice(1, -1)) ?? [])];
    expect(named.length).toBeGreaterThan(30);
    for (const token of named) expect(`${tokens}${shell}`, token).toContain(`${token}:`);
  });

  it('every token Lucy’s CSS uses is one the page lists', () => {
    const used = [...new Set(lucyCss.match(/var\(--[a-z0-9-]+/g)?.map((use) => use.slice(4)) ?? [])];
    for (const token of used) expect(doc, `${token} is used by lucy.css but not documented`).toContain(`\`${token}\``);
  });

  it('every Lucy rule stays inside Lucy', () => {
    const selectors = lucyCss.replace(/@[a-z-]+[^{]*\{/g, '').match(/[^{}]+(?=\{)/g) ?? [];
    for (const list of selectors) {
      for (const selector of topLevel(list)) {
        if (/^(from|to|\d+%)$/.test(selector)) continue;
        expect(selector, selector).toMatch(/\.lucy|\.page\.lucy/);
      }
    }
  });
});

describe('LX-0364-04 states in words and marks', () => {
  it('each status kind has its own words and a mark', () => {
    const kinds: StatusKind[] = ['planned', 'queued', 'working', 'ready', 'warning', 'blocked', 'failed', 'unavailable'];
    const said = kinds.map((kind) => {
      const { container } = render(<Status kind={kind} />);
      expect(container.querySelector('svg, .ui-icon'), kind).not.toBeNull();
      return container.textContent;
    });
    expect(new Set(said).size).toBe(kinds.length);
  });

  it('saved and playing say so, and proposed and playing also differ in outline and fill', () => {
    expect(render(<LifecyclePill stage="draft" />).container.textContent).toBe('Saved draft');
    expect(render(<LifecyclePill stage="playing" />).container.textContent).toBe('Playing');
    expect(lucyCss).toMatch(/\.lucy-stage\.is-proposed\s*\{[^}]*border-style:\s*dashed/);
    expect(lucyCss).toMatch(/\.lucy-stage\.is-playing\s*\{[^}]*background:/);
  });
});

describe('LX-0364-06 motion only for real work', () => {
  it('the only animation is the running-step bar, and Still and reduced motion both remove it', () => {
    const animated = lucyCss.match(/[^{}]+\{[^}]*animation:[^}]*\}/g) ?? [];
    expect(animated.map((rule) => rule.split('{')[0].trim())).toEqual(['.lucy-indeterminate i']);
    expect(lucyCss).toMatch(/:root\[data-motion='still'\] \.lucy-indeterminate \{ display: none; \}/);
    expect(lucyCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.lucy-indeterminate \{ display: none; \} \}/);
    expect(tokens).toMatch(/:root\[data-motion='still'\] \*,[\s\S]*?animation: none !important/);
  });
});

describe('LX-0364-02 one song identity in Library and Lucy', () => {
  it('both rows draw the same SongMotif from the recording id beside the title, and no artwork', () => {
    const library = fs.readFileSync(`${SOURCE}views/LibraryRow.tsx`, 'utf8');
    const lucy = fs.readFileSync(`${SOURCE}views/LucySongs.tsx`, 'utf8');
    expect(library).toMatch(/<SongMotif songId=\{song\.id\} \/><b dir="auto"/);
    expect(lucy).toMatch(/<SongMotif songId=\{song\.song_id\} \/>/);
    for (const source of [library, lucy]) expect(source).not.toMatch(/<img\b|artwork|cover_url|coverArt/i);
    const one = render(<SongMotif songId={7} />).container.innerHTML;
    const again = render(<SongMotif songId={7} />).container.innerHTML;
    expect(again).toBe(one);
    expect(doc).toMatch(/There is no artwork, real or invented\./);
  });
});
