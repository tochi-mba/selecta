import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { matchParts, Matched, swipeOffset, SWIPE_DETENT } from './feelLibrary';

// Plan 3.6: a search's matched words are marked in the row, and a phone row follows the finger up to
// a detent, then slows. Neither changes what the row says.

describe('matched search words', () => {
  it('marks every match, ignoring case, and keeps the rest of the words in order', () => {
    expect(matchParts('Blue Monday (Blue mix)', 'blue')).toEqual([
      { text: 'Blue', hit: true },
      { text: ' Monday (', hit: false },
      { text: 'Blue', hit: true },
      { text: ' mix)', hit: false },
    ]);
  });

  it('marks each word of the search, and ignores one-letter words', () => {
    expect(matchParts('Night Drive', 'drive a night').filter((part) => part.hit).map((part) => part.text)).toEqual(['Night', 'Drive']);
  });

  it('marks nothing with no search, or no match', () => {
    expect(matchParts('Night Drive', '')).toEqual([{ text: 'Night Drive', hit: false }]);
    expect(matchParts('Night Drive', 'zz')).toEqual([{ text: 'Night Drive', hit: false }]);
  });

  it('draws the plain text when nothing is asked to be marked, as before the feel', () => {
    const { container } = render(<p><Matched text="Night Drive" mark="" /></p>);
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe('Night Drive');
  });

  it('draws marks that leave the words themselves unchanged', () => {
    const { container } = render(<p><Matched text="Night Drive" mark="drive" /></p>);
    expect(container.querySelector('mark.feel-match')?.textContent).toBe('Drive');
    expect(container.textContent).toBe('Night Drive');
  });
});

describe('a swiped row', () => {
  it('follows the finger to the detent, then at a third of the pace, never past its limit', () => {
    expect(swipeOffset(40)).toBe(40);
    expect(swipeOffset(-SWIPE_DETENT)).toBe(-SWIPE_DETENT);
    expect(swipeOffset(SWIPE_DETENT + 30)).toBeCloseTo(SWIPE_DETENT + 10);
    expect(swipeOffset(1000)).toBeCloseTo(SWIPE_DETENT * 1.4);
    expect(swipeOffset(-1000)).toBeCloseTo(-SWIPE_DETENT * 1.4);
  });
});
