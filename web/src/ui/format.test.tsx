import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { countOf, ELLIPSIS, ellipsize, relativeTime, Truncate } from './format';
import { BrandMark } from './BrandMark';
import { VisuallyHidden, VISUALLY_HIDDEN } from './primitives';

describe('how times, counts and long names are said', () => {
  it('says a time in words in the reader’s language', () => {
    expect(relativeTime(5, { locale: 'en-GB' })).toBe('just now');
    expect(relativeTime(4 * 60, { locale: 'en-GB' })).toBe('4 minutes ago');
    expect(relativeTime(2 * 3600, { locale: 'en-US' })).toBe('2 hours ago');
    expect(relativeTime(26 * 3600, { locale: 'en-GB' })).toBe('yesterday');
    expect(relativeTime(-2 * 3600, { locale: 'en-GB' })).toBe('in 2 hours');
    expect(relativeTime(3 * 60, { locale: 'de' })).toBe('vor 3 Minuten');
    expect(relativeTime(Number.NaN, { locale: 'en-GB' })).toBe('just now');
  });

  it('counts with the right word', () => {
    expect(countOf(1, 'song', undefined, 'en-GB')).toBe('1 song');
    expect(countOf(3, 'song', undefined, 'en-GB')).toBe('3 songs');
    expect(countOf(2898, 'song', undefined, 'en-GB')).toBe('2,898 songs');
    expect(countOf(2, 'person', 'people', 'en-GB')).toBe('2 people');
    expect(countOf(0, 'guest', undefined, 'en-GB')).toBe('0 guests');
  });

  it('uses the one ellipsis character', () => {
    expect(ELLIPSIS).toBe('…');
    expect(ellipsize('Short', 10)).toBe('Short');
    expect(ellipsize('A very long song title', 8)).toBe(`A very${ELLIPSIS}`);
    expect(ellipsize('anything', 0)).toBe('');
  });

  it('keeps a cut-off name whole for hover and reads it in its own direction', () => {
    render(<Truncate text="Ya Rayah (Live)" className="row-title" />);
    const name = screen.getByText('Ya Rayah (Live)');
    expect(name).toHaveAttribute('title', 'Ya Rayah (Live)');
    expect(name).toHaveAttribute('dir', 'auto');
    expect(name).toHaveClass('truncate', 'row-title');
    expect(name.style.textOverflow).toBe('ellipsis');
  });

  it('never lets the brand mark be read out', () => {
    const { container } = render(<BrandMark className="cloud-mark" />);
    const mark = container.querySelector('.brand-mark-badge')!;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveClass('cloud-mark');
    expect(mark).toHaveTextContent('S');
  });

  it('hides words from the eye, never from a screen reader', () => {
    render(<VisuallyHidden as="h2">Now playing</VisuallyHidden>);
    expect(screen.getByRole('heading', { name: 'Now playing' })).toHaveClass(VISUALLY_HIDDEN);
  });
});
