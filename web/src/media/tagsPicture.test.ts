import { describe, expect, it } from 'vitest';
import { MAX_PICTURE_BYTES, readFilePicture, readFileTags } from './tags';

/** FL-0478-01: the file's own cover, read from hand-built tag bytes. The front cover wins over any
 * other picture, the type comes from the bytes, an oversized or unknown picture is refused, and a
 * broken tag gives null without throwing. The text reader answers exactly as before. */

const bytes = (...parts: (number[] | Uint8Array | string)[]): Uint8Array => {
  const chunks = parts.map((part) => (typeof part === 'string' ? new TextEncoder().encode(part) : part instanceof Uint8Array ? part : Uint8Array.from(part)));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
};
const latin1 = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
const utf16 = (text: string) => bytes([0xff, 0xfe], Uint8Array.from([...text].flatMap((char) => [char.charCodeAt(0) & 0xff, char.charCodeAt(0) >> 8])));
const be32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const syncsafe = (value: number) => [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
const file = (data: Uint8Array, name = 'song.mp3') => new File([data as BlobPart], name);

/** Small but sniffable images, each marked so the test can tell which one came back. */
const JPEG = (mark: number) => bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', [0, 1, 1, mark, 0xff, 0xd9]);
const PNG = (mark: number) => bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], 'IHDR', [mark]);
const GIF = bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0, 0]);

type Encoding = 0 | 1 | 3;
function apic(type: number, image: Uint8Array, description: string, encoding: Encoding = 0, mime = 'image/jpeg'): Uint8Array {
  const text = encoding === 1 ? bytes(utf16(description), [0, 0]) : bytes(encoding === 0 ? latin1(description) : description, [0]);
  return bytes([encoding], mime, [0, type], text, image);
}

function frame(major: 3 | 4, id: string, payload: Uint8Array, flags = 0): Uint8Array {
  const size = major === 4 ? syncsafe(payload.length) : be32(payload.length);
  return bytes(id, size, [0, flags], payload);
}

function id3(major: 3 | 4, frames: Uint8Array[], padding = 16): Uint8Array {
  const body = bytes(...frames, new Uint8Array(padding));
  return bytes('ID3', [major, 0, 0], syncsafe(body.length), body, new Uint8Array(64));
}

const text = (major: 3 | 4, id: string, value: string) => frame(major, id, bytes([3], value));

describe('FL-0478-01 ID3v2 APIC', () => {
  for (const major of [3, 4] as const) {
    it(`reads a v2.${major} picture with a Latin-1 or a UTF-16 description`, async () => {
      const plain = await readFilePicture(file(id3(major, [text(major, 'TIT2', 'Song'), frame(major, 'APIC', apic(3, JPEG(1), 'Cover caf\xe9', 0))])));
      expect(plain?.mime).toBe('image/jpeg');
      expect([...plain!.bytes]).toEqual([...JPEG(1)]);

      const wide = await readFilePicture(file(id3(major, [frame(major, 'APIC', apic(3, PNG(2), 'Pochette', 1, 'image/png'))])));
      expect(wide?.mime).toBe('image/png');
      expect([...wide!.bytes]).toEqual([...PNG(2)]);
    });
  }

  it('prefers the front cover over an earlier picture of another type', async () => {
    const found = await readFilePicture(file(id3(3, [
      frame(3, 'APIC', apic(4, JPEG(7), 'back')),
      frame(3, 'APIC', apic(3, JPEG(8), 'front')),
    ])));
    expect([...found!.bytes]).toEqual([...JPEG(8)]);
  });

  it('falls back to the first usable picture when there is no front cover', async () => {
    const found = await readFilePicture(file(id3(4, [
      frame(4, 'APIC', apic(0, GIF, 'gif', 0, 'image/gif')),
      frame(4, 'APIC', apic(5, PNG(3), 'leaflet', 0, 'image/png')),
      frame(4, 'APIC', apic(6, JPEG(4), 'media')),
    ])));
    expect([...found!.bytes]).toEqual([...PNG(3)]);
  });

  it('takes the type from the bytes, never from the declared mime', async () => {
    const lying = await readFilePicture(file(id3(3, [frame(3, 'APIC', apic(3, PNG(5), '', 0, 'image/jpg'))])));
    expect(lying?.mime).toBe('image/png');
    const unknown = await readFilePicture(file(id3(3, [frame(3, 'APIC', apic(3, GIF, '', 0, 'image/jpeg'))])));
    expect(unknown).toBeNull();
  });

  it('refuses a picture past 15 MB', async () => {
    const huge = new Uint8Array(MAX_PICTURE_BYTES + 1);
    huge.set(JPEG(9));
    expect(MAX_PICTURE_BYTES).toBe(15 * 1024 * 1024);
    const found = await readFilePicture(file(id3(4, [frame(4, 'APIC', apic(3, huge, 'big'))], 0)));
    expect(found).toBeNull();
  });

  it('steps over a compressed frame and reads the next', async () => {
    const found = await readFilePicture(file(id3(3, [
      frame(3, 'APIC', apic(3, JPEG(1), 'zipped'), 0x80),
      frame(3, 'APIC', apic(3, JPEG(2), 'plain')),
    ])));
    expect([...found!.bytes]).toEqual([...JPEG(2)]);
  });
});

describe('FL-0478-01 FLAC PICTURE', () => {
  function pictureBlock(type: number, image: Uint8Array, last = false): Uint8Array {
    const mime = 'image/jpeg';
    const body = bytes(be32(type), be32(mime.length), mime, be32(5), 'cover', be32(500), be32(500), be32(24), be32(0), be32(image.length), image);
    return bytes([(last ? 0x80 : 0) | 6, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff], body);
  }
  const streamInfo = bytes([0, 0, 0, 34], new Uint8Array(34));

  it('prefers the type 3 picture', async () => {
    const data = bytes('fLaC', streamInfo, pictureBlock(4, PNG(1)), pictureBlock(3, JPEG(2), true), new Uint8Array(32));
    const found = await readFilePicture(file(data, 'song.flac'));
    expect(found?.mime).toBe('image/jpeg');
    expect([...found!.bytes]).toEqual([...JPEG(2)]);
  });

  it('falls back to the first picture of another type', async () => {
    const data = bytes('fLaC', streamInfo, pictureBlock(0, PNG(6), true), new Uint8Array(32));
    expect((await readFilePicture(file(data, 'song.flac')))?.mime).toBe('image/png');
  });
});

describe('FL-0478-01 MP4 covr', () => {
  const box = (type: string, ...children: Uint8Array[]) => {
    const body = bytes(...children);
    // box types are four single bytes: the copyright sign is 0xA9, not its two-byte UTF-8 form
    return bytes(be32(body.length + 8), latin1(type), body);
  };
  function m4a(image: Uint8Array, dataType: number): Uint8Array {
    const covr = box('covr', box('data', bytes(be32(dataType), be32(0), image)));
    const name = box('\xa9nam', box('data', bytes(be32(1), be32(0), 'Title')));
    const moov = box('moov', box('udta', box('meta', bytes([0, 0, 0, 0]), box('ilst', name, covr))));
    return bytes(box('ftyp', bytes('M4A ', be32(0))), box('mdat', new Uint8Array(40)), moov);
  }
  it('reads a JPEG and a PNG cover', async () => {
    const jpeg = await readFilePicture(file(m4a(JPEG(3), 13), 'song.m4a'));
    expect(jpeg?.mime).toBe('image/jpeg');
    expect([...jpeg!.bytes]).toEqual([...JPEG(3)]);
    const png = await readFilePicture(file(m4a(PNG(4), 14), 'song.m4a'));
    expect(png?.mime).toBe('image/png');
  });
});

describe('FL-0478-01 broken tags', () => {
  it('give null and never throw', async () => {
    const good = id3(3, [frame(3, 'APIC', apic(3, JPEG(1), 'front'))]);
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      bytes('ID3'),
      good.subarray(0, 30),
      bytes('ID3', [9, 0, 0], syncsafe(20), new Uint8Array(20)),
      bytes('ID3', [3, 0, 0], syncsafe(40), 'APIC', be32(0xffffff), [0, 0], new Uint8Array(30)),
      bytes('ID3', [3, 0, 0], syncsafe(30), frame(3, 'APIC', bytes([7], 'image/jpeg', [0, 3, 0]))),
      bytes('fLaC', [6, 0xff, 0xff, 0xff], be32(3), new Uint8Array(4)),
      bytes(be32(24), 'ftyp', 'M4A ', be32(0), be32(0), be32(0xffff), 'moov', new Uint8Array(8)),
      bytes('RIFF', new Uint8Array(40)),
    ];
    for (const data of cases) {
      await expect(readFilePicture(file(data))).resolves.toBeNull();
    }
  });

  it('a file that cannot be read at all is null too', async () => {
    const broken = { size: 100, slice: () => { throw new Error('gone'); } } as unknown as File;
    await expect(readFilePicture(broken)).resolves.toBeNull();
  });
});

describe('FL-0478-01 readFileTags is unchanged', () => {
  it('still reads the title, artist and album beside a picture', async () => {
    const data = id3(4, [
      frame(4, 'APIC', apic(3, JPEG(1), 'front')),
      text(4, 'TIT2', 'Night Drive'),
      text(4, 'TPE1', 'The Band'),
      text(4, 'TALB', 'Roads'),
    ]);
    expect(await readFileTags(file(data))).toEqual({ title: 'Night Drive', artist: 'The Band', album: 'Roads' });
  });

  it('a file with only a picture has no text tags', async () => {
    expect(await readFileTags(file(id3(3, [frame(3, 'APIC', apic(3, JPEG(1), 'front'))])))).toBeNull();
  });
});
