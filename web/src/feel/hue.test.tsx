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
  const incoming = () => document.querySelector<HTMLElement>('.ambient-layer[data-ambient="travel"] + .ambient-layer');

  it('writes on the ambient layers only, never on the page root', () => {
    publishAmbientHue(100);
    const rootWrites = vi.spyOn(html.style, 'setProperty');
    travelAmbient(100, 200, 0.5, 1000);
    expect(incoming()!.style.getPropertyValue('--ambient-hue')).toBe('200');
    expect(rootWrites).not.toHaveBeenCalled();
    expect(html.style.getPropertyValue('--ambient-hue')).toBe('100');
  });

  it('T-20261125-fec9: cross-fades two layers tinted once, so only opacity changes step to step', () => {
    publishAmbientHue(0);
    travelAmbient(0, 100, 0.25, 1000);
    const base = layer()!;
    const next = incoming()!;
    expect(base.style.getPropertyValue('--ambient-hue')).toBe('0');
    expect(next.style.getPropertyValue('--ambient-hue')).toBe('100');
    expect([base.style.opacity, next.style.opacity]).toEqual(['0.75', '0.25']);
    const baseWrites = vi.spyOn(base.style, 'setProperty');
    const nextWrites = vi.spyOn(next.style, 'setProperty');
    travelAmbient(0, 100, 0.75, 1000 + TRAVEL_STEP_MS);
    expect([base.style.opacity, next.style.opacity]).toEqual(['0.25', '0.75']);
    // no colour is written again during the hand-over
    expect(baseWrites).not.toHaveBeenCalledWith('--ambient-hue', expect.anything());
    expect(nextWrites).not.toHaveBeenCalledWith('--ambient-hue', expect.anything());
  });

  it('writes at most once every TRAVEL_STEP_MS', () => {
    publishAmbientHue(0);
    travelAmbient(0, 100, 0.1, 1000);
    travelAmbient(0, 100, 0.5, 1000 + TRAVEL_STEP_MS - 1);
    expect(incoming()!.style.opacity).toBe('0.1');
    travelAmbient(0, 100, 0.5, 1000 + TRAVEL_STEP_MS);
    expect(incoming()!.style.opacity).toBe('0.5');
  });

  it('hands the room back to the published hue when the hand-over ends', () => {
    publishAmbientHue(0);
    travelAmbient(0, 100, 0.5, 5000);
    endTravel();
    expect(document.querySelectorAll('.ambient-layer')).toHaveLength(1);
    expect(layer()!.style.getPropertyValue('--ambient-hue')).toBe('');
    expect(layer()!.style.opacity).toBe('');
    // the new hue is taken at once, not eased again after the fade showed it
    expect(layer()!.dataset.ambient).toBe('settle');
    travelAmbient(0, 100, 0.8, 5001);
    // the throttle starts over after a hand-over ends
    expect(incoming()!.style.opacity).toBe('0.8');
  });

  it('does nothing with ambient off', () => {
    setFlags({ 'app.feel_ambient': false });
    travelAmbient(0, 100, 0.5, 1000);
    expect(layer()).toBeNull();
  });
});
