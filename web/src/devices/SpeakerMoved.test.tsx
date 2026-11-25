import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOVED_MS, SpeakerMoved, useSpeakerMove } from './SpeakerMoved';

vi.mock('../rooms/feelHooks', () => ({ useFeelPart: () => true }));

// ADR-0477: a pulse from the old speaker to the new one, only when the sound really moved

describe('the speaker move', () => {
  afterEach(() => vi.useRealTimers());

  it('learns the first speaker without calling it a move, then says a real change for a moment', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ id, name }) => useSpeakerMove(id, name), { initialProps: { id: 'laptop' as string | null, name: 'Laptop' as string | null } });
    expect(result.current).toBeNull();
    rerender({ id: 'laptop', name: 'Laptop' });
    expect(result.current).toBeNull();
    rerender({ id: 'kitchen', name: 'Kitchen' });
    expect(result.current).toMatchObject({ from: 'Laptop', to: 'Kitchen' });
    act(() => { vi.advanceTimersByTime(MOVED_MS); });
    expect(result.current).toBeNull();
  });

  it('does not call a speaker going away a move', () => {
    const { result, rerender } = renderHook(({ id }) => useSpeakerMove(id, 'Laptop'), { initialProps: { id: 'laptop' as string | null } });
    rerender({ id: null });
    expect(result.current).toBeNull();
  });

  it('says the move in words, with the chips and the pulse hidden from a screen reader', () => {
    render(<SpeakerMoved move={{ from: 'Laptop', to: 'Kitchen', at: 1 }} />);
    const line = screen.getByTestId('speaker-moved');
    expect(line).toHaveTextContent('The music moved from Laptop to Kitchen.');
    for (const part of line.querySelectorAll('.speaker-chip, .speaker-moved-track')) expect(part.getAttribute('aria-hidden')).toBe('true');
  });
});
