import { get, MixItem, post, SeamState } from './api';

/** Plays a mix with no gaps, by scheduling finished audio on the sound card's own clock.
 *
 * Songs and seams arrive whole, so nothing is rendered while playing, and a busy machine can't make
 * it stutter. A seam starts on the exact sample its song reaches it, with a 30 ms crossfade, because
 * both sides hold the same audio there. If a seam isn't ready in time the song plays on, and the
 * next song fades in at the end, so a set is never silent.
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
const SKIP_LEAD = 8;

type Playing = { source: AudioBufferSourceNode; gain: GainNode };
type Current = Playing & {
  position: number;
  startedAt: number;
  offset: number;
  duration: number;
};
type Planned = {
  fromPosition: number;
  whenA: number;
  clip: Playing;
  next: Current;
  switchAt: number;
  key: string;
};

export class SetPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private songs = new Map<number, Promise<AudioBuffer>>();
  private clips = new Map<string, Promise<AudioBuffer>>();
  private timer: number | null = null;
  private current: Current | null = null;
  private planned: Planned | null = null;
  private ending = false;
  private requested = new Set<number>();
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
      this.master.connect(this.context.destination);
    }
    return this.context;
  }

  private update(changes: Partial<NowState>) {
    this.state = { ...this.state, ...changes };
    this.onChange(this.state);
  }

  private loadSong(id: number): Promise<AudioBuffer> {
    let found = this.songs.get(id);
    if (!found) {
      found = fetch(`/api/songs/${id}/audio`)
        .then((response) => response.arrayBuffer())
        .then((data) => this.audio().decodeAudioData(data));
      this.songs.set(id, found);
      while (this.songs.size > KEEP_SONGS) {
        const oldest = this.songs.keys().next().value as number;
        this.songs.delete(oldest);
      }
    }
    return found;
  }

  private loadClip(key: string): Promise<AudioBuffer> {
    let found = this.clips.get(key);
    if (!found) {
      found = fetch(`/api/seams/${key}/clip`)
        .then((response) => response.arrayBuffer())
        .then((data) => this.audio().decodeAudioData(data));
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

  private stopAll() {
    const now = this.context?.currentTime ?? 0;
    for (const playing of [this.current, this.planned?.clip, this.planned?.next]) {
      if (!playing) continue;
      playing.gain.gain.cancelScheduledValues(now);
      try {
        playing.source.stop();
      } catch {
        /* a layer that hasn't started can't be stopped, and that's fine */
      }
      playing.source.disconnect();
    }
    this.current = null;
    this.planned = null;
    this.ending = false;
  }

  async playFrom(position: number, offset = 0) {
    const mix = this.getMix();
    const item = mix[position];
    if (!item) return;
    this.stopAll();
    const context = this.audio();
    await context.resume();
    this.update({ phase: 'loading', position, songTime: offset, duration: item.duration, notice: '', inSeam: false });
    const buffer = await this.loadSong(item.song_id);
    const playing = this.layer(buffer);
    const startedAt = context.currentTime + 0.05;
    playing.gain.gain.setValueAtTime(1, startedAt);
    playing.source.start(startedAt, offset);
    this.current = { ...playing, position, startedAt, offset, duration: buffer.duration };
    this.requested.clear();
    this.update({ phase: 'playing', duration: buffer.duration });
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 200);
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
    } else {
      await this.playFrom(this.state.position);
    }
  }

  /** Jump to just before the next seam. Press again if it isn't ready, and the next song fades in. */
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
    this.update({ phase: 'idle', notice: '' });
  }

  private songTime(): number {
    if (!this.current || !this.context) return 0;
    return this.current.offset + Math.max(0, this.context.currentTime - this.current.startedAt);
  }

  private tick() {
    const context = this.context;
    if (!context || !this.current) return;
    const mix = this.getMix();
    const now = context.currentTime;

    // A planned seam has passed its switch point: B is now the song on screen.
    if (this.planned && now >= this.planned.whenA + this.planned.switchAt) {
      this.current = this.planned.next;
      const key = this.planned.key;
      this.planned = null;
      this.requested.clear();
      this.ending = false;
      this.update({ position: this.current.position, duration: this.current.duration, lastSeamKey: key });
      this.refreshMix();
    }

    const current = this.current;
    const time = this.songTime();
    const inSeam = !!this.planned && now >= this.planned.whenA;
    const nextItem = mix[current.position + 1];
    const seam: SeamState | undefined = nextItem?.seam?.state;
    this.update({
      songTime: time,
      inSeam,
      seamAt: seam?.status === 'ready' ? (seam.a_source_start ?? null) : null,
      nextReady: seam?.status === 'ready',
    });

    if (!nextItem) {
      if (now > current.startedAt + (current.duration - current.offset)) this.update({ phase: 'idle' });
      return;
    }
    if (seam && seam.status !== 'ready' && seam.status !== 'failed' && !this.requested.has(nextItem.position)) {
      this.requested.add(nextItem.position);
      post(`/mix/${nextItem.position}/render`).then(() => this.refreshMix()).catch(() => {});
    }
    if (!this.planned && seam?.status === 'ready') {
      this.loadSong(nextItem.song_id).catch(() => {});
      this.plan(current, nextItem, seam);
    }
    const left = current.duration - time;
    if (!this.planned && !this.ending && left < END_FADE + 0.2 && this.state.phase === 'playing') {
      this.ending = true;
      this.fadeInto(nextItem.position);
    }
  }

  private async plan(current: Current, nextItem: MixItem, seam: SeamState) {
    if (this.planned || seam.a_source_start === undefined) return;
    const context = this.audio();
    const [clipBuffer, nextBuffer] = await Promise.all([
      this.loadClip(seam.key),
      this.loadSong(nextItem.song_id),
    ]);
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
      fromPosition: current.position,
      whenA,
      clip,
      key: seam.key,
      switchAt: seam.switch_at ?? 0,
      next: {
        ...after,
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
    const buffer = await this.loadSong(item.song_id);
    const playing = this.layer(buffer);
    const at = Math.max(context.currentTime + 0.05, current.startedAt + (current.duration - current.offset) - END_FADE);
    playing.gain.gain.setValueAtTime(0, at);
    playing.gain.gain.linearRampToValueAtTime(1, at + END_FADE);
    playing.source.start(at);
    this.current = { ...playing, position, startedAt: at, offset: 0, duration: buffer.duration };
    this.requested.clear();
    this.ending = false;
    this.update({
      position,
      duration: buffer.duration,
      notice: 'That seam wasn’t ready in time, so this one faded in.',
    });
  }
}

export const refreshSeam = (key: string) => get<SeamState>(`/seams/${key}`);
