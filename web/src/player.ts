import { MixItem, post, SeamState } from './api';
import { saveResume } from './lib';

/** Plays a mix with no gaps, by scheduling finished audio on the sound card's own clock.
 *
 * Songs and seams arrive whole, so nothing is rendered while playing, and a busy machine can't make
 * it stutter. A seam starts on the exact sample its song reaches it, with a 30 ms crossfade, because
 * both sides hold the same audio there. If a seam can't be made, Selecta falls back to its own pick.
 * If nothing is ready in time, the song plays on and the next one fades in, so a set is never silent.
 *
 * The mix can change while it plays: songs can be moved, swapped or removed, so the player finds its
 * place by song, and drops a planned seam if what it leads to has changed.
 */

export type NowState = {
  phase: 'idle' | 'loading' | 'playing' | 'paused';
  position: number;
  songTime: number;
  duration: number;
  inSeam: boolean;
  seamAt: number | null;
  notice: string;
  nextReady: boolean;
  lastSeamKey: string | null;
};

const SEAM_FADE = 0.03;
const HEADROOM = 0.25;
const KEEP_SONGS = 3;
const END_FADE = 3;
const LOAD_NEXT_WITHIN = 45;
const SKIP_LEAD = 8;
const SAVE_EVERY = 5;

type Playing = { source: AudioBufferSourceNode; gain: GainNode };
type Current = Playing & {
  songId: number;
  position: number;
  startedAt: number;
  offset: number;
  duration: number;
};
type Planned = {
  whenA: number;
  clip: Playing;
  next: Current;
  switchAt: number;
  key: string;
};

export class SetPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private songs = new Map<number, Promise<AudioBuffer>>();
  private clips = new Map<string, Promise<AudioBuffer>>();
  private timer: number | null = null;
  private current: Current | null = null;
  private planned: Planned | null = null;
  private ending = false;
  private requested = new Set<string>();
  private fallenBack = new Set<number>();
  private savedAt = 0;
  private getMix: () => MixItem[];
  private refreshMix: () => void;
  state: NowState = {
    phase: 'idle',
    position: 0,
    songTime: 0,
    duration: 0,
    inSeam: false,
    seamAt: null,
    notice: '',
    nextReady: false,
    lastSeamKey: null,
  };
  onChange: (state: NowState) => void = () => {};

  constructor(getMix: () => MixItem[], refreshMix: () => void) {
    this.getMix = getMix;
    this.refreshMix = refreshMix;
  }

  private audio(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: 44100 });
      this.master = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.78;
      this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
      this.master.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    return this.context;
  }

  /** The mixed output's frequency bands, sampled only by the visualizer. */
  getSpectrum(): Uint8Array | null {
    if (!this.analyser || !this.spectrum) return null;
    this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
  }

  private update(changes: Partial<NowState>) {
    this.state = { ...this.state, ...changes };
    this.onChange(this.state);
  }

  /** Point at a place in the mix without playing, after a reload. Browsers need a tap to play. */
  cue(position: number, time: number) {
    const item = this.getMix()[position];
    if (!item || this.state.phase !== 'idle') return;
    this.update({ position, songTime: time, duration: item.duration });
  }

  private loadSong(id: number): Promise<AudioBuffer> {
    let found = this.songs.get(id);
    if (!found) {
      found = fetch(`/api/songs/${id}/audio`).then(async (response) => {
        if (!response.ok) throw new Error('That song isn’t available.');
        return this.audio().decodeAudioData(await response.arrayBuffer());
      });
      found.catch(() => this.songs.delete(id));
      this.songs.set(id, found);
      while (this.songs.size > KEEP_SONGS) {
        this.songs.delete(this.songs.keys().next().value as number);
      }
    }
    return found;
  }

  private loadClip(key: string): Promise<AudioBuffer> {
    let found = this.clips.get(key);
    if (!found) {
      found = fetch(`/api/seams/${key}/clip`).then(async (response) => {
        if (!response.ok) throw new Error('That seam isn’t available.');
        return this.audio().decodeAudioData(await response.arrayBuffer());
      });
      found.catch(() => this.clips.delete(key));
      this.clips.set(key, found);
      if (this.clips.size > KEEP_SONGS) this.clips.delete(this.clips.keys().next().value as string);
    }
    return found;
  }

  private layer(buffer: AudioBuffer): Playing {
    const context = this.audio();
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(this.master!);
    return { source, gain };
  }

  private silence(playing: Playing | undefined | null) {
    if (!playing) return;
    const now = this.context?.currentTime ?? 0;
    playing.gain.gain.cancelScheduledValues(now);
    try {
      playing.source.stop();
    } catch {
      /* a layer that hasn't started can't be stopped, and that's fine */
    }
    playing.source.disconnect();
  }

  private stopAll() {
    this.silence(this.current);
    this.silence(this.planned?.clip);
    this.silence(this.planned?.next);
    this.current = null;
    this.planned = null;
    this.ending = false;
  }

  /** Take back a planned seam, because the song after this one has changed. */
  private unplan() {
    const planned = this.planned;
    const current = this.current;
    if (!planned || !current || !this.context) return;
    this.silence(planned.clip);
    this.silence(planned.next);
    const now = this.context.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(1, now);
    // calling stop again replaces the earlier stop time
    current.source.stop(current.startedAt + (current.duration - current.offset) + 1);
    this.planned = null;
  }

  async playFrom(position: number, offset = 0) {
    const mix = this.getMix();
    const item = mix[position];
    if (!item) return;
    this.stopAll();
    const context = this.audio();
    await context.resume();
    this.update({ phase: 'loading', position, songTime: offset, duration: item.duration, notice: '', inSeam: false });
    let buffer: AudioBuffer;
    try {
      buffer = await this.loadSong(item.song_id);
    } catch (error) {
      this.update({ phase: 'idle', notice: (error as Error).message });
      return;
    }
    const playing = this.layer(buffer);
    const startedAt = context.currentTime + 0.05;
    playing.gain.gain.setValueAtTime(1, startedAt);
    playing.source.start(startedAt, offset);
    this.current = { ...playing, songId: item.song_id, position, startedAt, offset, duration: buffer.duration };
    this.requested.clear();
    this.update({ phase: 'playing', duration: buffer.duration });
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 50);
    this.tick();
  }

  async togglePause() {
    const context = this.audio();
    if (this.state.phase === 'playing') {
      await context.suspend();
      this.update({ phase: 'paused' });
    } else if (this.state.phase === 'paused') {
      await context.resume();
      this.update({ phase: 'playing' });
    } else if (this.state.phase === 'idle') {
      await this.playFrom(this.state.position, this.state.songTime);
    }
  }

  /** Jump to just before the next seam. Past that point, or with no seam ready, go straight on. */
  async skip() {
    const mix = this.getMix();
    const current = this.current;
    if (!current) return;
    const seam = mix[current.position + 1]?.seam?.state;
    if (seam?.status === 'ready' && seam.a_source_start !== undefined) {
      const target = Math.max(seam.a_source_start - SKIP_LEAD, 0);
      if (target > this.songTime() + 1) {
        await this.playFrom(current.position, target);
        this.update({ notice: 'Jumped to just before the seam.' });
        return;
      }
    }
    if (mix[current.position + 1]) {
      await this.playFrom(current.position + 1);
      this.update({ notice: seam?.status === 'ready' ? '' : 'That seam wasn’t ready, so this skipped straight on.' });
    }
  }

  stop() {
    this.stopAll();
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.update({ phase: 'idle', notice: '', position: 0, songTime: 0, inSeam: false, seamAt: null });
  }

  private songTime(): number {
    if (!this.current || !this.context) return 0;
    const played = this.current.offset + Math.max(0, this.context.currentTime - this.current.startedAt);
    return Math.min(played, this.current.duration);
  }

  private requestSeam(item: MixItem, seam: SeamState) {
    if (seam.status === 'failed') {
      // whatever was chosen won't work here, so let Selecta pick, unless that's what failed
      const chosen = item.seam?.settings.move ?? 'auto';
      if (chosen === 'auto' || this.fallenBack.has(item.position)) return;
      this.fallenBack.add(item.position);
      post(`/mix/${item.position}/seam`, { move: 'auto' })
        .then(() => post(`/mix/${item.position}/render`))
        .then(() => this.refreshMix())
        .catch(() => {});
      this.update({ notice: `That move couldn’t work into ${item.title}, so Selecta picked another.` });
      return;
    }
    if ((seam.status === 'none' || seam.status === 'queued') && !this.requested.has(seam.key)) {
      this.requested.add(seam.key);
      post(`/mix/${item.position}/render`).then(() => this.refreshMix()).catch(() => {});
    }
  }

  private tick() {
    const context = this.context;
    if (!context || !this.current || this.state.phase === 'paused') return;
    const mix = this.getMix();
    const now = context.currentTime;

    // A planned seam has passed its switch point: B is now the song on screen.
    if (this.planned && now >= this.planned.whenA + this.planned.switchAt) {
      this.current = this.planned.next;
      const key = this.planned.key;
      this.planned = null;
      this.requested.clear();
      this.ending = false;
      this.update({ duration: this.current.duration, lastSeamKey: key });
      this.refreshMix();
    }

    const current = this.current;
    // the mix may have been edited, so find our place by song
    const found = mix.findIndex((item) => item.song_id === current.songId);
    if (found >= 0) current.position = found;
    const nextItem = mix[current.position + 1];
    const seam: SeamState | undefined = nextItem?.seam?.state;

    if (this.planned && (!seam || seam.key !== this.planned.key) && now < this.planned.whenA - 0.1) {
      this.unplan();
    }

    const time = this.songTime();
    const inSeam = !!this.planned && now >= this.planned.whenA;
    this.update({
      position: current.position,
      songTime: time,
      inSeam,
      seamAt: seam?.status === 'ready' ? (seam.a_source_start ?? null) : null,
      nextReady: seam?.status === 'ready',
    });

    if (now - this.savedAt > SAVE_EVERY) {
      this.savedAt = now;
      saveResume({ songId: current.songId, position: current.position, time });
    }

    if (!nextItem) {
      if (now > current.startedAt + (current.duration - current.offset)) this.update({ phase: 'idle', songTime: 0 });
      return;
    }
    if (seam) this.requestSeam(nextItem, seam);
    if (!this.planned && seam?.status === 'ready') {
      this.loadSong(nextItem.song_id).catch(() => {});
      void this.plan(current, nextItem, seam);
    }
    const left = current.duration - time;
    if (left < LOAD_NEXT_WITHIN) this.loadSong(nextItem.song_id).catch(() => {});
    if (!this.planned && !this.ending && left < END_FADE + 0.2 && this.state.phase === 'playing') {
      this.ending = true;
      void this.fadeInto(nextItem.position);
    }
  }

  private async plan(current: Current, nextItem: MixItem, seam: SeamState) {
    if (this.planned || seam.a_source_start === undefined) return;
    const context = this.audio();
    let clipBuffer: AudioBuffer;
    let nextBuffer: AudioBuffer;
    try {
      [clipBuffer, nextBuffer] = await Promise.all([this.loadClip(seam.key), this.loadSong(nextItem.song_id)]);
    } catch {
      return;
    }
    if (this.planned || this.current !== current) return;
    const whenA = current.startedAt + (seam.a_source_start - current.offset);
    if (whenA < context.currentTime + HEADROOM) return; // too late: the song plays on and fades over
    const clip = this.layer(clipBuffer);
    clip.gain.gain.setValueAtTime(0, whenA);
    clip.gain.gain.linearRampToValueAtTime(1, whenA + SEAM_FADE);
    clip.source.start(whenA);
    current.gain.gain.setValueAtTime(1, whenA);
    current.gain.gain.linearRampToValueAtTime(0, whenA + SEAM_FADE);
    current.source.stop(whenA + SEAM_FADE + 0.02);

    const clipEnd = whenA + clipBuffer.duration;
    clip.gain.gain.setValueAtTime(1, clipEnd - SEAM_FADE);
    clip.gain.gain.linearRampToValueAtTime(0, clipEnd);
    const after = this.layer(nextBuffer);
    const offset = (seam.b_source_end ?? 0) - SEAM_FADE;
    after.gain.gain.setValueAtTime(0, clipEnd - SEAM_FADE);
    after.gain.gain.linearRampToValueAtTime(1, clipEnd);
    after.source.start(clipEnd - SEAM_FADE, offset);
    this.planned = {
      whenA,
      clip,
      key: seam.key,
      switchAt: seam.switch_at ?? 0,
      next: {
        ...after,
        songId: nextItem.song_id,
        position: nextItem.position,
        startedAt: clipEnd - SEAM_FADE,
        offset,
        duration: nextBuffer.duration,
      },
    };
  }

  /** Nothing ready in time: bring the next song in over the end of this one. */
  private async fadeInto(position: number) {
    const item = this.getMix()[position];
    const current = this.current;
    if (!item || !current) return;
    const context = this.audio();
    let buffer: AudioBuffer;
    try {
      buffer = await this.loadSong(item.song_id);
    } catch {
      const following = this.getMix()[position + 1];
      if (following) {
        this.update({ notice: `${item.title} wouldn’t load, so this skipped it.` });
        await this.fadeInto(position + 1);
      } else {
        this.stopAll();
        this.update({ phase: 'idle', notice: `${item.title} wouldn’t load, so the mix stopped here.` });
      }
      return;
    }
    if (this.current !== current) return;
    const playing = this.layer(buffer);
    const at = Math.max(context.currentTime + 0.05, current.startedAt + (current.duration - current.offset) - END_FADE);
    playing.gain.gain.setValueAtTime(0, at);
    playing.gain.gain.linearRampToValueAtTime(1, at + END_FADE);
    playing.source.start(at);
    this.current = { ...playing, songId: item.song_id, position, startedAt: at, offset: 0, duration: buffer.duration };
    this.requested.clear();
    this.ending = false;
    this.update({
      position,
      duration: buffer.duration,
      notice: 'That seam wasn’t ready in time, so this one faded in.',
    });
  }
}
