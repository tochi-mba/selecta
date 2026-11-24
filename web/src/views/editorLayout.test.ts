import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPACT, layoutFor, NARROWER, SHORT, WIDE } from './editorLayout';

/** editor.phone_layout: the layout comes from the window's size alone, and each layout needs its own
 * media query to say yes, so a page that can't answer keeps the editor as it was. */
const windowMatching = (...yes: string[]) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: yes.includes(query), addEventListener: () => {}, removeEventListener: () => {} }));

afterEach(() => vi.unstubAllGlobals());

describe('the editor layout for a window', () => {
  it('uses the canonical phone and laptop breakpoints', () => {
    expect(COMPACT).toBe('(max-width: 640px) and (min-height: 500px)');
    expect(NARROWER).toBe('(max-width: 1100px)');
    expect(WIDE).toBe('(min-width: 1101px)');
  });

  it('a phone held upright gets the list with sheets', () => {
    windowMatching(COMPACT, NARROWER);
    expect(layoutFor(true)).toBe('sheet');
  });

  it('a phone on its side, a tablet and a small laptop get two panes', () => {
    windowMatching(SHORT, NARROWER);
    expect(layoutFor(true)).toBe('panes');
    windowMatching(NARROWER);
    expect(layoutFor(true)).toBe('panes');
  });

  it('a wide window keeps the classic editor where the transition inspector fits beside it', () => {
    windowMatching(WIDE);
    expect(layoutFor(true)).toBe('classic');
  });

  it('a wide window without the inspector (a browser mix) gets two panes', () => {
    windowMatching(WIDE);
    expect(layoutFor(false)).toBe('panes');
  });

  it('no answer from the window keeps the editor as it was', () => {
    windowMatching();
    expect(layoutFor(false)).toBe('classic');
    vi.stubGlobal('matchMedia', undefined);
    expect(layoutFor(false)).toBe('classic');
  });
});
