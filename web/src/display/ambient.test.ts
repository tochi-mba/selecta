import { afterEach, describe, expect, it } from 'vitest';
import { artHue } from '../feel/hue';
import { paintAmbient, songHue } from './ambient';

const song = (id: number) => ({ song_id: id, title: 'A', artist: 'B', length_s: 200 });

describe('the display ambient colour', () => {
  afterEach(() => document.body.replaceChildren());

  it('uses the same hue as the app for every song', () => {
    for (const seed of [0, 1, 7, 42, 1234, 99999, 'night-drive']) expect(songHue(seed)).toBe(artHue(seed));
  });

  it('tints the screen while a song is on and fades when nothing is', () => {
    paintAmbient(song(42), false);
    const layer = document.getElementById('d-ambient') as HTMLElement;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.hasAttribute('data-on')).toBe(true);
    expect(layer.style.getPropertyValue('--ambient-hue')).toBe(String(artHue(42)));
    paintAmbient(song(42), true);
    expect(layer.hasAttribute('data-paused')).toBe(true);
    paintAmbient(null, false);
    expect(layer.hasAttribute('data-on')).toBe(false);
    expect(document.querySelectorAll('#d-ambient')).toHaveLength(1);
  });
});
