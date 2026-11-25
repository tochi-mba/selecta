import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { reloadPrefs } from '../state/prefs';
import { CoverArt } from '../views/CoverArt';
import { artHue, endTravel, mixHue, publishAmbientHue, resetAmbient, travelAmbient, TRAVEL_STEP_MS } from './hue';

/** FL-0477-04: the ambient hue is the cover tile's own hue, published as one bare number on the
 * page root once per song, and travelled during a hand-over on the ambient layer alone. */

const html = document.documentElement;
const layer = () => document.querySelector<HTMLElement>('.ambient-layer');

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  resetAmbient();
});

afterEach(() => {
  resetAmbient();
});

describe('FL-0477-04 artHue', () => {
  it('is stable, whole and inside the colour wheel', () => {
    for (const seed of ['Song A', 42, '', 'a much longer title with words', 'été']) {
      const hue = artHue(seed);
      expect(hue).toBe(artHue(seed));
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
    expect(artHue(7)).toBe(artHue('7'));
    expect(artHue('Song A')).not.toBe(artHue('Song B'));
  });

  it('matches the hue the cover tile is drawn in for the same seed', () => {
    for (const seed of ['Song A', 1234, 'Night Drive']) {
      const { container, unmount } = render(<CoverArt seed={seed} />);
      const tile = container.querySelector<HTMLElement>('.cover-art')!;
      expect(tile.style.getPropertyValue('--art-hue')).toBe(String(artHue(seed)));
      unmount();
    }
  });

  it('mixes the short way round the wheel', () => {
    expect(mixHue(350, 10, 0.5)).toBe(0);
    expect(mixHue(10, 350, 0.5)).toBe(0);
    expect(mixHue(100, 200, 0)).toBe(100);
    expect(mixHue(100, 200, 1)).toBe(200);
  });
});

describe('FL-0477-04 publishAmbientHue', () => {
  it('writes the hue as a bare number while ambient is on, with one decorative layer', () => {
    publishAmbientHue(200);
    expect(html.style.getPropertyValue('--ambient-hue')).toBe('200');
    expect(layer()).not.toBeNull();
    expect(layer()).toHaveAttribute('aria-hidden', 'true');
    publishAmbientHue(-30);
    expect(html.style.getPropertyValue('--ambient-hue')).toBe('330');
    publishAmbientHue(10);
    expect(document.querySelectorAll('.ambient-layer')).toHaveLength(1);
  });

  it('clears the hue and removes the layer when nothing plays', () => {
    publishAmbientHue(120);
    publishAmbientHue(null);
    expect(html.style.getPropertyValue('--ambient-hue')).toBe('');
    expect(layer()).toBeNull();
  });

  it('writes nothing with ambient off, and clears what was there', () => {
    publishAmbientHue(120);
    setFlags({ 'app.feel_ambient': false });
    publishAmbientHue(150);
    expect(html.style.getPropertyValue('--ambient-hue')).toBe('');
    expect(layer()).toBeNull();
  });

  it('is off in low power, since ambient travel is a costly part', () => {
    html.dataset.lowPower = 'lite';
    publishAmbientHue(90);
    expect(html.style.getPropertyValue('--ambient-hue')).toBe('');
    delete html.dataset.lowPower;
  });
});

describe('FL-0477-04 travelAmbient', () => {
  it('writes on the ambient layer only, never on the page root', () => {
    publishAmbientHue(100);
    const rootWrites = vi.spyOn(html.style, 'setProperty');
    travelAmbient(100, 200, 0.5, 1000);
    expect(layer()!.style.getPropertyValue('--ambient-hue')).toBe('150');
    expect(rootWrites).not.toHaveBeenCalled();
    expect(html.style.getPropertyValue('--ambient-hue')).toBe('100');
  });

  it('writes at most once every TRAVEL_STEP_MS', () => {
    publishAmbientHue(0);
    travelAmbient(0, 100, 0.1, 1000);
    travelAmbient(0, 100, 0.5, 1000 + TRAVEL_STEP_MS - 1);
    expect(layer()!.style.getPropertyValue('--ambient-hue')).toBe('10');
    travelAmbient(0, 100, 0.5, 1000 + TRAVEL_STEP_MS);
    expect(layer()!.style.getPropertyValue('--ambient-hue')).toBe('50');
  });

  it('hands the layer back to the published hue when the hand-over ends', () => {
    publishAmbientHue(0);
    travelAmbient(0, 100, 0.5, 5000);
    endTravel();
    expect(layer()!.style.getPropertyValue('--ambient-hue')).toBe('');
    travelAmbient(0, 100, 0.8, 5001);
    // the throttle starts over after a hand-over ends
    expect(layer()!.style.getPropertyValue('--ambient-hue')).toBe('80');
  });

  it('does nothing with ambient off', () => {
    setFlags({ 'app.feel_ambient': false });
    travelAmbient(0, 100, 0.5, 1000);
    expect(layer()).toBeNull();
  });
});
