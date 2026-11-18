/** Bit-level plumbing shared by the FLAC encoder and its checking decoder (ADR-0457, BF-0457-06).
 *
 * FLAC is big-endian and bit-packed: a growable bit writer, a bit reader, the frame header CRC-8
 * (polynomial x^8 + x^2 + x + 1) and the frame CRC-16 (polynomial x^16 + x^15 + x^2 + 1), all
 * per the FLAC format specification (RFC 9639). Values are written as unsigned integers of up
 * to 32 bits; signed values go through `toUnsigned` first. No bitwise trick here relies on a
 * value fitting in 31 bits unless it says so.
 */

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let byte = 0; byte < 256; byte += 1) {
  let crc8 = byte;
  for (let bit = 0; bit < 8; bit += 1) crc8 = crc8 & 0x80 ? ((crc8 << 1) ^ 0x07) & 0xff : (crc8 << 1) & 0xff;
  CRC8[byte] = crc8;
  let crc16 = byte << 8;
  for (let bit = 0; bit < 8; bit += 1) crc16 = crc16 & 0x8000 ? ((crc16 << 1) ^ 0x8005) & 0xffff : (crc16 << 1) & 0xffff;
  CRC16[byte] = crc16;
}

export function crc8(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let index = start; index < end; index += 1) crc = CRC8[crc ^ bytes[index]];
  return crc;
}

export function crc16(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let index = start; index < end; index += 1) crc = ((crc << 8) & 0xffff) ^ CRC16[(crc >> 8) ^ bytes[index]];
  return crc;
}

/** Two's complement of `value` in `bits` bits, as a non-negative number (bits <= 32). */
export function toUnsigned(value: number, bits: number): number {
  return value < 0 ? value + 2 ** bits : value;
}

export class BitWriter {
  private buffer: Uint8Array;
  /** Whole bytes written. */
  private at = 0;
  /** Bits pending in `pending` (0..7), most significant first. */
  private used = 0;
  private pending = 0;

  constructor(initialBytes = 1 << 16) {
    this.buffer = new Uint8Array(initialBytes);
  }

  /** Whole bytes written so far (the writer must be byte-aligned to read this as a length). */
  get bytePosition(): number {
    return this.at;
  }

  get aligned(): boolean {
    return this.used === 0;
  }

  private ensure(extra: number) {
    if (this.at + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.at + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buffer.subarray(0, this.at));
    this.buffer = grown;
  }

  private pushByte(byte: number) {
    this.ensure(1);
    this.buffer[this.at] = byte;
    this.at += 1;
  }

  /** Write the low `count` bits of a non-negative `value` (count <= 32). */
  writeBits(value: number, count: number) {
    if (count === 0) return;
    if (count > 24) {
      const high = Math.floor(value / 2 ** 16);
      this.writeBits(high, count - 16);
      this.writeBits(value % 2 ** 16, 16);
      return;
    }
    // count <= 24 and pending holds < 8 bits, so the sum fits in 31 bits.
    let acc = (this.pending << count) | (value & ((1 << count) - 1));
    let bits = this.used + count;
    while (bits >= 8) {
      bits -= 8;
      this.pushByte((acc >>> bits) & 0xff);
    }
    this.pending = acc & ((1 << bits) - 1);
    this.used = bits;
    acc = 0;
  }

  writeSigned(value: number, count: number) {
    this.writeBits(toUnsigned(value, count), count);
  }

  /** `quotient` zero bits then a one: the unary half of a Rice code. */
  writeUnary(quotient: number) {
    let left = quotient;
    while (left >= 16) {
      this.writeBits(0, 16);
      left -= 16;
    }
    this.writeBits(1, left + 1);
  }

  /** Pad with zero bits to the next byte boundary. */
  alignToByte() {
    if (this.used > 0) this.writeBits(0, 8 - this.used);
  }

  writeBytes(bytes: Uint8Array) {
    if (!this.aligned) throw new Error('Bytes can only be copied in on a byte boundary.');
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.at);
    this.at += bytes.length;
  }

  /** The bytes written so far (live view; copy before writing more). */
  view(): Uint8Array {
    return this.buffer.subarray(0, this.at);
  }

  /** Overwrite already-written bytes (used to fill STREAMINFO once the stream is known). */
  patch(at: number, bytes: Uint8Array) {
    this.buffer.set(bytes, at);
  }

  finish(): Uint8Array {
    this.alignToByte();
    return this.buffer.slice(0, this.at);
  }
}

export class BitReader {
  /** Absolute bit position. */
  private bit = 0;

  constructor(private readonly bytes: Uint8Array, startByte = 0) {
    this.bit = startByte * 8;
  }

  get bytePosition(): number {
    return Math.floor(this.bit / 8);
  }

  get bitsLeft(): number {
    return this.bytes.length * 8 - this.bit;
  }

  /** Read `count` bits (<= 32) as a non-negative number. */
  readBits(count: number): number {
    if (count === 0) return 0;
    if (count > this.bitsLeft) throw new Error('The file ends in the middle of a frame.');
    if (count > 24) {
      const high = this.readBits(count - 16);
      return high * 65536 + this.readBits(16);
    }
    let value = 0;
    let left = count;
    while (left > 0) {
      const byte = this.bytes[this.bit >> 3];
      const offset = this.bit & 7;
      const take = Math.min(8 - offset, left);
      const part = (byte >> (8 - offset - take)) & ((1 << take) - 1);
      value = (value << take) | part;
      left -= take;
      this.bit += take;
    }
    return value >>> 0;
  }

  readSigned(count: number): number {
    const value = this.readBits(count);
    return value >= 2 ** (count - 1) ? value - 2 ** count : value;
  }

  /** Count zero bits up to and including the terminating one. */
  readUnary(): number {
    let zeros = 0;
    for (;;) {
      if (this.bit >= this.bytes.length * 8) throw new Error('The file ends inside a Rice code.');
      const byte = this.bytes[this.bit >> 3];
      const offset = this.bit & 7;
      const rest = (byte << offset) & 0xff;
      if (rest === 0) {
        zeros += 8 - offset;
        this.bit += 8 - offset;
        continue;
      }
      const lead = Math.clz32(rest) - 24;
      zeros += lead;
      this.bit += lead + 1;
      return zeros;
    }
  }

  alignToByte() {
    this.bit = Math.ceil(this.bit / 8) * 8;
  }
}
