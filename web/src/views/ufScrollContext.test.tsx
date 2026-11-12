import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, showProblem, Toaster } from '../ui/toasts';
import { useAnnouncer, useStickToBottom } from './LucyTranscript';

/** Where the window is scrolled to, and how tall the page is, for a jsdom that lays nothing out. */
function pageAt(scrollY: number, height: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: height });
}

describe('UF-0387-07 streaming and updates never take away your place', () => {
  let scrollTo: ReturnType<typeof vi.fn>;
  const real = window.scrollTo;

  beforeEach(() => {
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    pageAt(1200, 2000);
  });
  afterEach(() => {
    window.scrollTo = real;
    clearToasts();
  });

  it('follows new words while you are reading at the bottom', () => {
    const { rerender } = renderHook(({ text, count }) => useStickToBottom(text, count, true), {
      initialProps: { text: 'a', count: 1 },
    });
    scrollTo.mockClear();
    rerender({ text: 'a longer reply', count: 1 });
    expect(scrollTo).toHaveBeenCalledWith({ top: 2000 });
  });

  it('a finished conversation opens at its top, under its heading, not pulled down to the newest message', () => {
    pageAt(0, 3000);
    const { rerender } = renderHook(({ text, count, scope }) => useStickToBottom(text, count, true, scope), {
      initialProps: { text: '', count: 0, scope: 'c1' },
    });
    rerender({ text: 'twelve messages', count: 12, scope: 'c1' });
    expect(scrollTo).not.toHaveBeenCalled();
    // and opening another one from part way down the first starts it fresh too
    pageAt(2200, 3000);
    act(() => { window.dispatchEvent(new Event('scroll')); });
    pageAt(0, 4000);
    rerender({ text: 'another conversation', count: 20, scope: 'c2' });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('leaves you where you are once you scroll up, counts what is new, and takes you down only when asked', () => {
    const { result, rerender } = renderHook(({ text, count }) => useStickToBottom(text, count, true), {
      initialProps: { text: 'a', count: 1 },
    });
    pageAt(100, 2000);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    scrollTo.mockClear();
    rerender({ text: 'a, b', count: 2 });
    rerender({ text: 'a, b, c', count: 3 });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(result.current.fresh).toBe(2);

    act(() => result.current.jump());
    expect(scrollTo).toHaveBeenCalledWith({ top: 2000 });
    expect(result.current.fresh).toBe(0);
  });

  it('shows an error that arrives meanwhile without taking focus from what you were doing', () => {
    render(
      <>
        <button>Keep working</button>
        <Toaster />
      </>,
    );
    const working = screen.getByRole('button', { name: 'Keep working' });
    working.focus();
    act(() => {
      showProblem('Couldn’t save that.');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t save that.');
    expect(working).toHaveFocus();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('UF-0388-07 a long stream is announced at most once every two seconds', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gathers many updates into one sentence, and holds the next until two seconds have passed', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnnouncer());
    act(() => {
      for (let i = 0; i < 20; i += 1) result.current.say(['Lucy is writing']);
      result.current.say(['Rendering 3 of 8']);
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.words).toBe('Lucy is writing. Rendering 3 of 8.');

    act(() => {
      result.current.say(['Done']);
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.words).toBe('Lucy is writing. Rendering 3 of 8.');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current.words).toBe('Done.');
  });
});
