import { breathe } from './breathe';
import { fileSha256, WHOLE_DIGEST_MAX_BYTES } from './identity';

// The audio id (`library.audio_identity`, docs/engineering/audio-identity.md).
//
// A song is known by its audio, not its whole file: a tag edit, new artwork or a rating another
// player writes changes the file's bytes but not its audio, so it must not make a new song. This
// hashes only the encoded audio payload each container defines, never decoded samples (decoders
// differ between browsers and Python), and answers null for anything it can't place exactly:
// the whole-file hash then identifies the song, as before. The Python twin is
// `src/selecta/library/audio_identity.py`; both are checked against the fixtures in
// `tests/fixtures/audio_identity/`. Every rule below mirrors it line for line.
//
// Headers are read in small slices; the payload is streamed, never held twice.

export const AUDIO_ID_PREFIX = 'a1:';
export const AUDIO_ID_PATTERN = /^a1:[0-9a-f]{64}$/;
const CHUNK = 1024 * 1024;
const UPDATE_SLICE_BYTES = 256 * 1024;

type Range = [number, number];

/** Small reads at any offset of something of known size. Answers exactly what the Python
 * reader answers: at most `count` bytes, fewer at the end, none outside the file. */
type Source = { size: number; read(offset: number, count: number): Promise<Uint8Array> };

const EMPTY = new Uint8Array(0);

function bytesSource(bytes: Uint8Array): Source {
  return {
    size: bytes.length,
    read: async (offset, count) => (offset < 0 || count <= 0 || offset >= bytes.length ? EMPTY : bytes.subarray(offset, Math.min(bytes.length, offset + count))),
  };
}

/** A Blob read through one cached window, so walking thousands of Ogg page headers costs a
 * few slices, not thousands, and memory stays at one window. */
function blobSource(blob: Blob): Source {
  let start = 0;
  let window: Uint8Array = EMPTY;
  return {
    size: blob.size,
    async read(offset, count) {
      if (offset < 0 || count <= 0 || offset >= blob.size) return EMPTY;
      const end = Math.min(blob.size, offset + count);
      if (offset >= start && end <= start + window.length) return window.subarray(offset - start, end - start);
      if (end - offset > CHUNK) return new Uint8Array(await blob.slice(offset, end).arrayBuffer());
      start = offset;
      window = new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + CHUNK)).arrayBuffer());
      return window.subarray(0, end - offset);
    },
  };
}

const le = (data: Uint8Array, at: number, width = 4) => {
  let value = 0;
  for (let index = width - 1; index >= 0; index -= 1) value = value * 256 + (data[at + index] ?? 0);
  return value;
};
const be = (data: Uint8Array, at: number, width = 4) => {
  let value = 0;
  for (let index = 0; index < width; index += 1) value = value * 256 + (data[at + index] ?? 0);
  return value;
};
/** True when `data` holds exactly these ASCII bytes from `at` on. */
const is = (data: Uint8Array, text: string, at = 0) => {
  if (data.length < at + text.length) return false;
  for (let index = 0; index < text.length; index += 1) if (data[at + index] !== text.charCodeAt(index)) return false;
  return true;
};
const syncsafe = (data: Uint8Array, at = 0): number | null => {
  if (data.length < at + 4) return null;
  for (let index = 0; index < 4; index += 1) if (data[at + index] >= 0x80) return null;
  return (data[at] << 21) | (data[at + 1] << 14) | (data[at + 2] << 7) | data[at + 3];
};

function add(ranges: Range[], start: number, end: number) {
  // neighbours are joined, so a page or box boundary costs nothing
  if (end <= start) return;
  const last = ranges[ranges.length - 1];
  if (last && last[1] === start) last[1] = end;
  else ranges.push([start, end]);
}

/** Where the leading ID3v2 tags end and how many there were; null if one runs past the end. */
async function id3v2Tags(source: Source): Promise<[number, number] | null> {
  let at = 0;
  let count = 0;
  for (;;) {
    const head = await source.read(at, 10);
    if (head.length < 10 || !is(head, 'ID3') || ![2, 3, 4].includes(head[3]) || head[4] === 0xff) return [at, count];
    const size = syncsafe(head, 6);
    if (size === null) return [at, count];
    const length = 10 + size + (head[3] === 4 && head[5] & 0x10 ? 10 : 0);
    if (at + length > source.size) return null;
    at += length;
    count += 1;
  }
}

const frameHeader = (data: Uint8Array, at = 0) =>
  data.length >= at + 4
  && data[at] === 0xff
  && (data[at + 1] & 0xe0) === 0xe0
  && ((data[at + 1] >> 3) & 3) !== 1
  && ((data[at + 1] >> 1) & 3) !== 0
  && data[at + 2] >> 4 !== 15
  && ((data[at + 2] >> 2) & 3) !== 3;

async function mp3End(source: Source, start: number): Promise<number | null> {
  let end = source.size;
  if (end - 128 >= start && is(await source.read(end - 128, 3), 'TAG')) {
    end -= 128;
    if (end - 227 >= start && is(await source.read(end - 227, 4), 'TAG+')) end -= 227;
  }
  for (;;) {
    if (end - 32 >= start && is(await source.read(end - 32, 8), 'APETAGEX')) {
      const footer = await source.read(end - 32, 32);
      const size = le(footer, 12);
      const flags = le(footer, 20);
      const version = le(footer, 8);
      if ((version !== 1000 && version !== 2000) || size < 32) return null;
      const total = size + (flags >= 0x80000000 ? 32 : 0);
      if (end - total < start) return null;
      end -= total;
      continue;
    }
    if (end - 15 >= start && is(await source.read(end - 9, 9), 'LYRICS200')) {
      const digits = await source.read(end - 15, 6);
      if (digits.length !== 6 || !digits.every((byte) => byte >= 0x30 && byte <= 0x39)) return null;
      const total = Number(String.fromCharCode(...digits)) + 15;
      if (end - total < start || !is(await source.read(end - total, 11), 'LYRICSBEGIN')) return null;
      end -= total;
      continue;
    }
    if (end - 10 >= start) {
      const tail = await source.read(end - 10, 10);
      const size = syncsafe(tail, 6);
      if (is(tail, '3DI') && tail[3] === 4 && size !== null) {
        if (end - (size + 20) < start) return null;
        end -= size + 20;
        continue;
      }
    }
    if (end - 9 >= start && is(await source.read(end - 9, 9), 'LYRICSEND')) return null;
    return end;
  }
}

async function firstFrame(source: Source, start: number, end: number, anywhere: boolean): Promise<number | null> {
  if (!anywhere) return start + 4 <= end && frameHeader(await source.read(start, 4)) ? start : null;
  let at = start;
  while (at + 4 <= end) {
    const window = await source.read(at, Math.min(CHUNK, end - at));
    for (let index = 0; index < window.length - 3; index += 1) {
      if (window[index] === 0xff && frameHeader(window, index)) return at + index;
    }
    if (window.length < 4) return null;
    at += window.length - 3;
  }
  return null;
}

async function mp3(source: Source, start: number, tags: number): Promise<Range[] | null> {
  const end = await mp3End(source, start);
  if (end === null) return null;
  const frame = await firstFrame(source, start, end, tags > 0);
  return frame === null ? null : [[frame, end]];
}

async function flac(source: Source, start: number): Promise<Range[] | null> {
  let at = start + 4;
  let first = true;
  for (;;) {
    const head = await source.read(at, 4);
    if (head.length < 4) return null;
    const kind = head[0] & 0x7f;
    const length = be(head, 1, 3);
    if (kind === 127 || (first && (kind !== 0 || length !== 34))) return null;
    first = false;
    at += 4 + length;
    if (at > source.size) return null;
    if (head[0] & 0x80) break;
  }
  const sync = await source.read(at, 2);
  if (sync.length < 2 || sync[0] !== 0xff || (sync[1] !== 0xf8 && sync[1] !== 0xf9)) return null;
  let end = source.size;
  if (end - 128 >= at && is(await source.read(end - 128, 3), 'TAG')) end -= 128;
  return [[at, end]];
}

async function mp4(source: Source): Promise<Range[] | null> {
  const ranges: Range[] = [];
  let at = 0;
  let first = true;
  let found = false;
  while (at < source.size) {
    const head = await source.read(at, 8);
    if (head.length < 8) return null;
    let size = be(head, 0);
    let header = 8;
    if (size === 1) {
      const large = await source.read(at + 8, 8);
      if (large.length < 8) return null;
      size = be(large, 0, 8);
      header = 16;
    } else if (size === 0) {
      size = source.size - at;
    }
    if (size < header || at + size > source.size) return null;
    if (first && !is(head, 'ftyp', 4)) return null;
    first = false;
    if (is(head, 'mdat', 4)) {
      found = true;
      add(ranges, at + header, at + size);
    }
    at += size;
  }
  return found ? ranges : null;
}

/** The one `wanted` chunk of a RIFF, RF64 or AIFF file, as [data start, data end]. */
async function chunks(source: Source, bigEndian: boolean, rf64: boolean, wanted: string): Promise<Range[] | null> {
  const number = bigEndian ? be : le;
  const head = await source.read(0, 12);
  let areaEnd = 8 + number(head, 4);
  let dataSize: number | null = null;
  if (rf64) {
    if (number(head, 4) !== 0xffffffff) return null;
    const ds64 = await source.read(12, 36);
    if (ds64.length < 36 || !is(ds64, 'ds64') || le(ds64, 4) < 28) return null;
    areaEnd = 8 + le(ds64, 8, 8);
    dataSize = le(ds64, 16, 8);
  }
  if (areaEnd > source.size) return null;
  const found: Range[] = [];
  let at = 12;
  while (at + 8 <= areaEnd) {
    const chunk = await source.read(at, 8);
    let size = number(chunk, 4);
    if (rf64 && size === 0xffffffff) {
      if (!is(chunk, 'data') || dataSize === null) return null;
      size = dataSize;
    }
    if (at + 8 + size > areaEnd) return null;
    if (is(chunk, wanted)) found.push([at + 8, at + 8 + size]);
    at += 8 + size + (size % 2);
  }
  return found.length === 1 ? found : null;
}

async function aiff(source: Source): Promise<Range[] | null> {
  const found = await chunks(source, true, false, 'SSND');
  if (found === null) return null;
  const [start, end] = found[0];
  if (end - start < 8) return null;
  const offset = be(await source.read(start, 4), 0);
  if (offset > end - start - 8) return null;
  return [[start + 8 + offset, end]];
}

async function prefix(source: Source, ranges: Range[], count: number): Promise<Uint8Array> {
  const out: number[] = [];
  for (const [start, end] of ranges) {
    if (out.length >= count) break;
    out.push(...await source.read(start, Math.min(end - start, count - out.length)));
  }
  return Uint8Array.from(out);
}

async function ogg(source: Source): Promise<Range[] | null> {
  const ranges: Range[] = [];
  const heads: [Range[], Range[]] = [[], []];
  let at = 0;
  let serial: number | null = null;
  let ended = false;
  let pending = false;
  let packet = 0;
  while (at < source.size) {
    const head = await source.read(at, 27);
    if (head.length < 27 || !is(head, 'OggS') || head[4] !== 0) return null;
    const flags = head[5];
    const pageSerial = le(head, 14);
    const count = head[26];
    const lacing = Uint8Array.from(await source.read(at + 27, count));
    if (lacing.length < count) return null;
    const body = at + 27 + count;
    const after = body + lacing.reduce((sum, value) => sum + value, 0);
    if (after > source.size) return null;
    if (serial === null) {
      if (!(flags & 0x02)) return null;
      serial = pageSerial;
    }
    if (pageSerial !== serial) {
      at = after;
      continue;
    }
    if (ended || Boolean(flags & 0x01) !== pending) return null;
    let cursor = body;
    for (const value of lacing) {
      if (packet !== 1) add(ranges, cursor, cursor + value);
      if (packet < 2) add(heads[packet], cursor, cursor + value);
      cursor += value;
      pending = value === 255;
      if (!pending) packet += 1;
    }
    if (flags & 0x04) ended = true;
    at = after;
  }
  if (serial === null || pending) return null;
  const first = await prefix(source, heads[0], 8);
  const second = await prefix(source, heads[1], 8);
  if (first.length >= 7 && first[0] === 1 && is(first, 'vorbis', 1) && second[0] === 3 && is(second, 'vorbis', 1)) return ranges;
  if (first.length === 8 && is(first, 'OpusHead') && is(second, 'OpusTags')) return ranges;
  return null;
}

/** The byte ranges the audio id hashes, in file order, or null when the file has no audio id. */
async function payloadRanges(source: Source): Promise<Range[] | null> {
  const head = await source.read(0, 12);
  let ranges: Range[] | null;
  if ((is(head, 'RIFF') || is(head, 'RF64')) && is(head, 'WAVE', 8)) ranges = await chunks(source, false, is(head, 'RF64'), 'data');
  else if (is(head, 'FORM') && (is(head, 'AIFF', 8) || is(head, 'AIFC', 8))) ranges = await aiff(source);
  else if (is(head, 'ftyp', 4)) ranges = await mp4(source);
  else if (is(head, 'OggS')) ranges = await ogg(source);
  else {
    const tags = await id3v2Tags(source);
    if (tags === null) return null;
    const [start, count] = tags;
    ranges = is(await source.read(start, 4), 'fLaC') ? await flac(source, start) : await mp3(source, start, count);
  }
  if (!ranges || ranges.reduce((sum, [start, end]) => sum + end - start, 0) === 0) return null;
  return ranges;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

type Options = { signal?: AbortSignal };

function cancelled(options: Options) {
  if (options.signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
}

async function hashRanges(source: Source, ranges: Range[], options: Options, inMemory: boolean): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (inMemory && ranges.length === 1 && subtle?.digest) {
    // one range of bytes already in memory: native, off the page, no copy of our own
    try {
      const view = await source.read(ranges[0][0], ranges[0][1] - ranges[0][0]);
      return hex(new Uint8Array(await subtle.digest('SHA-256', view as BufferSource)));
    } catch {
      // a WebCrypto that refuses these bytes: the streamed hash below gives the same answer
    }
  }
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const hash = sha256.create();
  for (const [start, end] of ranges) {
    for (let at = start; at < end; at += CHUNK) {
      cancelled(options);
      const chunk = await source.read(at, Math.min(CHUNK, end - at));
      for (let piece = 0; piece < chunk.length; piece += UPDATE_SLICE_BYTES) {
        if (piece > 0) await breathe();
        hash.update(chunk.subarray(piece, piece + UPDATE_SLICE_BYTES));
      }
    }
  }
  return hex(hash.digest());
}

async function idOf(source: Source, options: Options, inMemory: boolean): Promise<string | null> {
  cancelled(options);
  let ranges: Range[] | null;
  try {
    ranges = await payloadRanges(source);
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    return null; // an unreadable slice: no id, never a guess
  }
  if (!ranges) return null;
  return AUDIO_ID_PREFIX + await hashRanges(source, ranges, options, inMemory);
}

/** The audio id of a file, streamed in slices, or null. */
export async function audioId(file: Blob, options: Options = {}): Promise<string | null> {
  return idOf(blobSource(file), options, false);
}

/** The audio id of bytes already in memory, without copying them, or null. */
export async function audioIdOfBytes(bytes: ArrayBuffer | Uint8Array, options: Options = {}): Promise<string | null> {
  return idOf(bytesSource(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), options, true);
}

/** A file's SHA-256 and its audio id. A file small enough to be hashed whole is read once and
 * both come from that one buffer; a bigger one keeps the streamed SHA-256 and reads its audio in
 * a second streamed pass, so it is never in memory whole, let alone twice. */
export async function fileIdentity(file: Blob, options: Options = {}): Promise<{ sha: string; audioId: string | null }> {
  cancelled(options);
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (file.size <= WHOLE_DIGEST_MAX_BYTES && subtle?.digest) {
    const buffer = await file.arrayBuffer();
    cancelled(options);
    let digest: ArrayBuffer | null = null;
    try {
      digest = await subtle.digest('SHA-256', buffer);
    } catch {
      // the streamed hash below gives the same answer
    }
    if (digest) return { sha: hex(new Uint8Array(digest)), audioId: await audioIdOfBytes(buffer, options) };
  }
  const sha = await fileSha256(file, options);
  return { sha, audioId: await audioId(file, options) };
}
