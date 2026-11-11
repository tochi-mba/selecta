import { MixItem, post, SeamState } from './api';
import { mainPlayerTouched, stopPreviewsOnly } from './audio/focus';
import { saveResume } from './lib';
import { listenEnded, listenStarted } from './lucy/listening';

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
  volume: number;
  muted: boolean;
};

const SEAM_FADE = 0.03;
const KEEP_SONGS = 3;
const END_FADE = 3;
const LOAD_NEXT_WITHIN = 45;
const SKIP_LEAD = 8;
const SAVE_EVERY = 5;
const RESTART_WITHIN = 4;
const SOUND_KEY = 'selecta.sound';
const WAKE_WAIT_MS = 3000;

function savedSound(): { volume: number; muted: boolean } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SOUND_KEY) ?? '{}');
    const volume = typeof saved.volume === 'number' ? Math.min(Math.max(saved.volume, 0), 1) : 1;
    return { volume, muted: saved.muted === true };
  } catch {
    return { volume: 1, muted: false };
  }
}

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

/** Keep the playing *occurrence*, not the first matching recording ID.
 * An artist can deliberately repeat the same track later in a set. If the
 * sequence changes while playing, prefer the nearest remaining occurrence
 * instead of jumping to the first copy of that track.
 */
export function audiblePosition(mix: Pick<MixItem, 'song_id'>[], songId: number, previous: number): number {
  if (mix[previous]?.song_id === songId) return previous;
  let nearest = -1;
  let gap = Infinity;
  for (let index = 0; index < mix.length; index += 1) {
    if (mix[index].song_id !== songId) continue;
    const distance = Math.abs(index - previous);
    if (distance < gap) {
      gap = distance;
      nearest = index;
    }
  }
  return nearest;
}

export class SetPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private output: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private songs = new Map<number, Promise<AudioBuffer>>();
  private clips = new Map<string, Promise<AudioBuffer>>();
  private timer: number | null = null;
  private current: Current | null = null;
  private planned: Planned | null = null;
  private layers = new Set<Playing>();
  private seamTailEnd: number | null = null;
  private passed = new Set<string>();
  private ending = false;
  private playGeneration = 0;
  private holdingSound = false;
  private watchedState: SeamState | null = null;
  private stateRead: AbortController | null = null;
  private stateReadAt = -Infinity;
  private requested = new Set<string>();
  private fallenBack = new Set<number>();
  private savedAt = 0;
  private heard = new Map<number, number>();
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
    ...savedSound(),
  };
  onChange: (state: NowState) => void = () => {};

  constructor(getMix: () => MixItem[], refreshMix: () => void) {
    this.getMix = getMix;
    this.refreshMix = refreshMix;
    // Physical outputs can vanish independently of the Web Audio graph. Never
    // auto-resume a stopped context (especially after intentional Pause).
    // Tell the listener that the output changed without claiming we can detect
    // whether their headphones are actually making sound.
    navigator.mediaDevices?.addEventListener?.('devicechange', () => {
      if (this.state.phase !== 'playing') return;
      if (this.context?.state !== 'running') {
        this.update({ phase: 'paused', notice: 'Audio output changed. Press play to reconnect the sound.' });
      } else {
        this.update({ notice: 'Audio output changed. Check your speakers or headphones if you cannot hear the music.' });
      }
    });
    window.addEventListener('pageshow', () => {
      if (this.state.phase === 'playing' && this.context && this.context.state !== 'running') {
        this.update({ phase: 'paused', notice: 'The sound stopped while this page was away. Press play to continue.' });
      }
    });
  }

  private audio(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: 44100 });
      this.master = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.78;
      this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
      // volume comes after the analyser, so turning it down doesn't flatten the visualizer
      this.output = this.context.createGain();
      this.output.gain.value = this.state.muted ? 0 : this.state.volume;
      this.master.connect(this.analyser);
      this.analyser.connect(this.output);
      this.output.connect(this.context.destination);
      // The system can take the sound away by itself, on a phone call for example. What's on screen
      // follows what's really happening, rather than saying it's playing.
      const context = this.context;
      context.onstatechange = () => {
        if (!this.holdingSound && context.state !== 'running' && this.state.phase === 'playing') {
          this.update({ phase: 'paused', notice: 'The sound was interrupted. Press play to carry on.' });
        }
      };
    }
    return this.context;
  }

  /** Stop the sound on purpose, which isn't the system interrupting it. */
  private async hold(context: AudioContext) {
    this.holdingSound = true;
    try {
      await context.suspend();
    } finally {
      this.holdingSound = false;
    }
  }

  /** Ask for the sound. A browser can refuse without saying so until there's been a tap, by simply
   * never answering, so this stops waiting and reports whether it got it. */
  private async wake(context: AudioContext): Promise<boolean> {
    const isRunning = () => context.state === 'running';
    if (isRunning()) return true;
    let wait: number | undefined;
    try {
      await Promise.race([
        context.resume(),
        new Promise((settled) => { wait = window.setTimeout(settled, WAKE_WAIT_MS); }),
      ]);
    } catch {
      // whether it worked is what's checked next
    } finally {
      window.clearTimeout(wait);
    }
    return isRunning();
  }

  private applySound() {
    if (this.output) this.output.gain.value = this.state.muted ? 0 : this.state.volume;
    try {
      window.localStorage.setItem(SOUND_KEY, JSON.stringify({ volume: this.state.volume, muted: this.state.muted }));
    } catch {
      // it just won't be remembered next time
    }
  }

  setVolume(volume: number) {
    this.update({ volume: Math.min(Math.max(volume, 0), 1), muted: volume <= 0 ? this.state.muted : false });
    this.applySound();
  }

  toggleMute() {
    // Zero volume is already silent. The next press must restore audible sound,
    // not switch an invisible mute flag while leaving volume at zero.
    if (this.state.volume === 0) {
      this.update({ volume: 0.5, muted: false });
    } else {
      this.update({ muted: !this.state.muted });
    }
    this.applySound();
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
        const bytes = await response.arrayBuffer();
        try {
          return await this.audio().decodeAudioData(bytes);
        } catch {
          throw new Error('That song’s audio couldn’t be read.');
        }
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
    const playing = { source, gain };
    this.layers.add(playing);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.layers.delete(playing);
    };
    return playing;
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
    playing.gain.disconnect();
    this.layers.delete(playing);
  }

  private stopAll() {
    this.playGeneration += 1;
    this.stateRead?.abort();
    this.stateRead = null;
    this.watchedState = null;
    this.stateReadAt = -Infinity;
    if (this.current && this.context) {
      const elapsed = Math.max(0, this.context.currentTime - this.current.startedAt);
      this.heard.set(this.current.songId, (this.heard.get(this.current.songId) ?? 0) + elapsed);
    }
    // Include the still-audible seam tail after the display has switched to B,
    // and the outgoing song during a fallback fade.
    for (const layer of this.layers) this.silence(layer);
    this.seamTailEnd = null;
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
    const generation = this.playGeneration;
    const context = this.audio();
    const woken = await this.wake(context);
    if (generation !== this.playGeneration) return;
    if (!woken) {
      this.update({ phase: 'idle', position, songTime: offset, duration: item.duration, inSeam: false, notice: 'Your browser is holding the sound back. Press play to start.' });
      return;
    }
    this.update({ phase: 'loading', position, songTime: offset, duration: item.duration, notice: '', inSeam: false });
    let buffer: AudioBuffer;
    try {
      buffer = await this.loadSong(item.song_id);
    } catch (error) {
      if (generation !== this.playGeneration) return;
      this.update({ phase: 'idle', notice: (error as Error).message });
      return;
    }
    if (generation !== this.playGeneration) return;
    const playing = this.layer(buffer);
    const startedAt = context.currentTime + 0.05;
    playing.gain.gain.setValueAtTime(1, startedAt);
    playing.source.start(startedAt, offset);
    this.current = { ...playing, songId: item.song_id, position, startedAt, offset, duration: buffer.duration };
    this.requested.clear();
    this.update({ phase: 'playing', duration: buffer.duration });
    listenStarted(item.song_id, offset, this.heard.get(item.song_id) ?? 0);
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 50);
    this.tick();
  }

  /** Pause or carry on because something else needs the sound, not because anyone asked. */
  async pause() {
    if (this.state.phase !== 'playing' || !this.context) return;
    await this.hold(this.context);
    this.update({ phase: 'paused' });
  }

  async resume() {
    if (this.state.phase !== 'paused' || !this.context) return;
    if (await this.wake(this.context)) this.update({ phase: 'playing', notice: '' });
    else this.update({ notice: 'Your browser is holding the sound back. Press play to carry on.' });
  }

  /** Is a transition being heard right now? What's already sounding can't be taken back. */
  private transitionIsLive(): boolean {
    const now = this.context?.currentTime ?? 0;
    return (!!this.planned && now >= this.planned.whenA) || this.seamTailEnd !== null;
  }

  /** The next song, straight away. Not the same as jumping to the transition, which still plays it. */
  async next() {
    mainPlayerTouched();
    stopPreviewsOnly();
    const current = this.current;
    // pressed again while the last press is still loading: carry on from where that was going
    if (!current && this.state.phase !== 'loading') return;
    const found = current ? audiblePosition(this.getMix(), current.songId, current.position) : this.state.position;
    // a playing song that was removed has no place: what slid into it comes next, not the top of the mix
    const nextPosition = current && found < 0 ? current.position : found + 1;
    const following = this.getMix()[nextPosition];
    if (!following) return;
    if (!current) {
      await this.playFrom(nextPosition);
      return;
    }
    if (this.transitionIsLive()) {
      this.update({ notice: `Already on the way into ${following.title}.` });
      return;
    }
    const heard = (this.heard.get(current.songId) ?? 0) + Math.max(0, (this.context?.currentTime ?? current.startedAt) - current.startedAt);
    void post('/playback/skip', { song_id: current.songId, heard_seconds: heard, source_position: this.songTime() }).catch(() => {});
    listenEnded(current.songId, 'skip', heard, this.songTime());
    await this.playFrom(nextPosition);
  }

  /** Back to the start of this song, or to the song before if it has only just begun. */
  async previous() {
    mainPlayerTouched();
    stopPreviewsOnly();
    const current = this.current;
    if (!current) {
      if (this.state.phase === 'idle' || this.state.phase === 'loading') await this.playFrom(Math.max(this.state.position - 1, 0));
      return;
    }
    if (this.transitionIsLive()) {
      this.update({ notice: 'A transition is playing. This can go back once it’s finished.' });
      return;
    }
    const position = audiblePosition(this.getMix(), current.songId, current.position);
    if (this.songTime() > RESTART_WITHIN || position <= 0) await this.seek(0);
    else await this.playFrom(position - 1);
  }

  /** Move within this song. A transition already sounding has to finish first. Past the way out,
   * the player asks for another further on rather than playing one late. */
  async seek(seconds: number) {
    mainPlayerTouched();
    // A deliberate seek takes ownership from an audition. Otherwise a
    // preview may continue while playFrom wakes the main AudioContext.
    stopPreviewsOnly();
    if (!Number.isFinite(seconds)) {
      this.update({ notice: 'That seek position is not valid.' });
      return;
    }
    const current = this.current;
    if (!current) {
      if (this.state.phase === 'idle') this.update({ songTime: Math.max(seconds, 0) });
      else if (this.state.phase === 'loading') await this.playFrom(this.state.position, Math.max(seconds, 0));
      return;
    }
    if (this.transitionIsLive()) {
      this.update({ notice: 'A transition is playing. This can move once it’s finished.' });
      return;
    }
    const wasPaused = this.state.phase === 'paused';
    const position = audiblePosition(this.getMix(), current.songId, current.position);
    if (position < 0) return;
    const target = Math.min(Math.max(seconds, 0), Math.max(current.duration - 1, 0));
    await this.playFrom(position, target);
    if (wasPaused) await this.pause();
  }

  async togglePause() {
    mainPlayerTouched();
    stopPreviewsOnly();
    const context = this.audio();
    if (this.state.phase === 'playing') {
      await this.hold(context);
      this.update({ phase: 'paused' });
    } else if (this.state.phase === 'paused') {
      if (await this.wake(context)) this.update({ phase: 'playing', notice: '' });
      else this.update({ notice: 'Your browser is holding the sound back. Press play to carry on.' });
    } else if (this.state.phase === 'idle') {
      await this.playFrom(this.state.position, this.state.songTime);
    }
  }

  /** Jump to just before the next seam. Past that point, or with no seam ready, go straight on. */
  async skip() {
    mainPlayerTouched();
    stopPreviewsOnly();
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
      const heard = (this.heard.get(current.songId) ?? 0) + Math.max(0, (this.context?.currentTime ?? current.startedAt) - current.startedAt);
      void post('/playback/skip', { song_id: current.songId, heard_seconds: heard, source_position: this.songTime() }).catch(() => {});
      listenEnded(current.songId, 'skip', heard, this.songTime());
      await this.playFrom(current.position + 1);
      this.update({ notice: seam?.status === 'ready' ? '' : 'That seam wasn’t ready, so this skipped straight on.' });
    }
  }

  stop() {
    mainPlayerTouched();
    this.stopAll();
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.update({ phase: 'idle', notice: '', position: 0, songTime: 0, inSeam: false, seamAt: null });
  }

  /** How much of this song the main player has sounded, up to `at` on the audio clock. */
  private heardOf(current: Current, at = this.context?.currentTime ?? current.startedAt): number {
    return (this.heard.get(current.songId) ?? 0) + Math.max(0, at - current.startedAt);
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

  /** Watch only the imminent seam, independently of the slower whole-mix UI poll. */
  private watchSeam(current: Current, nextItem: MixItem, seam: SeamState) {
    if (seam.status === 'ready' || seam.status === 'failed' || this.stateRead
      || performance.now() - this.stateReadAt < 100) return;
    const controller = new AbortController();
    this.stateRead = controller;
    this.stateReadAt = performance.now();
    const timeout = window.setTimeout(() => controller.abort(), 2000);
    void fetch(`/api/seams/${encodeURIComponent(seam.key)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const fresh = await response.json() as SeamState;
        const mix = this.getMix();
        const position = audiblePosition(mix, current.songId, current.position);
        const next = mix[position + 1];
        if (controller.signal.aborted || this.current !== current || position < 0
          || next?.song_id !== nextItem.song_id || next.seam?.state.key !== seam.key
          || fresh.key !== seam.key) return;
        if (fresh.status === 'ready') {
          this.watchedState = fresh;
          void this.plan(current, next, fresh);
          this.refreshMix();
        }
      })
      .catch(() => { /* Retry while the original song continues playing. */ })
      .finally(() => {
        window.clearTimeout(timeout);
        if (this.stateRead === controller) this.stateRead = null;
      });
  }

  private tick() {
    const context = this.context;
    if (!context || !this.current || this.state.phase === 'paused') return;
    const mix = this.getMix();
    const now = context.currentTime;

    // A planned seam has passed its switch point: B is now the song on screen.
    if (this.planned && now >= this.planned.whenA + this.planned.switchAt) {
      const left = this.current;
      listenEnded(left.songId, 'complete', this.heardOf(left, this.planned.whenA), left.offset + Math.max(0, this.planned.whenA - left.startedAt));
      this.seamTailEnd = this.planned.next.startedAt + SEAM_FADE;
      this.current = this.planned.next;
      listenStarted(this.current.songId, this.current.offset, this.heard.get(this.current.songId) ?? 0);
      const key = this.planned.key;
      this.planned = null;
      this.requested.clear();
      this.ending = false;
      this.update({ duration: this.current.duration, lastSeamKey: key });
      this.refreshMix();
    }

    const current = this.current;
    // the mix may have been edited, so find our place by song
    const found = audiblePosition(mix, current.songId, current.position);
    if (found >= 0) current.position = found;
    // If the playing song was removed, the song that slid into its place comes next, and the
    // seam listed there leads from a different song, so this one ends on the plain fade.
    const nextItem = mix[found >= 0 ? current.position + 1 : current.position];
    const listedSeam = found >= 0 ? nextItem?.seam?.state : undefined;
    if (this.watchedState?.key !== listedSeam?.key) this.watchedState = null;
    const seam: SeamState | undefined = this.watchedState ?? listedSeam;
    if (nextItem && seam && !this.planned) this.watchSeam(current, nextItem, seam);

    if (this.planned && (!seam || seam.key !== this.planned.key) && now < this.planned.whenA - 0.1) {
      this.unplan();
    }

    const time = this.songTime();
    if (this.seamTailEnd !== null && now >= this.seamTailEnd) this.seamTailEnd = null;
    const inSeam = (!!this.planned && now >= this.planned.whenA) || this.seamTailEnd !== null;
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
      if (now > current.startedAt + (current.duration - current.offset)) {
        listenEnded(current.songId, 'complete', this.heardOf(current), time);
        this.update({ phase: 'idle', songTime: 0 });
      }
      return;
    }
    if (seam) this.requestSeam(nextItem, seam);
    this.watchForPassing(nextItem, seam, time, inSeam);
    if (!this.planned && seam?.status === 'ready') {
      this.loadSong(nextItem.song_id).catch(() => {});
      void this.plan(current, nextItem, seam);
    }
    const left = current.duration - time;
    if (left < LOAD_NEXT_WITHIN) this.loadSong(nextItem.song_id).catch(() => {});
    // A ready seam may start within the normal fallback window. Give its audio
    // until its actual cue to decode; an early fallback must not steal that cue.
    const upcomingCue = seam?.status === 'ready' && seam.a_source_start !== undefined
      && current.startedAt + seam.a_source_start - current.offset >= now;
    if (!inSeam && !this.planned && !this.ending && !upcomingCue && left < END_FADE + 0.2 && this.state.phase === 'playing') {
      this.ending = true;
      void this.fadeInto(nextItem.position);
    }
  }

  /** A seek or a resume can land past the way out, which can't be used from here. Rather than run
   * on to the end and fade, ask for another way out further on. */
  private watchForPassing(nextItem: MixItem, seam: SeamState | undefined, time: number, inSeam: boolean) {
    if (seam?.status !== 'ready' || seam.a_source_start === undefined || time <= seam.a_source_start + 0.5) return;
    if (this.planned || inSeam || this.ending || this.state.phase !== 'playing' || this.passed.has(seam.key)) return;
    this.passed.add(seam.key);
    post<{ moved: boolean }>(`/mix/${nextItem.position}/leave-later`, { after: time })
      .then(({ moved }) => {
        if (!moved) return;
        this.update({ notice: 'That transition has gone by, so Selecta is making another further on.' });
        this.refreshMix();
      })
      .catch(() => {});
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
    const liveMix = this.getMix();
    const livePosition = audiblePosition(liveMix, current.songId, current.position);
    const liveNext = liveMix[livePosition + 1];
    if (livePosition < 0 || liveNext?.song_id !== nextItem.song_id
      || liveNext.seam?.state.key !== seam.key
      || (liveNext.seam.state.status !== 'ready' && this.watchedState?.key !== seam.key)) return;
    const whenA = current.startedAt + (seam.a_source_start - current.offset);
    // Web Audio schedules against its own clock. Do not reject decoded audio
    // merely because it arrived inside an arbitrary quarter-second margin.
    if (whenA < context.currentTime || (this.seamTailEnd !== null && whenA < this.seamTailEnd)) return; // Never play a transition off its cue.
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
      // A failed download from an older playback session must not skip or stop
      // the song the listener has since chosen.
      if (this.current !== current || this.planned) return;
      if (this.getMix()[position]?.song_id !== item.song_id) {
        this.ending = false;
        return;
      }
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
    if (this.current !== current || this.planned) return;
    const liveMix = this.getMix();
    const livePosition = audiblePosition(liveMix, current.songId, current.position);
    // a playing song that was removed keeps its old place, which the following song now holds
    const gone = livePosition < 0;
    if (liveMix[position]?.song_id !== item.song_id || (gone ? position < current.position : position <= livePosition)) {
      this.ending = false;
      // The mix can be compacted while the fallback audio is loading (for
      // example when the song that is still sounding is removed). Re-evaluate
      // the successor immediately instead of waiting for the interval tick;
      // otherwise the old position can consume the whole end-of-song window.
      this.tick();
      return;
    }
    // Rendering can finish while the fallback song downloads. Let the next tick
    // schedule that seam instead of committing a competing fade.
    const listedSeam = gone ? undefined : liveMix[livePosition + 1]?.seam?.state;
    const liveSeam = this.watchedState?.key === listedSeam?.key ? this.watchedState : listedSeam;
    if (liveSeam?.status === 'ready' && liveSeam.a_source_start !== undefined
      && current.startedAt + liveSeam.a_source_start - current.offset >= context.currentTime) {
      this.ending = false;
      return;
    }
    const playing = this.layer(buffer);
    const at = Math.max(context.currentTime + 0.05, current.startedAt + (current.duration - current.offset) - END_FADE);
    playing.gain.gain.setValueAtTime(0, at);
    playing.gain.gain.linearRampToValueAtTime(1, at + END_FADE);
    playing.source.start(at);
    listenEnded(current.songId, 'complete', this.heardOf(current, at), current.offset + Math.max(0, at - current.startedAt));
    this.current = { ...playing, songId: item.song_id, position, startedAt: at, offset: 0, duration: buffer.duration };
    listenStarted(item.song_id, 0, this.heard.get(item.song_id) ?? 0);
    this.requested.clear();
    this.ending = false;
    this.update({
      position,
      duration: buffer.duration,
      notice: 'That seam wasn’t ready in time, so this one faded in.',
    });
  }
}
