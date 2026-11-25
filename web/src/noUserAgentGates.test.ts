import { describe, expect, it } from 'vitest';

/**
 * BF-0460-01: capability by measured probe, never identity (ADR-0460). No feature gate may read
 * the user agent: not `navigator.userAgent`, not Client Hints (`userAgentData`), not
 * `navigator.vendor` or `navigator.platform`. Every source file in web/src is scanned; the only
 * files allowed to read them are listed below, each with the reason it is a label and not a gate.
 * A new reader fails this test until it is either removed or added here with an honest reason.
 *
 * The second rule closes the side door: the modules that decide what a device may do (flags, the
 * engine, media, DSP, the onboarding spine, the local-first player and the venue flow) never
 * import the identity readers, so a label cannot leak into a decision through an import.
 */
type Fs = { readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string, options: { recursive: true }): string[] };
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const fs = node.getBuiltinModule('node:fs') as Fs;
const SOURCE = `${node.cwd()}/src/`;

const FILES = fs.readdirSync(SOURCE, { recursive: true })
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes('/test/'));

const READS_IDENTITY = /\buserAgent\b|\buserAgentData\b|\bnavigator\s*\.\s*vendor\b|\bnavigator\s*\.\s*platform\b|\bnav\s*\.\s*platform\b/;

/** Files that read the browser's description, and why each is a label, not a gate. */
const LABEL_ONLY: Record<string, string> = {
  'cloud/venue/deviceIdentity.ts': 'fills the capability record key (device model, OS, browser); qualification() never sees it',
  'devices/deviceInfo.ts': 'names the device in the device list and picks advisory words like "Best as a remote" (ADR-0415); it hides and refuses nothing',
  'devices/DeviceCheck.tsx': 'prints the description into the device-check report a person copies for the device lab',
  'kiosk/api.ts': 'names the browser in the kiosk status line',
  'cloud/install.ts': 'keeps the Share, then Add to Home Screen words out of browsers built into other apps, which expose the same navigator.standalone as Safari and cannot follow them (T-20261125-f78f); it withholds advice only, never a feature',
};

/** Where decisions are made: none of these may import an identity reader. */
const DECIDERS = /^(flags|engine\/|media\/|dsp\/|cloud\/onboarding\/|cloud\/localFirst|cloud\/venue\/(?!deviceIdentity|probeSuite|capabilityRecord))/;
const IDENTITY_MODULES = /(?:^|\/)(deviceInfo|deviceIdentity)['"]?$/;

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const importsOf = (source: string) => [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

describe('no feature gate reads the user agent (BF-0460-01)', () => {
  it('only the listed label-only files read the browser description', () => {
    const readers = FILES.filter((file) => READS_IDENTITY.test(withoutComments(fs.readFileSync(`${SOURCE}${file}`, 'utf8'))));
    const unexplained = readers.filter((file) => !LABEL_ONLY[file]);
    expect(unexplained).toEqual([]);
    // A stale allowance is removed, so the list never grows quietly.
    expect(Object.keys(LABEL_ONLY).filter((file) => !readers.includes(file))).toEqual([]);
  });

  it('decision modules never import an identity reader', () => {
    const offending = FILES.filter((file) => DECIDERS.test(file)).flatMap((file) => importsOf(fs.readFileSync(`${SOURCE}${file}`, 'utf8'))
      .filter((path) => IDENTITY_MODULES.test(path))
      .map((path) => `${file} -> ${path}`));
    expect(offending).toEqual([]);
  });

  it('the scan really sees the files it guards', () => {
    expect(FILES).toEqual(expect.arrayContaining(['engine/probe.ts', 'media/capabilities.ts', 'cloud/venue/capabilityRecord.ts', 'cloud/venue/VenuePosture.tsx']));
    expect(READS_IDENTITY.test('const ua = navigator.userAgent;')).toBe(true);
    expect(READS_IDENTITY.test('navigator.userAgentData?.brands')).toBe(true);
    expect(READS_IDENTITY.test("if ('wakeLock' in navigator) {}")).toBe(false);
  });
});
