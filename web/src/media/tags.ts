// Display metadata from the member's own audio files, read on this device only (ADR-0458).
// Covers the tag formats the importer actually meets: ID3v2.2/2.3/2.4 and ID3v1 (mp3),
// VORBIS_COMMENT (flac), and ilst atoms (m4a/mp4/aac). Anything unreadable is simply absent,
// and the importer falls back to its filename heuristic. Nothing here leaves the browser.

export type FileTags = { title?: string; artist?: string; album?: string };

const read = async (file: File, start: number, end: number): Promise<Uint8Array> =>
  new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

function decode(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return '';
  }
}

/** Tag text arrives padded, BOM-ed or null-terminated; a cleaned empty string is no tag. */
function clean(text: string): string | undefined {
  const value = text.replace(/\0/g, '').replace(/^﻿/, '').trim();
  return value || undefined;
}

function u32be(bytes: Uint8Array, at: number): number {
  return bytes[at] * 0x1000000 + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

function u32le(bytes: Uint8Array, at: number): number {
  return bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16) + bytes[at + 3] * 0x1000000;
}

function syncsafe(bytes: Uint8Array, at: number): number {
  return ((bytes[at] & 0x7f) << 21) | ((bytes[at + 1] & 0x7f) << 14) | ((bytes[at + 2] & 0x7f) << 7) | (bytes[at + 3] & 0x7f);
}

// ---------- ID3v2 ----------

const ID3_FRAMES: Record<string, keyof FileTags> = {
  TIT2: 'title', TPE1: 'artist', TALB: 'album', // v2.3 / v2.4
  TT2: 'title', TP1: 'artist', TAL: 'album', // v2.2
};

/** ID3v2 text-frame payload: an encoding byte, then the text in that encoding. */
function id3Text(payload: Uint8Array): string | undefined {
  if (!payload.length) return undefined;
  const body = payload.subarray(1);
  switch (payload[0]) {
    case 0: return clean(decode(body, 'windows-1252'));
    case 1: return clean(decode(body, 'utf-16'));
    case 2: return clean(decode(body, 'utf-16be'));
    case 3: return clean(decode(body, 'utf-8'));
    default: return undefined;
  }
}

/** Undo tag-wide unsynchronisation (FF 00 -> FF) where the header says it was applied. */
function resync(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[length++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, length);
}

async function readId3v2(file: File, header: Uint8Array): Promise<FileTags | null> {
  const major = header[3];
  if (major < 2 || major > 4) return null;
  const size = syncsafe(header, 6);
  if (!size) return null;
  let tag = await read(file, 10, 10 + size);
  if (header[5] & 0x80) tag = resync(tag);
  let at = 0;
  if (major >= 3 && header[5] & 0x40) {
    // Skip the extended header: its size field counts differently per version, but both
    // versions store it first and include enough to step over.
    const extended = major === 4 ? syncsafe(tag, 0) : u32be(tag, 0) + 4;
    at += extended;
  }
  const idLength = major === 2 ? 3 : 4;
  const headLength = major === 2 ? 6 : 10;
  const tags: FileTags = {};
  while (at + headLength <= tag.length) {
    const id = ascii(tag, at, idLength);
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding or corruption: nothing further to read
    const frameSize = major === 2
      ? (tag[at + 3] << 16) | (tag[at + 4] << 8) | tag[at + 5]
      : major === 3 ? u32be(tag, at + 4) : syncsafe(tag, at + 4);
    if (frameSize <= 0 || at + headLength + frameSize > tag.length) break;
    const want = ID3_FRAMES[id];
    if (want && !tags[want]) {
      let payload = tag.subarray(at + headLength, at + headLength + frameSize);
      // A v2.4 frame can be unsynchronised on its own.
      if (major === 4 && tag[at + 9] & 0x02) payload = resync(payload);
      tags[want] = id3Text(payload);
    }
    at += headLength + frameSize;
    if (tags.title && tags.artist && tags.album) break;
  }
  return tags.title || tags.artist || tags.album ? tags : null;
}

async function readId3v1(file: File): Promise<FileTags | null> {
  if (file.size < 128) return null;
  const tail = await read(file, file.size - 128, file.size);
  if (ascii(tail, 0, 3) !== 'TAG') return null;
  const field = (start: number) => clean(decode(tail.subarray(start, start + 30), 'windows-1252'));
  const tags: FileTags = { title: field(3), artist: field(33), album: field(63) };
  return tags.title || tags.artist || tags.album ? tags : null;
}

// ---------- FLAC ----------

const VORBIS_FIELDS: Record<string, keyof FileTags> = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album' };

function vorbisComment(block: Uint8Array): FileTags | null {
  let at = 4 + u32le(block, 0); // vendor string
  if (at + 4 > block.length) return null;
  const count = u32le(block, at);
  at += 4;
  const tags: FileTags = {};
  for (let i = 0; i < count && at + 4 <= block.length; i++) {
    const length = u32le(block, at);
    at += 4;
    if (at + length > block.length) break;
    const entry = decode(block.subarray(at, at + length), 'utf-8');
    at += length;
    const split = entry.indexOf('=');
    if (split < 1) continue;
    const want = VORBIS_FIELDS[entry.slice(0, split).toUpperCase()];
    if (want && !tags[want]) tags[want] = clean(entry.slice(split + 1));
  }
  return tags.title || tags.artist || tags.album ? tags : null;
}

async function readFlac(file: File): Promise<FileTags | null> {
  let at = 4;
  for (let blocks = 0; blocks < 64; blocks++) {
    const head = await read(file, at, at + 4);
    if (head.length < 4) return null;
    const type = head[0] & 0x7f;
    const length = (head[1] << 16) | (head[2] << 8) | head[3];
    if (type === 4) return vorbisComment(await read(file, at + 4, at + 4 + length));
    if (head[0] & 0x80) return null; // that was the last metadata block
    at += 4 + length;
  }
  return null;
}

// ---------- MP4 / M4A ----------

const ILST_ITEMS: Record<string, keyof FileTags> = { '©nam': 'title', '©ART': 'artist', '©alb': 'album' };

/** Walk one level of boxes inside `bytes`, calling `found` for each. */
function boxes(bytes: Uint8Array, from: number, to: number, found: (type: string, start: number, end: number) => void): void {
  let at = from;
  while (at + 8 <= to) {
    const size = u32be(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    if (size < 8 || at + size > to) break;
    found(type, at + 8, at + size);
    at += size;
  }
}

function ilstTags(bytes: Uint8Array, from: number, to: number): FileTags {
  const tags: FileTags = {};
  boxes(bytes, from, to, (item, start, end) => {
    const want = ILST_ITEMS[item];
    if (!want || tags[want]) return;
    boxes(bytes, start, end, (type, dataStart, dataEnd) => {
      // The data box: 4 bytes version+flags, 4 bytes locale, then UTF-8 text.
      if (type === 'data' && !tags[want]) tags[want] = clean(decode(bytes.subarray(dataStart + 8, dataEnd), 'utf-8'));
    });
  });
  return tags;
}

async function readM4a(file: File): Promise<FileTags | null> {
  // Top-level boxes are few (ftyp, free, mdat, moov); step through their headers without
  // reading the audio itself, then read just the moov box.
  let at = 0;
  for (let hops = 0; hops < 64 && at + 8 <= file.size; hops++) {
    const head = await read(file, at, at + 16);
    if (head.length < 8) return null;
    let size: number = u32be(head, 0);
    const type = ascii(head, 4, 4);
    if (size === 0) size = file.size - at;
    else if (size === 1) {
      // 64-bit size: high word first; audio files never reach 2^53, so this stays exact.
      if (head.length < 16) return null;
      size = u32be(head, 8) * 0x100000000 + u32be(head, 12);
    }
    if (size < 8) return null;
    if (type === 'moov') {
      if (size > 32 * 1024 * 1024) return null; // not display metadata at that size
      const moov = await read(file, at + 8, at + size);
      let tags: FileTags | null = null;
      boxes(moov, 0, moov.length, (child, start, end) => {
        if (child !== 'udta' || tags) return;
        boxes(moov, start, end, (grand, metaStart, metaEnd) => {
          if (grand !== 'meta' || tags) return;
          // meta is a full box: 4 bytes of version+flags before its children.
          boxes(moov, metaStart + 4, metaEnd, (great, ilstStart, ilstEnd) => {
            if (great !== 'ilst' || tags) return;
            const found = ilstTags(moov, ilstStart, ilstEnd);
            if (found.title || found.artist || found.album) tags = found;
          });
        });
      });
      return tags;
    }
    at += size;
  }
  return null;
}

// ---------- entry ----------

/** Read title, artist and album from the file's own tags, or null where none are readable.
 * The read touches only the metadata regions, never the audio. */
export async function readFileTags(file: File): Promise<FileTags | null> {
  try {
    const head = await read(file, 0, 12);
    if (head.length < 12) return null;
    if (ascii(head, 0, 3) === 'ID3') return (await readId3v2(file, await read(file, 0, 10))) ?? readId3v1(file);
    if (ascii(head, 0, 4) === 'fLaC') return readFlac(file);
    if (ascii(head, 4, 4) === 'ftyp') return readM4a(file);
    // An mp3 without an ID3v2 header may still carry a v1 tag at the tail.
    return readId3v1(file);
  } catch {
    return null;
  }
}
