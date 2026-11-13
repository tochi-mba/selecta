import { describe, expect, it } from 'vitest';
import { CLOUD_MEDIA_CONTEXTS, mediaCount } from './cloudMediaContexts';

// AV-0419-01: every media element or audio context in the Cloud site is registered, with its
// owner, in cloudMediaContexts.ts (and docs/engineering/cloud-media-contexts.md).

const sources = import.meta.glob(
  ['../cloud/**/*.{ts,tsx}', '../rooms/**/*.{ts,tsx}', '../devices/**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const key = (path: string) => path.replace(/^\.\.\//, '').replace(/^\.\//, 'cloud/');
// The inventory defines its own pattern examples; they are not runtime media contexts.
const scanned = Object.entries(sources).filter(([path]) => key(path) !== 'cloud/cloudMediaContexts.ts');

describe('Cloud media contexts (AV-0419-01)', () => {
  it('scans the Cloud, Rooms and devices sources', () => {
    const files = scanned.map(([path]) => key(path));
    expect(files).toContain('cloud/Library.tsx');
    expect(files).toContain('rooms/CloudListen.tsx');
    expect(files).toContain('devices/PlayingBar.tsx');
  });

  it('finds exactly the registered media contexts, file by file', () => {
    const found: Record<string, number> = {};
    for (const [path, text] of scanned) {
      const count = mediaCount(text);
      if (count) found[key(path)] = count;
    }
    const registered = Object.fromEntries(CLOUD_MEDIA_CONTEXTS.map((entry) => [entry.file, entry.count]));
    expect(found).toEqual(registered);
  });

  it('would catch a new unregistered element, Audio() or audio context', () => {
    expect(mediaCount('const a = <audio src={x} />;')).toBe(1);
    expect(mediaCount('const a = new Audio();')).toBe(1);
    expect(mediaCount('const c = new AudioContext();')).toBe(1);
    expect(mediaCount("document.createElement('video')")).toBe(1);
    expect(mediaCount('// a comment about an <audio> element\nconst x = 1;')).toBe(0);
  });

  it('names an owner for every registered context', () => {
    for (const entry of CLOUD_MEDIA_CONTEXTS) expect(entry.owner.length).toBeGreaterThan(20);
  });
});
