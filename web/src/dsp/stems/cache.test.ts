import { describe, expect, it } from 'vitest';
import { decodeStems, encodeStems, readStemWindow, stemCacheKey, writeStemWindow, type StemCacheIo } from './cache';
import { HEAD_WINDOW_S, cutStereoWindow, resampleLinear, stemWindow, transitionWindows, type StemSongRef } from './windows';

const SHA = 'ab'.repeat(32);

function memoryIo() {
  const entries = new Map<string, ArrayBuffer>();
  const io: StemCacheIo = {
    write: async (key, bytes) => {
      entries.set(key, bytes.slice().buffer);
      return { ok: true };
    },
    read: async (key) => entries.get(key) ?? null,
    evict: async (key) => { entries.delete(key); },
  };
  return { entries, io };
}

describe('stem cache keys', () => {
  it('share by content hash only when content caching is on', () => {
    const song = { songId: 7, contentSha256: SHA };
    const window = { startMs: 120000, endMs: 180000 };
    expect(stemCacheKey(song, window, { workspaceId: 'ws1', shared: true })).toBe(`stems-v1-${SHA}-htdemucs-onnx-v1-120000-180000-44100`);
    expect(stemCacheKey(song, window, { workspaceId: 'ws1', shared: false })).toBe('stems-v1-ws1:7-htdemucs-onnx-v1-120000-180000-44100');
    expect(stemCacheKey({ songId: 7, contentSha256: 'not-a-hash' }, window, { workspaceId: 'ws1', shared: true })).toContain('ws1:7');
  });

  it('change when the splitter implementation changes', () => {
    const key = (implementation: string) => stemCacheKey({ songId: 1 }, { startMs: 0, endMs: 1 }, { workspaceId: 'w', shared: false }, implementation);
    expect(key('htdemucs-onnx-v1')).not.toBe(key('htdemucs-onnx-v2'));
  });
});

describe('stem encoding', () => {
  it('round-trips eight channels within 16-bit precision', () => {
    const planes = Array.from({ length: 8 }, (_, plane) => Float32Array.from({ length: 500 }, (_, index) => Math.sin(index / (plane + 2)) * (plane + 1) * 0.3));
    const decoded = decodeStems(encodeStems(planes, 44100).slice().buffer);
    expect(decoded?.sampleRate).toBe(44100);
    expect(decoded?.planes).toHaveLength(8);
    decoded?.planes.forEach((plane, index) => {
      const peak = (index + 1) * 0.3;
      for (let frame = 0; frame < plane.length; frame += 1) expect(Math.abs(plane[frame] - planes[index][frame])).toBeLessThan(peak / 30000);
    });
  });

  it('treats silence and garbage honestly', () => {
    expect(decodeStems(encodeStems([new Float32Array(4), new Float32Array(4)], 44100).slice().buffer)?.planes[0]).toEqual(new Float32Array(4));
    expect(decodeStems(new Uint8Array(40).buffer)).toBeNull();
  });

  it('writes and reads a window as named stereo stems; a malformed entry is evicted as a miss', async () => {
    const { entries, io } = memoryIo();
    const scope = { workspaceId: 'ws', shared: false };
    const song = { songId: 3 };
    const window = { startMs: 0, endMs: 1000 };
    const planes = Array.from({ length: 8 }, (_, plane) => new Float32Array(10).fill((plane + 1) / 10));
    expect(await writeStemWindow(song, window, scope, planes, io)).toEqual({ ok: true });
    const set = await readStemWindow(song, window, scope, io);
    expect(set?.implementation).toBe('htdemucs-onnx-v1');
    expect(set?.stems.vocals[1][0]).toBeCloseTo(0.8, 4);
    expect(set?.stems.drums[0][0]).toBeCloseTo(0.1, 4);
    const key = stemCacheKey(song, window, scope);
    entries.set(key, new Uint8Array(3).buffer);
    expect(await readStemWindow(song, window, scope, io)).toBeNull();
    expect(entries.has(key)).toBe(false);
  });
});

describe('stem windows', () => {
  const songs: StemSongRef[] = [
    { songId: 1, durationS: 200 },
    { songId: 2, durationS: 30 },
    { songId: 3, durationS: 240.5 },
  ];

  it('takes the outgoing tail and incoming head, clamped to short songs', () => {
    expect(stemWindow(200, 'tail')).toEqual({ role: 'tail', startMs: 140000, endMs: 200000 });
    expect(stemWindow(200, 'head')).toEqual({ role: 'head', startMs: 0, endMs: HEAD_WINDOW_S * 1000 });
    expect(stemWindow(30, 'tail')).toEqual({ role: 'tail', startMs: 0, endMs: 30000 });
    expect(stemWindow(0, 'head')).toBeNull();
  });

  it('orders work as needed: current tail, next head, then the following seam', () => {
    const plan = transitionWindows(songs, 0, 2).map(({ song, window }) => `${song.songId}:${window.role}`);
    expect(plan).toEqual(['1:tail', '2:head', '2:tail', '3:head']);
    expect(transitionWindows(songs, 2)).toEqual([]);
  });

  it('cuts stereo 44.1 kHz from any decoded audio', () => {
    const mono = Float32Array.from({ length: 48000 }, (_, index) => index / 48000);
    const audio = { sampleRate: 48000, numberOfChannels: 1, length: 48000, getChannelData: () => mono };
    const [left, right] = cutStereoWindow(audio, { role: 'head', startMs: 0, endMs: 500 });
    expect(left.length).toBe(22050);
    expect(right).not.toBe(left);
    expect(right[100]).toBe(left[100]);
    expect(resampleLinear(Float32Array.from([0, 1]), 2, 4)).toEqual(Float32Array.from([0, 0.5, 1, 1]));
  });
});
