import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { useReducedMotion } from './useReducedMotion';

function Probe() {
  return <span>{useReducedMotion() ? 'Still' : 'Animated'}</span>;
}

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
});
afterEach(() => vi.unstubAllGlobals());

describe('motion priority', () => {
  it('lets Still disable visual effects without changing the OS preference', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<Probe />);
    expect(screen.getByText('Animated')).toBeInTheDocument();
    act(() => setPrefs({ motion: 'still' }));
    expect(screen.getByText('Still')).toBeInTheDocument();
    act(() => setPrefs({ motion: 'subtle' }));
    expect(screen.getByText('Animated')).toBeInTheDocument();
  });

  it('honours the operating system even when Expressive is selected', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    setPrefs({ motion: 'expressive' });
    render(<Probe />);
    expect(screen.getByText('Still')).toBeInTheDocument();
  });
});
