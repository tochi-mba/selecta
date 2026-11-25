import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongDetail } from '../api';
import { setFlags } from '../flags';

// Plan 3.4 lyrics: with motion on, the sung line is its own element and the words already sung are
// lit where word timing exists; with motion off (Still, reduced motion) it is the plain highlight.

const feel = vi.hoisted(() => ({ moving: true }));
vi.mock('./feelBits', () => ({ useFeelPart: () => feel.moving, springOf: () => 'ease-out' }));

import { highlightedLine, Lyrics } from './ListenLyrics';

afterEach(() => {
  cleanup();
  setFlags(null);
  feel.moving = true;
});

const words = [{ start: 10, end: 10.5, text: 'one' }, { start: 10.5, end: 11, text: 'two' }, { start: 11, end: 11.5, text: 'three' }];
const detail = (timed: boolean) => ({
  id: 1, artist: 'A', title: 'T', duration: 200, bpm: 0, key: '', peaks: [], sections: [], lyric_status: 'synced',
  lines: [{ start: 2, end: 6, text: 'before it' }, { start: 10, end: 12, text: 'one two three', ...(timed ? { words } : {}) }, { start: 14, end: 16, text: 'after it' }],
}) as unknown as SongDetail;

describe('lyrics that follow the song', () => {
  it('lights the words already sung, the one being sung, and leaves the rest', () => {
    setFlags({ 'listen.word_focus': true });
    const { container } = render(<Lyrics detail={detail(true)} time={11.2} />);
    const line = container.querySelector('p[data-lyric="current"]');
    expect(line?.getAttribute('data-words')).toBe('timed');
    expect([...line!.querySelectorAll('span')].map((span) => span.className)).toEqual(['sung-word', 'sung-word', 'current-word']);
    expect(container.querySelector('p[data-lyric="previous"]')?.textContent).toBe('before it');
  });

  it('claims no word timing a line does not have', () => {
    setFlags({ 'listen.word_focus': true });
    const { container } = render(<Lyrics detail={detail(false)} time={11.2} />);
    expect(container.querySelector('p[data-lyric="current"]')?.hasAttribute('data-words')).toBe(false);
    expect(container.querySelector('.sung-word, .current-word')).toBeNull();
  });

  it('is the plain current-line highlight with motion off', () => {
    setFlags({ 'listen.word_focus': true });
    feel.moving = false;
    const { container } = render(<Lyrics detail={detail(true)} time={11.2} />);
    expect(container.querySelector('[data-lyric], [data-words], .sung-word')).toBeNull();
    expect(container.querySelector('p.sung .current-word')?.textContent).toBe('three');
  });

  it('marks only words, before the one being sung', () => {
    render(<p>{highlightedLine('one, two three', 2, 2)}</p>);
    expect([...document.querySelectorAll('span')].map((span) => `${span.textContent}:${span.className}`)).toEqual(['one:sung-word', 'two:sung-word', 'three:current-word']);
  });
});
