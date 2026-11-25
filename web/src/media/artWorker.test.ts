import { describe, expect, it } from 'vitest';
import { artSupported, dominantHue, makeArt } from './artWorker';

/** FL-0478-01: the palette hue of a cover. A clear colour gives its hue; a grey, near-black,
 * near-white or see-through picture gives none, so the tile's own hue is used instead. */

function pixels(fill: (index: number) => [number, number, number, number], count = 24 * 24): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4);
  for (let index = 0; index < count; index += 1) out.set(fill(index), index * 4);
  return out;
}
const solid = (r: number, g: number, b: number, a = 255) => pixels(() => [r, g, b, a]);

describe('FL-0478-01 dominantHue', () => {
  it('finds the hue of a clear colour', () => {
    expect(dominantHue(solid(255, 0, 0))).toBe(0);
    expect(dominantHue(solid(0, 200, 0))).toBe(120);
    // 230.5 degrees and 22.5 degrees exactly, give or take the rounding
    expect(Math.abs(dominantHue(solid(30, 60, 220))! - 230.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(dominantHue(solid(200, 100, 40))! - 22.5)).toBeLessThanOrEqual(1);
  });

  it('finds a coloured patch on a grey cover', () => {
    // a tenth of the picture is a strong blue; the rest is mid grey
    const patch = pixels((index) => (index % 10 === 0 ? [20, 40, 230, 255] : [128, 128, 128, 255]));
    const hue = dominantHue(patch)!;
    expect(hue).toBeGreaterThan(225);
    expect(hue).toBeLessThan(240);
  });

  it('the bigger colour wins', () => {
    const mixed = pixels((index) => (index % 4 === 0 ? [0, 180, 0, 255] : [220, 30, 30, 255]));
    expect(dominantHue(mixed)).toBe(0);
  });

  it('is null for greys, near-black, near-white and see-through pictures', () => {
    expect(dominantHue(solid(128, 128, 128))).toBeNull();
    expect(dominantHue(solid(20, 8, 8))).toBeNull();
    expect(dominantHue(solid(250, 245, 240))).toBeNull();
    expect(dominantHue(solid(255, 0, 0, 0))).toBeNull();
    expect(dominantHue(new Uint8ClampedArray(0))).toBeNull();
  });

  it('is null when too few pixels have any colour', () => {
    const speck = pixels((index) => (index === 0 ? [255, 0, 0, 255] : [10, 10, 10, 255]));
    expect(dominantHue(speck)).toBeNull();
  });
});

describe('FL-0478-01 makeArt where pictures cannot be decoded off the page', () => {
  it('gives null rather than throwing', async () => {
    expect(artSupported()).toBe(false);
    await expect(makeArt(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg')).resolves.toBeNull();
  });
});
