import { afterEach, describe, expect, it } from 'vitest';
import { activityEntries } from '../state/activity';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { clearToasts, setToastsQuiet, showProblem, showToast, Toaster } from './toasts';

/** S3-0051-04: on the Stage only a real problem interrupts; everything else still lands in Activity,
 * stacking stays bounded, and the same routine words are said once. */

afterEach(() => act(() => clearToasts()));

const shown = () => [...document.querySelectorAll('.toast-row > span')].map((item) => item.textContent);

describe('notifications on the Stage', () => {
  it('keeps only problems in front, while every message is still kept in Activity', () => {
    render(createElement(Toaster));
    act(() => {
      showToast('Saved.');
      showProblem('That transition could not be made.');
      setToastsQuiet(true);
    });
    expect(shown()).toEqual(['That transition could not be made.']);
    act(() => {
      showToast('Added to the mix.', { undo: () => {} });
      showProblem('The server stopped answering.');
    });
    expect(shown()).toEqual(['That transition could not be made.', 'The server stopped answering.']);
    expect(activityEntries().map((entry) => entry.message)).toEqual(expect.arrayContaining(['Saved.', 'Added to the mix.', 'The server stopped answering.']));
    act(() => {
      setToastsQuiet(false);
      showToast('Back from the Stage.');
    });
    expect(shown()).toContain('Back from the Stage.');
  });

  it('never stacks more than three, and says routine words once', () => {
    render(createElement(Toaster));
    act(() => { for (const word of ['One.', 'Two.', 'Three.', 'Four.', 'Four.']) showToast(word); });
    expect(shown()).toEqual(['Two.', 'Three.', 'Four.']);
  });
});
