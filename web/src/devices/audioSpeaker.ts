import type { Position, Speaker } from './usePlaybackDevice';

// A speaker made from one <audio> element and a list of songs. `source(index)` gives the URL of
// song `index` (or null past the end). Stopping fades the volume out over `fadeMs`, so a device
// that loses the lease never cuts off mid-note and never keeps playing under the new speaker.
//
// The playing song and the next two are downloaded whole and played from local copies, so a
// speaker that drops off the network keeps playing (docs/saas/11a-devices-and-rooms.md, "When the
// speaker loses its connection"). Where a copy can't be made (a cross-origin link without CORS),
// it plays from the link itself, as before.

export function audioSpeaker(audio: HTMLAudioElement, source: (index: number) => Promise<string | null>): Speaker {
  let index = -1;
  let fade = 0;
  let generation = 0;
  let disposed = false;
  const copies = new Map<number, Promise<string | null>>();

  const copy = (songIndex: number): Promise<string | null> => {
    let made = copies.get(songIndex);
    if (!made) {
      made = (async () => {
        const url = await source(songIndex);
        if (disposed) return null;
        if (!url || typeof fetch !== 'function' || typeof URL.createObjectURL !== 'function') return url;
        try {
          const answer = await fetch(url);
          if (!answer.ok) return url;
          const blob = await answer.blob();
          if (disposed) return null;
          return URL.createObjectURL(blob);
        } catch {
          return url;
        }
      })();
      copies.set(songIndex, made);
    }
    return made;
  };

  /** Keep the song before (it may still be fading), this one and the next two; drop the rest. */
  const keepAround = (songIndex: number) => {
    for (const [held, made] of [...copies]) {
      if (held < songIndex - 1 || held > songIndex + 2) {
        copies.delete(held);
        void made.then((url) => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); });
      }
    }
    void copy(songIndex + 1);
    void copy(songIndex + 2);
  };

  const clearFade = () => { window.clearInterval(fade); fade = 0; audio.volume = 1; };

  const onEnded = () => {
    if (!disposed && index >= 0) void speaker.start(index + 1, 0, true);
  };
  audio.addEventListener('ended', onEnded);

  const speaker: Speaker = {
    async start(songIndex, offsetMs, playing) {
      if (disposed) return;
      const mine = ++generation;
      clearFade();
      const url = await copy(songIndex);
      if (disposed || mine !== generation) return;
      keepAround(songIndex);
      if (!url) { audio.pause(); index = -1; return; }
      index = songIndex;
      if (audio.src !== url) audio.src = url;
      await new Promise<void>((resolve) => {
        if (audio.readyState >= 1) { resolve(); return; }
        audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
        audio.addEventListener('error', () => resolve(), { once: true });
      });
      if (disposed || mine !== generation) return;
      try { audio.currentTime = Math.max(0, offsetMs / 1000); } catch { /* not seekable yet */ }
      if (playing) await audio.play().catch(() => undefined);
      else audio.pause();
    },
    stop(fadeMs) {
      generation++;
      window.clearInterval(fade);
      // Forget the song now, not when the fade ends: a song that ends mid-fade must not start
      // the next one at full volume on a device that is no longer the speaker.
      index = -1;
      if (audio.paused || fadeMs <= 0) { audio.pause(); audio.volume = 1; return; }
      const steps = 10;
      let step = 0;
      fade = window.setInterval(() => {
        step++;
        audio.volume = Math.max(0, 1 - step / steps);
        if (step >= steps) { window.clearInterval(fade); fade = 0; audio.pause(); audio.volume = 1; }
      }, fadeMs / steps);
    },
    pause() { audio.pause(); },
    resume() { void audio.play().catch(() => undefined); },
    position(): Position | null {
      if (index < 0) return null;
      return { song_index: index, offset_ms: Math.round(audio.currentTime * 1000), state: audio.paused ? 'paused' : 'playing' };
    },
    active() { return !disposed && index >= 0 && !audio.paused; },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      index = -1;
      window.clearInterval(fade);
      fade = 0;
      audio.pause();
      audio.removeEventListener('ended', onEnded);
      for (const made of copies.values()) {
        void made.then((url) => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); });
      }
      copies.clear();
      audio.removeAttribute('src');
    },
  };
  return speaker;
}
