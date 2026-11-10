import type { Position, Speaker } from './usePlaybackDevice';

// A speaker made from one <audio> element and a list of songs. `source(index)` gives the URL of
// song `index` (or null past the end). Stopping fades the volume out over `fadeMs`, so a device
// that loses the lease never cuts off mid-note and never keeps playing under the new speaker.

export function audioSpeaker(audio: HTMLAudioElement, source: (index: number) => Promise<string | null>): Speaker {
  let index = -1;
  let fade = 0;
  let generation = 0;

  const clearFade = () => { window.clearInterval(fade); fade = 0; audio.volume = 1; };

  audio.addEventListener('ended', () => {
    if (index >= 0) void speaker.start(index + 1, 0, true);
  });

  const speaker: Speaker = {
    async start(songIndex, offsetMs, playing) {
      const mine = ++generation;
      clearFade();
      const url = await source(songIndex);
      if (mine !== generation) return;
      if (!url) { audio.pause(); index = -1; return; }
      index = songIndex;
      if (audio.src !== url) audio.src = url;
      await new Promise<void>((resolve) => {
        if (audio.readyState >= 1) { resolve(); return; }
        audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
        audio.addEventListener('error', () => resolve(), { once: true });
      });
      if (mine !== generation) return;
      try { audio.currentTime = Math.max(0, offsetMs / 1000); } catch { /* not seekable yet */ }
      if (playing) await audio.play().catch(() => undefined);
      else audio.pause();
    },
    stop(fadeMs) {
      generation++;
      window.clearInterval(fade);
      if (audio.paused || fadeMs <= 0) { audio.pause(); audio.volume = 1; index = -1; return; }
      const steps = 10;
      let step = 0;
      fade = window.setInterval(() => {
        step++;
        audio.volume = Math.max(0, 1 - step / steps);
        if (step >= steps) { window.clearInterval(fade); fade = 0; audio.pause(); audio.volume = 1; index = -1; }
      }, fadeMs / steps);
    },
    pause() { audio.pause(); },
    resume() { void audio.play().catch(() => undefined); },
    position(): Position | null {
      if (index < 0) return null;
      return { song_index: index, offset_ms: Math.round(audio.currentTime * 1000), state: audio.paused ? 'paused' : 'playing' };
    },
    active() { return index >= 0 && !audio.paused; },
  };
  return speaker;
}
