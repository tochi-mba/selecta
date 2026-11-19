import { describe, expect, it } from 'vitest';
import { BANNED_CLAIMS, PLAYBACK_STATUS, playbackStatusLabel, playbackStatusText } from './copy';

/**
 * BF-0463-03 and BF-0460-08: the copy audit. Every string literal and every piece of JSX text in
 * web/src/**\/*.tsx is checked against the banned-claims list in copy.ts, unioned with the DSP
 * honesty list in dsp/honesty.ts (ADR-0459) when that file exists. A banned promise cannot ship in
 * a page, even phrased as a heading or a toast.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;

// The honesty list is optional: an eager glob answers {} when the file is not there.
const honesty = import.meta.glob<{ BANNED_CLAIMS?: readonly string[] }>('./dsp/honesty.ts', { eager: true });
const DSP_CLAIMS = Object.values(honesty).flatMap((module) => module.BANNED_CLAIMS ?? []);
const ALL_CLAIMS = [...new Set([...BANNED_CLAIMS, ...DSP_CLAIMS].map((claim) => claim.toLowerCase()))];

const FILES = fs.readdirSync(SOURCE, { recursive: true })
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => file.endsWith('.tsx') && !file.includes('.test.') && !file.includes('/test/'));

/** Comments out, so a note explaining a rule is not read as copy. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** The string literals and the JSX text in one source file. */
function literals(source: string): string[] {
  const text = stripComments(source);
  const found: string[] = [];
  for (const match of text.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    found.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  for (const match of text.matchAll(/>([^<>{}]+)</g)) found.push(match[1]);
  return found.map((piece) => piece.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function offences(file: string, source: string): string[] {
  const out: string[] = [];
  for (const piece of literals(source)) {
    const lowered = piece.toLowerCase().replace(/[’‘]/g, "'");
    // Overlapping phrases ("unattended 24/7" inside "runs unattended 24/7") count once per string.
    const claim = ALL_CLAIMS.find((banned) => lowered.includes(banned));
    if (claim) out.push(`${file}: "${piece.slice(0, 100)}" says "${claim}"`);
  }
  return out;
}

describe('copy audit (BF-0463-03, BF-0460-08)', () => {
  it('has a real list to check, including the DSP honesty list when it exists', () => {
    expect(BANNED_CLAIMS.length).toBeGreaterThan(5);
    expect(ALL_CLAIMS).toContain('runs unattended 24/7');
    expect(ALL_CLAIMS).toContain('same as the native engine');
    for (const claim of DSP_CLAIMS) expect(ALL_CLAIMS).toContain(claim.toLowerCase());
  });

  it('finds the pages it guards, so the scan is not vacuous', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES).toContain('cloud/onboarding/OnboardingSpine.tsx');
    expect(FILES).toContain('cloud/Billing.tsx');
  });

  it('catches a planted claim in a string, a template and JSX text', () => {
    expect(offences('x.tsx', "const a = 'SelectaDJ runs unattended 24/7';")).toHaveLength(1);
    expect(offences('x.tsx', 'const b = `It works on every phone, ${name}`;')).toHaveLength(1);
    expect(offences('x.tsx', '<p>Background playback guaranteed.</p>')).toHaveLength(1);
    expect(offences('x.tsx', '// a comment may name runs unattended 24/7 to explain the rule')).toEqual([]);
  });

  it('no page in web/src says a banned claim', () => {
    const found = FILES.flatMap((file) => offences(file, fs.readFileSync(SOURCE + file, 'utf8')));
    expect(found, found.join('\n')).toEqual([]);
  });

  it('the playback vocabulary itself is clean', () => {
    for (const words of Object.values(PLAYBACK_STATUS)) {
      for (const text of [words.label, words.detail]) {
        for (const claim of ALL_CLAIMS) expect(text.toLowerCase()).not.toContain(claim);
      }
    }
  });
});

describe('playback status vocabulary (BF-0463-03)', () => {
  it('defines exactly the five states, each with its own label', () => {
    expect(Object.keys(PLAYBACK_STATUS).sort()).toEqual(['interrupted', 'output_unverified', 'playing', 'uncertain', 'unsupported_here']);
    const labels = Object.values(PLAYBACK_STATUS).map((words) => words.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('says playing only with the time a person confirmed the sound', () => {
    const at = Date.UTC(2026, 10, 17, 21, 4) / 1000;
    expect(playbackStatusText({ state: 'playing', verifiedAt: at }, { timeZone: 'UTC' })).toBe('Playing. Sound last confirmed by a person at 21:04.');
  });

  it('names the reason when a device cannot play, and never claims sound otherwise', () => {
    expect(playbackStatusText({ state: 'unsupported_here', reason: 'this browser has no AudioWorklet.' })).toContain('this browser has no AudioWorklet.');
    for (const state of ['output_unverified', 'interrupted', 'uncertain'] as const) {
      const text = playbackStatusText({ state });
      expect(text).not.toMatch(/^Playing/);
      expect(playbackStatusLabel({ state })).toBe(PLAYBACK_STATUS[state].label);
    }
  });
});
