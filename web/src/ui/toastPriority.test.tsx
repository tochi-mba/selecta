import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearToasts, showProblem, showToast, Toaster } from './toasts';

/** UF-0371-07: a problem in the foreground outlasts background completion news. Routine messages make
 * room before a problem does, and repeats of routine news never stack up. */

beforeEach(() => clearToasts());

describe('calm live feedback', () => {
  it('a burst of completions never pushes a problem off the screen', () => {
    render(<Toaster />);
    act(() => {
      showProblem('Couldn’t save that change.');
      for (const word of ['Analysed song 1.', 'Analysed song 2.', 'Analysed song 3.', 'Analysed song 4.']) showToast(word);
    });
    expect(screen.getByText('Couldn’t save that change.')).toBeInTheDocument();
    expect(document.body.querySelectorAll('.toast-row')).toHaveLength(3);
    expect(screen.queryByText('Analysed song 1.')).toBeNull();
  });

  it('the same background update twice is said once', () => {
    render(<Toaster />);
    act(() => {
      showToast('Transitions are ready.');
      showToast('Transitions are ready.');
    });
    expect(screen.getAllByText('Transitions are ready.')).toHaveLength(1);
  });

  it('with only problems on screen, the oldest problem makes room, never the newest', () => {
    render(<Toaster />);
    act(() => {
      for (const word of ['First problem.', 'Second problem.', 'Third problem.', 'Fourth problem.']) showProblem(word);
    });
    expect(screen.queryByText('First problem.')).toBeNull();
    expect(screen.getByText('Fourth problem.')).toBeInTheDocument();
  });
});
