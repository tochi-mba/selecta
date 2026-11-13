import { describe, expect, it } from 'vitest';
import { analysingWords, analysisWords, askedToAnalyse, clock, draftWords, estimateWords, etaRangeWords, etaWords, gb, length, loadResume, nth, runningTime, saveResume, seamStatusWords, storageWords, triedWords } from './lib';
import { seam, songs } from './test/backend';

describe('words on screen', () => {
  it('writes times the way people read them', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(null)).toBe('–:––');
    expect(length(3900)).toBe('1 hr 5 min');
    expect(gb(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });

  it('says a seam that hasn’t started is waiting, since the mix renders by itself', () => {
    expect(seamStatusWords('none')).toBe('Not rendered yet');
    expect(seamStatusWords('queued')).toBe('In line');
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

  it('separates what SelectaDJ keeps from what it can make again', () => {
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
    expect(words.summary).toBe('SelectaDJ is using 4.20 GB. Your drive has 13 GB free.');
    expect(words.detail).toContain('1.00 GB of that is separated vocals');
    expect(words.detail).toContain('3.20 GB is saved data and models');
  });

  it('uses enough precision for the displayed storage parts to add up to the total', () => {
    const words = storageWords({
      used_bytes: 7.44 * 1024 ** 3,
      kept_bytes: 0.38 * 1024 ** 3,
      cache_bytes: 7.06 * 1024 ** 3,
      free_bytes: 56 * 1024 ** 3,
      budget_bytes: 8 * 1024 ** 3,
      largest_budget_bytes: 8 * 1024 ** 3,
      smallest_budget_bytes: 0.5 * 1024 ** 3,
      total_bytes: 64 * 1024 ** 3,
    });

    expect(words.summary).toContain('using 7.44 GB');
    expect(words.detail).toContain('7.06 GB of that');
    expect(words.detail).toContain('other 0.38 GB');
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

describe('how long things will take', () => {
  it.each([
    [0, 'a few seconds'],
    [14, 'a few seconds'],
    [15, 'under a minute'],
    [44, 'under a minute'],
    [45, 'about a minute'],
    [89, 'about a minute'],
    [90, 'about 2 minutes'],
    [240, 'about 4 minutes'],
    [599, 'about 10 minutes'],
    [600, 'about 10 minutes'],
    [1320, 'about 20 minutes'],
    [3299, 'about 55 minutes'],
    [3300, 'about an hour'],
    [5399, 'about an hour'],
    [5400, 'about 1.5 hours'],
    [14400, 'about 4 hours'],
  ])('%i seconds reads as %s', (seconds, words) => {
    expect(etaWords(seconds)).toBe(words);
  });

  it('never gets longer as a wait counts down', () => {
    const minutes = (words: string) => {
      if (words === 'a few seconds') return 0.1;
      if (words === 'under a minute') return 0.5;
      const number = Number(/[\d.]+/.exec(words)?.[0] ?? 1);
      return words.includes('hour') ? number * 60 : number;
    };
    let last = Infinity;
    for (let seconds = 20000; seconds >= 0; seconds -= 7) {
      const now = minutes(etaWords(seconds));
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
  });

  it('says nothing when there is nothing to go on', () => {
    expect(etaWords(undefined)).toBe('');
    expect(etaWords(null)).toBe('');
    expect(etaWords(Number.NaN)).toBe('');
    expect(etaRangeWords(undefined)).toBe('');
  });

  it('gives a range only when it is honestly unsure', () => {
    expect(etaRangeWords({ seconds: 300, low: 240, high: 360 })).toBe('about 5 minutes');
    expect(etaRangeWords({ seconds: 360, low: 120, high: 600 })).toBe('2 to 10 minutes');
    expect(etaRangeWords({ seconds: 14400, low: 7200, high: 25200 })).toBe('2 to 7 hours');
    expect(etaRangeWords({ seconds: 50, low: 5, high: 100 })).toBe('about a minute');
  });

  it('says when a job has run long rather than counting down to nothing', () => {
    expect(etaRangeWords({ seconds: 5, low: 3, high: 8, late: true })).toBe('taking longer than usual');
  });

  it('explains what analysis is waiting for', () => {
    expect(analysisWords({ seconds: 3600, low: 3000, high: 4200, after_mix: true })).toContain('waits for rendering');
    expect(analysisWords({ seconds: 3600, low: 3000, high: 4200, after_mix: false })).toBe('It takes about an hour in the background.');
    expect(analysisWords(undefined)).toBe('It runs in the background.');
  });

  it('quotes the real wait when a song joins the analysis line', () => {
    expect(askedToAnalyse('Hello', 2, 240)).toBe('Hello is in line, with 2 ahead of it. Ready in about 4 minutes.');
    expect(askedToAnalyse('Hello', 0, 40)).toBe('Analysing Hello. Ready in under a minute.');
  });
});

describe('where a draft has got to', () => {
  const draft = { songs: 12, seams: 11, ready: 0, failed: 0, waiting: 11, rendering: false, place: null as number | null, eta: null as { seconds: number; low: number; high: number } | null };
  it('names the places in line', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(nth)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
  });
  it('says when there is nothing to render yet', () => {
    expect(draftWords({ ...draft, songs: 0, seams: 0, waiting: 0 })).toBe('Empty');
    expect(draftWords({ ...draft, songs: 1, seams: 0, waiting: 0 })).toBe('Add one more song');
  });
  it('says when it is ready, and is honest about seams that failed', () => {
    expect(draftWords({ ...draft, ready: 11, waiting: 0 })).toBe('Ready to play');
    expect(draftWords({ ...draft, ready: 10, failed: 1, waiting: 0 })).toBe('10 of 11 ready, 1 couldn’t be made');
    expect(draftWords({ ...draft, ready: 3, failed: 1, waiting: 7, place: 1, rendering: true })).toBe('Rendering other transitions. 3 of 11 ready, 1 couldn’t be made; 7 still waiting');
    expect(draftWords({ ...draft, ready: 3, failed: 1, waiting: 7, place: 2 })).toBe('Other transitions are in line. 3 of 11 ready, 1 couldn’t be made; 7 still waiting');
  });
  it('only quotes a time once it is in line', () => {
    expect(draftWords({ ...draft, ready: 3, waiting: 8 })).toBe('3 of 11 ready');
    expect(draftWords({ ...draft, ready: 3, waiting: 8, place: 2, eta: { seconds: 600, low: 500, high: 700 } })).toBe('3 of 11 ready. All ready in about 10 minutes');
    expect(draftWords({ ...draft, ready: 3, waiting: 8, place: 1, rendering: true, eta: { seconds: 240, low: 200, high: 300 } })).toBe('Rendering now. 3 of 11 ready, about 4 minutes left');
  });
});

describe('how far out estimates have been', () => {
  it('waits until there is enough to say', () => {
    expect(estimateWords(undefined)).toBe('');
    expect(estimateWords({ jobs: 0, typical_miss: null })).toBe('');
    expect(estimateWords({ jobs: 4, typical_miss: 1.3 })).toBe('');
  });
  it('says how far out they have really been', () => {
    expect(estimateWords({ jobs: 20, typical_miss: 1.3 })).toContain('about 30%');
    expect(estimateWords({ jobs: 20, typical_miss: 1.05 })).toBe('Time estimates have been close lately.');
  });
});
