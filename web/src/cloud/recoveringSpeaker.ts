import { audioSpeaker } from '../devices/audioSpeaker';
import type { Position, Speaker } from '../devices/usePlaybackDevice';

// The Cloud speaker with media failure recovery (AV-0419-05, flag `cloud.single_audio_owner`).
//
// The plain speaker (devices/audioSpeaker.ts) plays from a cached copy or link per song; when
// the element fails (an expired link, a corrupt file, a network drop before the copy was made)
// it simply stops making sound while the session still says "playing". This wrapper hears the
// element's `error` while it is the speaker and recovers honestly:
//
// 1. Once per song, it throws away the cached copies and asks the source for a fresh link,
//    putting the playhead back where it was and keeping play or pause as it was.
// 2. If that fails too, it moves to the next song and says which song could not be played.
// 3. Past the end of the list, it stops and says so, rather than retrying for ever.
//
// The next heartbeat carries the new position, so every remote follows what really plays.

export type SpeakerProblem = (message: string) => void;

export function recoveringSpeaker(
  audio: HTMLAudioElement,
  source: (index: number) => Promise<string | null>,
  { onProblem, songName = () => null, make = audioSpeaker }: {
    onProblem: SpeakerProblem;
    songName?: (index: number) => string | null;
    make?: typeof audioSpeaker;
  },
): Speaker {
  let inner = make(audio, source);
  let disposed = false;
  let retried = -1;
  let last: Position | null = null;
  let recovering = false;
  let failedAgain = false;

  const label = (index: number) => songName(index) ?? `Song ${index + 1}`;

  const recover = async () => {
    const at = inner.position() ?? last;
    if (disposed || recovering || !at) return;
    recovering = true;
    try {
      if (retried !== at.song_index) {
        retried = at.song_index;
        // A fresh speaker has no cached copies, so the source is asked for a new link.
        inner.dispose?.();
        inner = make(audio, source);
        await inner.start(at.song_index, at.offset_ms, at.state === 'playing');
        return;
      }
      const next = at.song_index + 1;
      const url = await source(next).catch(() => null);
      if (disposed) return;
      if (!url) {
        inner.stop(0);
        last = null;
        onProblem(`${label(at.song_index)} could not be played and there is no next song, so playback stopped.`);
        return;
      }
      onProblem(`${label(at.song_index)} could not be played, so SelectaDJ moved to the next song.`);
      await inner.start(next, 0, true);
    } finally {
      recovering = false;
      // The fresh link failed while recovery was under way: take the next step now.
      if (failedAgain && !disposed) { failedAgain = false; void recover(); }
    }
  };

  const onError = () => {
    // Only while this device is the speaker: an emptied element (stopped, disposed) also errors.
    if (disposed || !audio.getAttribute('src')) return;
    if (recovering) { failedAgain = true; return; }
    void recover();
  };
  audio.addEventListener('error', onError);

  return {
    async start(songIndex, offsetMs, playing) {
      last = { song_index: songIndex, offset_ms: offsetMs, state: playing ? 'playing' : 'paused' };
      await inner.start(songIndex, offsetMs, playing);
    },
    stop(fadeMs) { last = null; inner.stop(fadeMs); },
    pause() { inner.pause(); },
    resume() { inner.resume(); },
    position() {
      const at = inner.position();
      if (at) last = at;
      return at;
    },
    active() { return inner.active(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      audio.removeEventListener('error', onError);
      inner.dispose?.();
    },
  };
}
