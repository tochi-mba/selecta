import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioSpeaker } from './audioSpeaker';

// SC-0415-04: the speaker plays from local copies of this song and the next two, so a dropped
// connection doesn't stop the music; copies it no longer needs are let go.

function fakeAudio(): HTMLAudioElement {
  const audio = document.createElement('audio');
  Object.defineProperty(audio, 'readyState', { value: 4 });
  audio.play = vi.fn(async () => undefined);
  audio.pause = vi.fn();
  return audio;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the speaker buffers ahead (SC-0415-04)', () => {
  it('plays from a local copy and fetches the next two songs', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { fetched.push(url); return new Response(`audio ${url}`); }));
    let made = 0;
    const revoked: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:copy-${made++}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => { revoked.push(url); });
    const audio = fakeAudio();
    const speaker = audioSpeaker(audio, async (index) => (index < 10 ? `/song/${index}.wav` : null));

    await speaker.start(0, 0, true);
    await vi.waitFor(() => expect(fetched).toEqual(['/song/0.wav', '/song/1.wav', '/song/2.wav']));
    expect(audio.src).toBe('blob:copy-0');

    // Moving on to song 4 keeps 3 to 6 and lets the earlier copies go.
    await speaker.start(4, 0, true);
    await vi.waitFor(() => expect(fetched).toContain('/song/6.wav'));
    await vi.waitFor(() => expect(revoked.length).toBe(3));
    expect(fetched.filter((url) => url === '/song/1.wav')).toHaveLength(1);
  });

  it('plays from the link itself when no copy can be made', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('blocked by CORS'); }));
    const audio = fakeAudio();
    const speaker = audioSpeaker(audio, async () => 'https://r2.example/signed.wav');
    await speaker.start(0, 0, true);
    expect(audio.src).toBe('https://r2.example/signed.wav');
    expect(audio.play).toHaveBeenCalled();
  });
});
