import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setFlags } from '../flags';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { NumberRoll } from './numberRoll';
import { resetFeel, startFeel } from './root';

/** FL-0477-06: a rolling number is decoration over the real value. What is read out (and copied)
 * is always the final formatted value; without motion it is plain text. */

const words = (n: number) => `${n.toLocaleString('en-GB')} songs`;
let stop: () => void = () => undefined;

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  resetFeel();
  stop = startFeel();
});

afterEach(() => {
  stop();
  resetFeel();
});

describe('FL-0477-06 NumberRoll', () => {
  it('rolls digit strips that are hidden, and says the final value in words', () => {
    const { container, rerender } = render(<NumberRoll value={1234} format={words} />);
    expect(screen.getByText('1,234 songs')).toBeInTheDocument();
    const digits = container.querySelector('.number-roll-digits')!;
    expect(digits).toHaveAttribute('aria-hidden', 'true');
    const strips = [...container.querySelectorAll<HTMLElement>('.number-roll-strip')];
    expect(strips.map((strip) => strip.style.getPropertyValue('--digit'))).toEqual(['1', '2', '3', '4']);
    rerender(<NumberRoll value={1240} format={words} />);
    expect(screen.getByText('1,240 songs')).toBeInTheDocument();
    expect(screen.queryByText('1,234 songs')).toBeNull();
  });

  it('gives the element holding it the final value as its accessible name, with no digit noise', () => {
    const { rerender } = render(<button type="button"><NumberRoll value={1234} format={words} /></button>);
    expect(screen.getByRole('button')).toHaveAccessibleName('1,234 songs');
    rerender(<button type="button"><NumberRoll value={98765} format={words} /></button>);
    expect(screen.getByRole('button')).toHaveAccessibleName('98,765 songs');
  });

  it('is the plain value under Still, and when motion turns off while shown', () => {
    setPrefs({ motion: 'still' });
    const { container } = render(<NumberRoll value={56} format={words} />);
    expect(container.querySelector('.number-roll-digits')).toBeNull();
    expect(container.textContent).toBe('56 songs');
    act(() => setPrefs({ motion: 'expressive' }));
    expect(container.querySelector('.number-roll-digits')).not.toBeNull();
    act(() => setFlags({ 'app.feel_motion': false }));
    expect(container.querySelector('.number-roll-digits')).toBeNull();
    expect(container.textContent).toBe('56 songs');
  });

  it('keeps the class names given', () => {
    const { container } = render(<NumberRoll value={3} className="count" />);
    expect(container.firstElementChild).toHaveClass('number-roll', 'count');
  });
});
