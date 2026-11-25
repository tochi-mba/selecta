import { describe, expect, it } from 'vitest';
import { AWAY_WORDS, DISCARDED_WORDS, finishedWords, hiddenTitle, LONG_IMPORT_FILES, LONG_IMPORT_MS, longImport } from './backgroundImport';

const running = { phase: 'running' as const, total: 2400, checked: 888, registered: 850, failures: [], waiting: null };

describe('hiddenTitle', () => {
  it('says how far a running import has got', () => {
    expect(hiddenTitle(running)).toBe('37% checked · SelectaDJ');
  });
  it('never says 100% while it still runs', () => {
    expect(hiddenTitle({ ...running, checked: 2400 })).toBe('99% checked · SelectaDJ');
  });
  it('says offline while sending waits for the connection', () => {
    expect(hiddenTitle({ ...running, waiting: { why: 'offline', retryAt: null } })).toBe('Offline, 37% checked · SelectaDJ');
  });
  it('before the folder is counted, and from checked plus failures where checked is not kept', () => {
    expect(hiddenTitle({ ...running, total: null })).toBe('Checking your music · SelectaDJ');
    expect(hiddenTitle({ ...running, checked: undefined, registered: 10, failures: [{ name: 'a', reason: 'b' }], total: 100 })).toBe('11% checked · SelectaDJ');
  });
  it('a finished import waits to be seen; idle leaves the page its own title', () => {
    expect(hiddenTitle({ ...running, phase: 'finished' })).toBe('Finished checking · SelectaDJ');
    expect(hiddenTitle({ ...running, phase: 'failed' })).toBe('Import needs a look · SelectaDJ');
    expect(hiddenTitle({ ...running, phase: 'idle' })).toBeNull();
  });
});

describe('finishedWords', () => {
  it('names the folder and the songs, and files that would not read', () => {
    expect(finishedWords({ folder: 'Music', registered: 2400, failures: [] })).toBe('Finished checking Music. 2,400 songs are in your library.');
    expect(finishedWords({ folder: null, registered: 1, failures: [{ name: 'x', reason: 'y' }] })).toBe('Finished checking your music. 1 song is in your library. 1 file could not be read.');
  });
});

describe('longImport', () => {
  it('by time or by size', () => {
    expect(longImport(LONG_IMPORT_MS - 1, 10)).toBe(false);
    expect(longImport(LONG_IMPORT_MS, 10)).toBe(true);
    expect(longImport(0, LONG_IMPORT_FILES)).toBe(true);
    expect(longImport(0, null)).toBe(false);
  });
});

describe('words', () => {
  it('have no em dash and never say "not yet"', () => {
    for (const words of [AWAY_WORDS, DISCARDED_WORDS]) {
      expect(words).not.toContain(String.fromCharCode(0x2014));
      expect(words).not.toMatch(/not yet/i);
    }
  });
});
