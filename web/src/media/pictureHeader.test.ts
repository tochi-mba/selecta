import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeOptions, makeArt } from './artWorker';
import { MAX_PICTURE_PIXELS, pictureHeader, withinPixelBudget } from './pictureHeader';

/** T-20261125-c6b3 and T-20261125-4054: a picture's size and motion are read from its header
 * bytes, made by hand here, so a giant or animated picture is refused before any decode. */

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part)));
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

const chunk = (type: string, data: number[]) => [...be32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (width: number, height: number, frames?: number) =>
  bytes(PNG_SIGNATURE, chunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    frames === undefined ? [] : chunk('acTL', [...be32(frames), ...be32(0)]), chunk('IDAT', [0]), chunk('IEND', []));

const jpeg = (width: number, height: number, marker = 0xc0) =>
  bytes([0xff, 0xd8], [0xff, 0xe0], be16(16), 'JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xff, marker], be16(17), [8], be16(height), be16(width), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], [0xff, 0xd9]);

const gifFrame = (width: number, height: number) => [0x2c, ...le16(0), ...le16(0), ...le16(width), ...le16(height), 0, 2, 2, 0x4c, 0x01, 0];
const gif = (width: number, height: number, frames: number) =>
  bytes('GIF89a', le16(width), le16(height), [0, 0, 0],
    [0x21, 0xf9, 4, 0, 10, 0, 0, 0], ...Array.from({ length: frames }, () => gifFrame(width, height)), [0x3b]);

const riff = (body: number[]) => bytes('RIFF', le32(body.length + 4), 'WEBP', body);
const webpLossy = (width: number, height: number) =>
  riff([...'VP8 '].map((c) => c.charCodeAt(0)).concat(le32(10), [0, 0, 0, 0x9d, 0x01, 0x2a], le16(width), le16(height)));
const webpLossless = (width: number, height: number) => {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return riff([...'VP8L'].map((c) => c.charCodeAt(0)).concat(le32(5), [0x2f], le32(bits >>> 0), [0, 0, 0, 0, 0]));
};
const webpExtended = (width: number, height: number, animated: boolean) =>
  riff([...'VP8X'].map((c) => c.charCodeAt(0)).concat(le32(10), [animated ? 0x02 : 0, 0, 0, 0], le24(width - 1), le24(height - 1)));

describe('pictureHeader reads the declared size without decoding', () => {
  it('reads PNG, JPEG (any SOFn), GIF and every WebP form', () => {
    expect(pictureHeader(png(640, 480))).toEqual({ kind: 'png', width: 640, height: 480, animated: false });
    expect(pictureHeader(jpeg(1200, 900))).toEqual({ kind: 'jpeg', width: 1200, height: 900, animated: false });
    expect(pictureHeader(jpeg(300, 200, 0xc2))).toMatchObject({ width: 300, height: 200 });
    expect(pictureHeader(gif(50, 40, 1))).toEqual({ kind: 'gif', width: 50, height: 40, animated: false });
    expect(pictureHeader(webpLossy(500, 400))).toEqual({ kind: 'webp', width: 500, height: 400, animated: false });
    expect(pictureHeader(webpLossless(321, 123))).toEqual({ kind: 'webp', width: 321, height: 123, animated: false });
    expect(pictureHeader(webpExtended(4000, 3000, false))).toMatchObject({ width: 4000, height: 3000, animated: false });
  });

  it('tells a moving picture from a still one', () => {
    expect(pictureHeader(gif(50, 40, 3))?.animated).toBe(true);
    expect(pictureHeader(png(64, 64, 4))?.animated).toBe(true);
    expect(pictureHeader(png(64, 64, 1))?.animated).toBe(false);
    expect(pictureHeader(webpExtended(64, 64, true))?.animated).toBe(true);
  });

  it('refuses a crafted giant picture before any decode', () => {
    const giant = pictureHeader(png(30_000, 30_000));
    expect(giant).toMatchObject({ width: 30_000, height: 30_000 });
    expect(withinPixelBudget(giant)).toBe(false);
    expect(withinPixelBudget(pictureHeader(jpeg(20_000, 20_000)))).toBe(false);
    expect(withinPixelBudget(pictureHeader(webpExtended(16_000, 16_000, false)))).toBe(false);
    expect(withinPixelBudget(pictureHeader(png(6000, 6000)))).toBe(true);
    expect(6000 * 6000).toBeLessThan(MAX_PICTURE_PIXELS);
  });

  it('answers null for anything it cannot read, and never throws', () => {
    expect(pictureHeader(new Uint8Array(0))).toBeNull();
    expect(pictureHeader(bytes('not a picture at all'))).toBeNull();
    expect(pictureHeader(png(640, 480).subarray(0, 20))).toBeNull();
    expect(pictureHeader(jpeg(0, 0))).toBeNull();
    expect(pictureHeader(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(withinPixelBudget(null)).toBe(false);
  });
});

describe('makeArt refuses by header and decodes at reduced size', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never decodes a picture whose header is past the budget', async () => {
    const decode = vi.fn(async () => {
      throw new Error('must not be called');
    });
    vi.stubGlobal('createImageBitmap', decode);
    vi.stubGlobal('OffscreenCanvas', class {});
    await expect(makeArt(png(30_000, 30_000), 'image/png')).resolves.toBeNull();
    await expect(makeArt(bytes('garbage that is long enough'), 'image/png')).resolves.toBeNull();
    expect(decode).not.toHaveBeenCalled();
  });

  it('asks for a decode about the larger cover size, keeping the aspect ratio', () => {
    expect(decodeOptions({ kind: 'jpeg', width: 3000, height: 3000, animated: false })).toEqual({ resizeWidth: 512, resizeQuality: 'high' });
    expect(decodeOptions({ kind: 'jpeg', width: 4000, height: 2000, animated: false })).toEqual({ resizeWidth: 1024, resizeQuality: 'high' });
    expect(decodeOptions({ kind: 'png', width: 800, height: 800, animated: false })).toBeUndefined();
    expect(decodeOptions({ kind: 'png', width: 20_000, height: 1500, animated: false })).toBeUndefined();
  });
});
