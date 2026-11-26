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

/**
 * The owner's rule: nothing in SelectaDJ is "not yet". Every string literal and JSX text in
 * web/src (.ts and .tsx, tests aside) is checked for a promise about the product: "not yet",
 * "coming soon", "soon" (other than "as soon as" and "too soon"), and a refusal that ends in
 * "yet" ("isn't available here yet", "can't do that in your browser yet"). A state of a song,
 * a device or a list ("No mixes yet", "Not measured yet") is a fact and is not matched. Where
 * the product can't do something, the page says what the member can do instead.
 */
const PROMISE_FILES = fs.readdirSync(SOURCE, { recursive: true })
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts') && !file.includes('.test.') && !file.includes('/test/'));

const PROMISES: ReadonlyArray<[string, RegExp]> = [
  ['not yet', /\bnot yet\b/i],
  ['coming soon', /\bcoming soon\b/i],
  ['soon', /\bsoon\b(?<!\bas soon)(?<!\btoo soon)/i],
  ['a refusal that waits on "yet"', /\b(can't|cannot|isn't|aren't|doesn't|don't|not)\b[^.?!]*\b(browser|available|supported|on sale|published|switched on|open|set up|offered|here|do (this|that))\b[^.?!]*\byet\b/i],
];

/** Sentences where the word is not a promise about the product, each with its reason. */
const NOT_A_PROMISE: ReadonlyArray<[string, string, string]> = [
  ['kiosk/copy.ts', 'Closed. Music starts soon', 'the venue\'s own opening hours: music starts at the next opening time'],
  ['business/forms/LicenceAttestationForm.tsx', 'Ends soon', 'a licence\'s end date is close: a fact about the venue\'s licence'],
  ['views/LucyUsageMeter.tsx', 'Expires soon', 'a top-up\'s expiry date is close: a fact about the member\'s allowance'],
  ['views/EditorRows.tsx', 'warn seam-too-soon', 'a CSS class name, never shown'],
];

function promises(file: string, source: string): string[] {
  const out: string[] = [];
  for (const piece of literals(source)) {
    const plain = piece.replace(/[’‘]/g, "'");
    const said = PROMISES.find(([, rule]) => rule.test(plain));
    if (!said) continue;
    if (NOT_A_PROMISE.some(([where, sentence]) => where === file && plain === sentence)) continue;
    out.push(`${file}: "${piece.slice(0, 100)}" says ${said[0]}`);
  }
  return out;
}

describe('no "not yet" in SelectaDJ', () => {
  it('scans the pages and the copy tables, so the scan is not vacuous', () => {
    expect(PROMISE_FILES.length).toBeGreaterThan(FILES.length);
    expect(PROMISE_FILES).toContain('cloud/localFirstRequest.ts');
    expect(PROMISE_FILES).toContain('cloud/browserFlags.ts');
  });

  it('catches a planted promise and lets a fact through', () => {
    expect(promises('x.ts', "const a = 'SelectaDJ can’t do that in your browser yet.';")).toHaveLength(1);
    expect(promises('x.ts', "const b = 'Lyrics: coming soon';")).toHaveLength(1);
    expect(promises('x.tsx', '<p>Not yet</p>')).toHaveLength(1);
    expect(promises('x.ts', "const c = 'Stems arrive soon';")).toHaveLength(1);
    expect(promises('x.ts', "const d = 'No mixes yet. Make one';")).toEqual([]);
    expect(promises('x.ts', "const e = 'This song has not played yet tonight';")).toEqual([]);
    expect(promises('x.ts', "const f = 'Plays as soon as it is here';")).toEqual([]);
    expect(promises('x.ts', '// a comment may say not yet')).toEqual([]);
  });

  it('every allowed sentence is still there, so the list never goes stale', () => {
    for (const [file, sentence] of NOT_A_PROMISE) {
      expect(literals(fs.readFileSync(SOURCE + file, 'utf8')).map((piece) => piece.replace(/[’‘]/g, "'")), `${file}: ${sentence}`).toContain(sentence);
    }
  });

  it('no string in web/src promises a feature later', () => {
    const found = PROMISE_FILES.flatMap((file) => promises(file, fs.readFileSync(SOURCE + file, 'utf8')));
    expect(found, found.join('\n')).toEqual([]);
  });
});

/**
 * The names ADR-0479 retired (docs/glossary.md). A member sees where a song lives ("on this
 * device", "in your cloud library"), never a "mode", so no string or JSX text in web/src may say
 * one of these. "BF" counts only as a capital word on its own: a requirement id such as
 * BF-0463-03 cites a checklist, and lower-case ids such as a model's implementation id are data.
 */
const RETIRED = /(local[- ]first|browser[- ]first|hosted mode|local mode|cloud mode)/i;
const RETIRED_BF = /\bBF\b(?!-\d)/;

/** Identifiers that must keep the old words, each with why. The fragment is taken out of the
 * string before the check, so prose around it is still read. */
const IDENTIFIERS: ReadonlyArray<[string, string, string]> = [
  ['cloud/labs/LocalFirstLabs.tsx', '/labs/local-first', 'a deployed API route; renaming it breaks a client already in a member\'s browser'],
];

function retired(file: string, source: string): string[] {
  const out: string[] = [];
  for (const piece of literals(source)) {
    let plain = piece;
    for (const [where, fragment] of IDENTIFIERS) if (where === file) plain = plain.split(fragment).join('');
    const said = plain.match(RETIRED) ?? plain.match(RETIRED_BF);
    if (said) out.push(`${file}: "${piece.slice(0, 100)}" says "${said[0]}"`);
  }
  return out;
}

describe('no retired names in SelectaDJ (ADR-0479)', () => {
  it('catches a planted name and lets an identifier through', () => {
    expect(retired('x.tsx', '<p>Browser-first Cloud is on.</p>')).toHaveLength(1);
    expect(retired('x.ts', "const a = 'Your hosted mode is on';")).toHaveLength(1);
    expect(retired('x.ts', "const b = 'Join BF today';")).toHaveLength(1);
    expect(retired('x.ts', "const c = 'Checked under BF-0463-03';")).toEqual([]);
    expect(retired('x.ts', "const d = 'bf-tier3-beat-this';")).toEqual([]);
    expect(retired('cloud/labs/LocalFirstLabs.tsx', "const e = '/account/labs/local-first';")).toEqual([]);
    expect(retired('cloud/labs/LocalFirstLabs.tsx', "const f = 'Labs: local-first Cloud';")).toHaveLength(1);
  });

  it('every allowed identifier is still there, so the list never goes stale', () => {
    for (const [file, fragment] of IDENTIFIERS) {
      expect(literals(fs.readFileSync(SOURCE + file, 'utf8')).some((piece) => piece.includes(fragment)), `${file}: ${fragment}`).toBe(true);
    }
  });

  it('no string in web/src says a retired name', () => {
    const found = PROMISE_FILES.flatMap((file) => retired(file, fs.readFileSync(SOURCE + file, 'utf8')));
    expect(found, found.join('\n')).toEqual([]);
  });
});
