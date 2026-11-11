import { describe, expect, it } from 'vitest';
import { clock, gb, length } from './lib';

/**
 * ADR-0079 (S31-0079-08): the numbers on screen (BPM, keys, durations, counts, storage, waveform
 * times and titles) read plainly at the edges, and the ones that sit in columns or change in place use
 * even-width figures, so they line up. The geometry half is web/e2e/mp-0275-typography.e2e.ts.
 */

type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;
const read = (file: string) => fs.readFileSync(SOURCE + file, 'utf8');
const sheets = ['style.css', ...fs.readdirSync(`${SOURCE}styles/`).filter((name) => name.endsWith('.css')).map((name) => `styles/${name}`)]
  .map(read).join('\n');

/** Every selector that some rule gives a given declaration. */
function selectorsWith(declaration: RegExp): string {
  return [...sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((rule) => declaration.test(rule[2])).map((rule) => rule[1]).join(',');
}

describe('S31-0079-08 numbers read plainly at the edges', () => {
  it('durations never read NaN, negative or a bare zero', () => {
    expect(clock(Number.NaN)).toBe('–:––');
    expect(clock(null)).toBe('–:––');
    expect(clock(-4)).toBe('0:00');
    expect(clock(59.6)).toBe('1:00');
    expect(clock(3725)).toBe('62:05');
    expect(length(20)).toBe('under 1 min');
    expect(length(3600)).toBe('1 hr');
    expect(length(5400)).toBe('1 hr 30 min');
  });

  it('storage keeps a readable unit at every size', () => {
    expect(gb(0)).toBe('0.0 GB');
    expect(gb(30 * 1024 ** 2)).toBe('30 MB');
    expect(gb(200 * 1024)).toBe('1 MB');
    expect(gb(0.5 * 1024 ** 3)).toBe('0.5 GB');
    expect(gb(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(gb(12.4 * 1024 ** 3)).toBe('12 GB');
  });

  it('BPM and key are named in words, and a missing value says why', () => {
    const library = read('views/LibraryRow.tsx');
    expect(library).toContain("`${Math.round(song.bpm)} BPM`");
    expect(library).toContain("'Not analysed'");
    expect(library).toMatch(/song\.camelot \?\? \(song\.bpm !== null \? 'Key unknown' : 'No key yet'\)/);
  });
});

describe('S31-0079-08 numbers that sit in columns or change in place line up', () => {
  const tabular = selectorsWith(/font-variant-numeric:\s*tabular-nums/);
  it.each([
    ['playback times and waveform clock', '.time'],
    ['counts', '.count'],
    ['workspace metrics and storage', '.workspace .metrics strong'],
    ['library BPM, key and length columns', '.library-rows .song-columns'],
    ['library totals', '.library-summary b'],
    ['song facts', '.facts'],
    ['studio playhead', '.studio-playhead'],
    ['number fields', "input[type='number']"],
  ])('%s use even-width figures', (_what, selector) => {
    expect(tabular).toContain(selector);
  });

  it('long and right-to-left titles wrap rather than spill, and keep their own direction', () => {
    const wraps = selectorsWith(/overflow-wrap:\s*anywhere/);
    for (const selector of ['.song-name', '.mini-song', '.next-song']) expect(wraps).toContain(selector);
    expect(selectorsWith(/unicode-bidi:\s*plaintext/)).toContain('.song-name b');
  });
});
