import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { INDICATOR_CLASS, useSlidingIndicator } from './indicator';
import { resetFeel, startFeel } from './root';

/** FL-0477-06: the sliding indicator measures the chosen child and writes where it is on the
 * strip, only while motion is on. The choice itself is always carried by aria-selected. */

const BOXES: Record<string, { left: number; top: number; width: number; height: number }> = {
  strip: { left: 10, top: 20, width: 300, height: 40 },
  One: { left: 10, top: 20, width: 80, height: 40 },
  Two: { left: 90, top: 20, width: 120, height: 40 },
};

function Tabs() {
  const strip = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState('One');
  useSlidingIndicator(strip, '[aria-selected="true"]');
  return (
    <div ref={strip} role="tablist" data-box="strip">
      {['One', 'Two'].map((name) => (
        <button key={name} role="tab" data-box={name} aria-selected={chosen === name} onClick={() => setChosen(name)}>{name}</button>
      ))}
      <span className={INDICATOR_CLASS} aria-hidden="true" />
    </div>
  );
}

let stop: () => void = () => undefined;
const flush = () => act(() => new Promise<void>((resolve) => { setTimeout(resolve, 0); }));

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  resetFeel();
  stop = startFeel();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function width(this: HTMLElement) {
    return BOXES[this.dataset.box ?? '']?.width ?? 0;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    const box = BOXES[(this as HTMLElement).dataset?.box ?? ''] ?? { left: 0, top: 0, width: 0, height: 0 };
    return { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
  });
});

afterEach(() => {
  stop();
  resetFeel();
});

describe('FL-0477-06 the sliding indicator', () => {
  it('places the mark under the chosen tab, then follows a new choice', async () => {
    render(<Tabs />);
    const strip = screen.getByRole('tablist');
    expect(strip.style.getPropertyValue('--ind-x')).toBe('0.0px');
    expect(strip.style.getPropertyValue('--ind-w')).toBe('80.0');
    expect(strip.style.getPropertyValue('--ind-h')).toBe('40.0');
    expect(strip.dataset.indicator).toBe('placed');
    fireEvent.click(screen.getByRole('tab', { name: 'Two' }));
    await flush();
    expect(strip.style.getPropertyValue('--ind-x')).toBe('80.0px');
    expect(strip.style.getPropertyValue('--ind-w')).toBe('120.0');
    // the choice is still carried by the tab itself
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
  });

  it('measures nothing without motion, and clears itself when motion goes', () => {
    setPrefs({ motion: 'still' });
    const { unmount } = render(<Tabs />);
    const strip = screen.getByRole('tablist');
    expect(strip.style.getPropertyValue('--ind-w')).toBe('');
    expect(strip.dataset.indicator).toBeUndefined();
    act(() => setPrefs({ motion: 'expressive' }));
    expect(strip.style.getPropertyValue('--ind-w')).toBe('80.0');
    act(() => setPrefs({ motion: 'still' }));
    expect(strip.style.getPropertyValue('--ind-w')).toBe('');
    unmount();
  });

  it('draws no mark for a hidden choice, and clears on unmount', () => {
    const { unmount } = render(<Tabs />);
    const strip = screen.getByRole('tablist');
    expect(strip.style.getPropertyValue('--ind-w')).toBe('80.0');
    unmount();
    expect(strip.style.getPropertyValue('--ind-w')).toBe('');
    expect(strip.dataset.indicator).toBeUndefined();

    BOXES.One = { ...BOXES.One, width: 0 };
    render(<Tabs />);
    expect(screen.getByRole('tablist').style.getPropertyValue('--ind-w')).toBe('');
    BOXES.One = { ...BOXES.One, width: 80 };
  });
});
