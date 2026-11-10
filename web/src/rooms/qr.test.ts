import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { encodeQr, qrSvg } from './qr';

// Draw the code as pixels (four per module, with the quiet zone) and read it back with an
// independent decoder: the only real proof a QR code scans.
function decode(text: string): string | null {
  const code = encodeQr(text);
  const scale = 4;
  const side = (code.size + 8) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  code.modules.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const at = (((y + 4) * scale + dy) * side + (x + 4) * scale + dx) * 4;
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
      }
    }
  }));
  return jsQR(pixels, side, side)?.data ?? null;
}

describe('the room QR encoder', () => {
  it.each([
    'https://selecta.app/r/K7QDM2XP',
    'http://127.0.0.1:8740/r/23456789',
    'A',
    'https://selecta.app/r/' + 'Z'.repeat(60),
    'https://example.test/' + 'x'.repeat(200),
  ])('makes a code that scans back to %s', (text) => {
    expect(decode(text)).toBe(text);
  });

  it('uses the smallest version that fits', () => {
    expect(encodeQr('https://selecta.app/r/K7QDM2XP').size).toBe(29); // version 3
    expect(encodeQr('A').size).toBe(21); // version 1
  });

  it('draws an SVG with a quiet zone and an accessible label', () => {
    const svg = qrSvg('https://selecta.app/r/K7QDM2XP', 'Scan to join "Garden" & request');
    expect(svg).toContain('viewBox="0 0 37 37"');
    expect(svg).toContain('aria-label="Scan to join &quot;Garden&quot; &amp; request"');
  });
});
