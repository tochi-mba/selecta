import { describe, expect, it } from 'vitest';
import { batchLines, batchWords } from './libraryBatchWords';

// The batch dialog read like a developer tool ("precisely 18 recordings", "(ID 3091; priority
// off; excluded no)", "Cancel - change nothing"). These are its words now.

describe('the Library batch dialog in plain words', () => {
  it('Never play, for many songs and for one', () => {
    expect(batchWords('never', 18)).toEqual({
      title: 'Never play 18 songs?',
      body: 'SelectaDJ won’t pick these songs when it builds a mix. You can still add them by hand, and change this any time.',
      confirm: 'Never play 18 songs',
      done: '18 songs won’t be picked for mixes.',
    });
    expect(batchWords('never', 1)).toEqual({
      title: 'Never play 1 song?',
      body: 'SelectaDJ won’t pick this song when it builds a mix. You can still add it by hand, and change this any time.',
      confirm: 'Never play 1 song',
      done: '1 song won’t be picked for mixes.',
    });
  });

  it('has matching titles for Allow, Prioritize and Remove priority', () => {
    expect(batchWords('allow', 2).title).toBe('Allow 2 songs in mixes?');
    expect(batchWords('prioritize', 2).title).toBe('Prioritize 2 songs?');
    expect(batchWords('deprioritize', 1).title).toBe('Remove priority from 1 song?');
    expect(batchWords('deprioritize', 1).done).toBe('1 song no longer has priority.');
    for (const action of ['never', 'allow', 'prioritize', 'deprioritize'] as const) {
      const words = Object.values(batchWords(action, 3)).join(' ');
      expect(words).not.toMatch(/precisely|recording|ID |2014/);
    }
  });

  it('lists songs as "Title, Artist", with an ID only where two listed songs share both', () => {
    expect(batchLines([
      { id: 10, title: 'Same Name', artist: 'Hal Greene' },
      { id: 11, title: 'Same Name', artist: 'Iris Vale' },
      { id: 12, title: 'Same Name', artist: 'Iris Vale' },
    ]).map((entry) => entry.line)).toEqual([
      'Same Name, Hal Greene',
      'Same Name, Iris Vale (ID 11)',
      'Same Name, Iris Vale (ID 12)',
    ]);
  });
});
