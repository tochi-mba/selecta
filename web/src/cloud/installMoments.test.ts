import { describe, expect, it } from 'vitest';
import {
  decideOffer, dueMoments, FIRST_VISIT_QUIET_MS, LONG_IMPORT_FILES, LONG_IMPORT_MS, mergeMemory, offerWords, parseMemory,
  type InstallMoment, type MomentMemory, type OfferFacts,
} from './installMoments';

const NOW = 10_000_000;
const facts = (change: Partial<OfferFacts> = {}): OfferFacts => ({
  now: NOW, flag: true, install: 'prompt', visible: true, dialog: false, typing: false, offeredThisVisit: false, ...change,
});
const memory = (change: Partial<MomentMemory> = {}): MomentMemory => ({ firstSeen: NOW - 10 * 60_000, shown: [], dismissed: [], ...change });

describe('decideOffer', () => {
  it('offers at a good moment, on Chromium and on Safari for iPhone and iPad', () => {
    expect(decideOffer('import', facts(), memory())).toBe('show');
    expect(decideOffer('room', facts({ install: 'home_screen' }), memory())).toBe('show');
  });

  it('never once installed, once shown, after two Not nows, or a second time in a visit', () => {
    expect(decideOffer('import', facts({ install: 'installed' }), memory())).toBe('never');
    expect(decideOffer('import', facts(), memory({ shown: ['import'] }))).toBe('never');
    expect(decideOffer('room', facts(), memory({ shown: ['import', 'played'], dismissed: ['import', 'played'] }))).toBe('never');
    expect(decideOffer('room', facts({ offeredThisVisit: true }), memory())).toBe('never');
  });

  it('one Not now leaves the other moments', () => {
    expect(decideOffer('room', facts(), memory({ shown: ['import'], dismissed: ['import'] }))).toBe('show');
  });

  it('waits in the first minute of a first visit, over a dialog, while typing, in a hidden tab', () => {
    expect(decideOffer('import', facts(), memory({ firstSeen: NOW - FIRST_VISIT_QUIET_MS + 1 }))).toBe('wait');
    expect(decideOffer('import', facts(), memory({ firstSeen: NOW - FIRST_VISIT_QUIET_MS }))).toBe('show');
    expect(decideOffer('import', facts({ dialog: true }), memory())).toBe('wait');
    expect(decideOffer('import', facts({ typing: true }), memory())).toBe('wait');
    expect(decideOffer('import', facts({ visible: false }), memory())).toBe('wait');
  });

  it('waits while the flag is off or the browser has offered nothing', () => {
    expect(decideOffer('played', facts({ flag: false }), memory())).toBe('wait');
    expect(decideOffer('played', facts({ install: 'none' }), memory())).toBe('wait');
  });
});

describe('dueMoments', () => {
  const quiet = { importHere: false, importMs: 0, importTotal: null, handoffHeard: false, roomOpen: false };
  it('is empty when nothing has happened', () => {
    expect(dueMoments(quiet)).toEqual([]);
  });
  it('a long import is one that ran a while or has many files, and only in the importing tab', () => {
    expect(dueMoments({ ...quiet, importHere: true, importMs: LONG_IMPORT_MS - 1, importTotal: 20 })).toEqual([]);
    expect(dueMoments({ ...quiet, importHere: true, importMs: LONG_IMPORT_MS })).toEqual(['import']);
    expect(dueMoments({ ...quiet, importHere: true, importTotal: LONG_IMPORT_FILES })).toEqual(['import']);
    expect(dueMoments({ ...quiet, importHere: false, importMs: LONG_IMPORT_MS * 2 })).toEqual([]);
  });
  it('the first hand-off heard here, and an open room first of all', () => {
    expect(dueMoments({ ...quiet, handoffHeard: false })).toEqual([]);
    expect(dueMoments({ ...quiet, handoffHeard: true, roomOpen: true })).toEqual(['room', 'played']);
  });
});

describe('offerWords', () => {
  it('says SelectaDJ, makes no promise about speed, and has no em dash', () => {
    for (const moment of ['import', 'played', 'room'] as InstallMoment[]) {
      for (const how of ['prompt', 'home_screen'] as const) {
        const words = offerWords(moment, how);
        expect(words).not.toContain(String.fromCharCode(0x2014));
        expect(words).not.toMatch(/not yet|faster|full speed/i);
        if (how === 'prompt') expect(words).toContain('Install SelectaDJ');
        else expect(words).toContain('Add to Home Screen');
      }
    }
  });
});

describe('parseMemory', () => {
  it('starts a first visit from nothing or from anything unreadable', () => {
    expect(parseMemory(null, NOW)).toEqual({ firstSeen: NOW, shown: [], dismissed: [] });
    expect(parseMemory('{nope', NOW)).toEqual({ firstSeen: NOW, shown: [], dismissed: [] });
  });
  it('keeps only known moments', () => {
    expect(parseMemory(JSON.stringify({ firstSeen: 5, shown: ['room', 'other'], dismissed: ['room'] }), NOW)).toEqual({ firstSeen: 5, shown: ['room'], dismissed: ['room'] });
  });
});

describe('T-20261125-ae07 two tabs share one memory', () => {
  it('a merge keeps every offer shown and every Not now, and the earliest first visit', () => {
    const tabA = memory({ firstSeen: NOW - 5, shown: ['played'], dismissed: ['played'] });
    const tabB = memory({ firstSeen: NOW - 9, shown: ['room'], dismissed: [] });
    expect(mergeMemory(tabA, tabB)).toEqual({ firstSeen: NOW - 9, shown: ['played', 'room'], dismissed: ['played'] });
    expect(mergeMemory(tabB, tabA)).toEqual(mergeMemory(tabA, tabB));
  });

  it('two Not nows from two tabs end the offers for good once merged', () => {
    const merged = mergeMemory(memory({ dismissed: ['played'] }), memory({ dismissed: ['room'] }));
    expect(decideOffer('import', facts(), merged)).toBe('never');
  });
});
