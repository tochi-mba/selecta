/** A picture's declared size and whether it moves, read from its header bytes alone
 * (T-20261125-c6b3, T-20261125-4054).
 *
 * A small file can declare an enormous picture (a flat colour compresses to almost nothing), and
 * decoding it allocates width x height x 4 bytes before any check after the decode can refuse it.
 * So the size is read here first, from the bytes as stored, and a picture past the budget is
 * never handed to a decoder. Nothing is decoded and nothing is allocated beyond small numbers.
 *
 * JPEG (the SOFn segment), PNG (IHDR, and acTL for an animated PNG), GIF (the screen and every
 * frame's own size, counting frames) and WebP (VP8, VP8L, VP8X with its animation flag). Anything
 * else, or a header that is cut short or contradicts itself, answers null: the caller treats an
 * unknown size as too big, and the song keeps its generated tile.
 *
 * This module imports nothing, so the art worker that uses it stays small.
 */

export type PictureHeader = {
  kind: 'jpeg' | 'png' | 'gif' | 'webp';
  width: number;
  height: number;
  /** True when the picture has more than one frame (animated GIF, APNG, animated WebP). */
  animated: boolean;
};

/** About 40 megapixels: far past any real cover, well short of a decode that can end the tab. */
export const MAX_PICTURE_PIXELS = 40_000_000;

const text = (bytes: Uint8Array, at: number, length: number) => {
  let out = '';
  for (let i = at; i < at + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + ((b[at + 3] << 24) >>> 0);

function sized(kind: PictureHeader['kind'], width: number, height: number, animated: boolean): PictureHeader | null {
  if (!(width >= 1 && height >= 1)) return null;
  return { kind, width, height, animated };
}

function jpeg(b: Uint8Array): PictureHeader | null {
  let at = 2;
  while (at + 3 < b.length) {
    if (b[at] !== 0xff) return null;
    // any number of fill bytes may sit before a marker
    while (at < b.length && b[at] === 0xff) at += 1;
    if (at >= b.length) return null;
    const marker = b[at];
    at += 1;
    // standalone markers carry no length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // the image data began with no frame header
    if (at + 1 >= b.length) return null;
    const length = u16be(b, at);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 6 >= b.length) return null;
      // a zero height means "given later" (DNL): unknown, so refused
      return sized('jpeg', u16be(b, at + 5), u16be(b, at + 3), false);
    }
    at += length;
  }
  return null;
}

function png(b: Uint8Array): PictureHeader | null {
  if (b.length < 24 || text(b, 12, 4) !== 'IHDR') return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  // an animated PNG says so with an acTL chunk before its first image data
  let animated = false;
  let at = 8;
  while (at + 8 <= b.length) {
    const length = u32be(b, at);
    const type = text(b, at + 4, 4);
    if (type === 'acTL') {
      animated = at + 12 <= b.length ? u32be(b, at + 8) > 1 || u32be(b, at + 8) === 0 : true;
      break;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    at += 12 + length;
  }
  return sized('png', width, height, animated);
}

/** Skip GIF data sub-blocks from `at`; the offset after the terminator, or -1 when cut short. */
function skipSubBlocks(b: Uint8Array, at: number): number {
  while (at < b.length) {
    const size = b[at];
    at += 1;
    if (size === 0) return at;
    at += size;
  }
  return -1;
}

function gif(b: Uint8Array): PictureHeader | null {
  if (b.length < 13) return null;
  let width = u16le(b, 6);
  let height = u16le(b, 8);
  let at = 13;
  if (b[10] & 0x80) at += 3 * (1 << ((b[10] & 0x07) + 1));
  let frames = 0;
  while (at < b.length) {
    const block = b[at];
    if (block === 0x3b) break; // the trailer
    if (block === 0x21) {
      at = skipSubBlocks(b, at + 2);
    } else if (block === 0x2c) {
      if (at + 10 > b.length) return null;
      // a frame may declare itself larger than the screen; the decoder sizes for the larger
      width = Math.max(width, u16le(b, at + 1) + u16le(b, at + 5));
      height = Math.max(height, u16le(b, at + 3) + u16le(b, at + 7));
      const flags = b[at + 9];
      at += 10;
      if (flags & 0x80) at += 3 * (1 << ((flags & 0x07) + 1));
      at = skipSubBlocks(b, at + 1); // past the LZW code size, then the image data
      frames += 1;
      if (frames > 1) break;
    } else {
      return null;
    }
    // cut short: whether more frames follow is unknown, so it is refused
    if (at < 0) return null;
  }
  if (frames === 0) return null;
  return sized('gif', width, height, frames > 1);
}

function webp(b: Uint8Array): PictureHeader | null {
  if (b.length < 30) return null;
  const chunk = text(b, 12, 4);
  if (chunk === 'VP8X') {
    const animated = (b[20] & 0x02) !== 0;
    return sized('webp', u24le(b, 24) + 1, u24le(b, 27) + 1, animated);
  }
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return sized('webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff, false);
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return sized('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, false);
  }
  return null;
}

/** The picture's declared size and whether it moves, or null when the header is not one this
 * reads. Never throws. */
export function pictureHeader(bytes: Uint8Array): PictureHeader | null {
  try {
    if (bytes.length < 12) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpeg(bytes);
    if (bytes[0] === 0x89 && text(bytes, 1, 3) === 'PNG') return png(bytes);
    if (text(bytes, 0, 6) === 'GIF87a' || text(bytes, 0, 6) === 'GIF89a') return gif(bytes);
    if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 4) === 'WEBP') return webp(bytes);
    return null;
  } catch {
    return null;
  }
}

/** True when the picture may be decoded: its header reads and it is within the pixel budget. */
export function withinPixelBudget(header: PictureHeader | null, budget = MAX_PICTURE_PIXELS): header is PictureHeader {
  return header !== null && header.width * header.height <= budget;
}
