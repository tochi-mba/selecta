import { describe, expect, it } from 'vitest';
import { analysingWords, askedToAnalyse, clock, gb, length, loadResume, runningTime, saveResume, seamStatusWords, storageWords, triedWords } from './lib';
import { seam, songs } from './test/backend';

describe('words on screen', () => {
  it('writes times the way people read them', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(null)).toBe('–:––');
    expect(length(3900)).toBe('1 hr 5 min');
    expect(gb(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });

  it('says a seam that hasn’t started is waiting, since the mix renders by itself', () => {
    expect(seamStatusWords('none')).toBe('Waiting to render');
    expect(seamStatusWords('queued')).toBe('Waiting to render');
    expect(seamStatusWords('rendering')).toBe('Rendering…');
    expect(seamStatusWords('ready', true)).toBe('Ready');
    expect(seamStatusWords('ready', false)).toBe('Ready, with a warning');
    expect(seamStatusWords('failed')).toBe('Can’t do this one');
  });

  it('shows each song’s place in the analysis line', () => {
    expect(analysingWords([], 7)).toBe('Analyse now');
    expect(analysingWords([7, 8, 9], 7)).toBe('Analysing…');
    expect(analysingWords([7, 8, 9], 9)).toBe('Waiting, 2 ahead');
    expect(askedToAnalyse('Hello', 0)).toContain('Analysing Hello');
    expect(askedToAnalyse('Hello', 3)).toBe('Hello is in line, with 3 ahead of it.');
  });

  it('separates what Selecta keeps from what it can make again', () => {
    const words = storageWords({
      used_bytes: 4.2 * 1024 ** 3,
      kept_bytes: 3.2 * 1024 ** 3,
      cache_bytes: 1024 ** 3,
      free_bytes: 13 * 1024 ** 3,
      budget_bytes: 1024 ** 3,
      largest_budget_bytes: 1024 ** 3,
      smallest_budget_bytes: 1024 ** 3,
      total_bytes: 1024 ** 4,
    });
    expect(words.summary).toBe('Selecta is using 4.2 GB. Your drive has 13 GB free.');
    expect(words.detail).toContain('1.0 GB of that is separated vocals');
    expect(words.detail).toContain('3.2 GB is song analysis and models');
  });
});

describe('running time', () => {
  it('uses what finished seams say exactly', () => {
    const mix = songs(seam('ready', 'a', { a_source_start: 150, b_source_end: 20, duration: 30 }));
    expect(runningTime(mix)).toBe(150 + 30 + (200 - 20));
  });
});

describe('resuming', () => {
  const mix = songs(seam('none', 'a'), seam('none', 'b'));

  it('picks up where it left off', () => {
    saveResume({ songId: 2, position: 1, time: 42 });
    expect(loadResume(mix)).toEqual({ songId: 2, position: 1, time: 42 });
  });

  it('ignores a saved place when that song has moved', () => {
    saveResume({ songId: 9, position: 1, time: 42 });
    expect(loadResume(mix)).toBeNull();
  });

  it('never offers a time past the end of the song: it goes on to the next one', () => {
    saveResume({ songId: 1, position: 0, time: 242 });
    expect(loadResume(mix)).toEqual({ songId: 2, position: 1, time: 0 });
  });

  it('has nothing to offer past the end of the last song', () => {
    saveResume({ songId: 3, position: 2, time: 500 });
    expect(loadResume(mix)).toBeNull();
  });
});

describe('what was tried on a seam', () => {
  const names = { filter_sweep: 'Filter sweep', bass_swap_blend: 'Blend', tempo_ramp: 'Tempo ramp' };

  it('says each reason once, with one full stop', () => {
    const far = 'The songs are 45% apart in tempo, too far to play together.';
    expect(
      triedWords(
        [
          { move: 'filter_sweep', why: far },
          { move: 'bass_swap_blend', why: far },
          { move: 'tempo_ramp', why: 'A 45% tempo gap is too wide' },
        ],
        names,
      ),
    ).toEqual([
      'Filter sweep and Blend couldn’t work here. The songs are 45% apart in tempo, too far to play together.',
      'Tempo ramp couldn’t work here. A 45% tempo gap is too wide.',
    ]);
  });

  it('has nothing to say when nothing went wrong', () => {
    expect(triedWords([], names)).toEqual([]);
  });
});
