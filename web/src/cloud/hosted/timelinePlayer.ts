/** Gapless playback of a server-rendered timeline (cloud.hosted_render).
 *
 * The server cuts each song at its rendered seam's cue points and hands over the seam clips
 * between them (hosted_render.py on the server): every part is a lossless file and a stretch of it
 * (`from_s`, `seconds`). Parts are decoded a little ahead and scheduled back to back on one
 * AudioContext clock, so the joins are sample-exact: no browser mixing, no crossfade of its own.
 * Each signed link is short-lived, so `refresh()` asks the server again for links when a part
 * comes up that has none or an old one.
 */

export type TimelinePart = {
  kind: 'song' | 'seam';
  from_s: number;
  seconds: number;
  url: string | null;
  name?: string | null;
  move?: string | null;
  index?: number;
};

export type PlayerState = { playing: boolean; part: number; at: number; waiting: boolean; error: string | null };

const AHEAD = 2;
const LEAD_S = 0.15;

export class TimelinePlayer {
  private context: AudioContext | null = null;
  private buffers = new Map<number, Promise<AudioBuffer>>();
  private sources: AudioBufferSourceNode[] = [];
  private starts: number[] = [];
  private next = 0;
  private nextAt = 0;
  private timer: number | null = null;
  private stopped = true;
  state: PlayerState = { playing: false, part: 0, at: 0, waiting: false, error: null };

  constructor(
    private parts: TimelinePart[],
    private refresh: () => Promise<TimelinePart[]>,
    private onChange: (state: PlayerState) => void,
    private fetchBytes: (url: string) => Promise<ArrayBuffer> = async (url) => {
      const answer = await fetch(url);
      if (!answer.ok) throw new Error('A part of this mix could not be fetched.');
      return answer.arrayBuffer();
    },
  ) {}

  setParts(parts: TimelinePart[]) {
    this.parts = parts;
  }

  private emit(change: Partial<PlayerState>) {
    this.state = { ...this.state, ...change };
    this.onChange(this.state);
  }

  private async decode(index: number): Promise<AudioBuffer> {
    let part = this.parts[index];
    if (!part.url) {
      this.parts = await this.refresh();
      part = this.parts[index];
    }
    if (!part?.url) throw new Error('This part of the mix is still being prepared.');
    const bytes = await this.fetchBytes(part.url);
    return this.context!.decodeAudioData(bytes);
  }

  private buffer(index: number): Promise<AudioBuffer> {
    let found = this.buffers.get(index);
    if (!found) {
      found = this.decode(index);
      this.buffers.set(index, found);
      found.catch(() => this.buffers.delete(index));
    }
    return found;
  }

  /** Start from the beginning of part `from` (default: the first). */
  async play(from = 0) {
    this.stop();
    this.stopped = false;
    this.context = this.context ?? new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    this.next = from;
    this.nextAt = this.context.currentTime + LEAD_S;
    this.emit({ playing: true, part: from, at: 0, waiting: true, error: null });
    await this.fill();
    this.timer = window.setInterval(() => void this.tick(), 250);
  }

  private async fill() {
    while (!this.stopped && this.next < this.parts.length && this.next <= this.state.part + AHEAD) {
      const index = this.next;
      let audio: AudioBuffer;
      try {
        audio = await this.buffer(index);
      } catch (problem) {
        this.emit({ error: (problem as Error).message, waiting: true });
        return;
      }
      if (this.stopped || !this.context) return;
      const part = this.parts[index];
      const source = this.context.createBufferSource();
      source.buffer = audio;
      source.connect(this.context.destination);
      const when = Math.max(this.nextAt, this.context.currentTime + 0.02);
      const length = Math.min(part.seconds, Math.max(0, audio.duration - part.from_s));
      source.start(when, part.from_s, length);
      this.sources[index] = source;
      this.starts[index] = when;
      this.nextAt = when + length;
      this.next = index + 1;
      this.emit({ waiting: false, error: null });
    }
  }

  private async tick() {
    if (!this.context || this.stopped) return;
    const now = this.context.currentTime;
    let part = this.state.part;
    while (part + 1 < this.next && this.starts[part + 1] !== undefined && this.starts[part + 1] <= now) {
      this.buffers.delete(part); // a played part's audio is let go
      part += 1;
    }
    const at = Math.max(0, now - (this.starts[part] ?? now));
    if (part >= this.parts.length - 1 && now >= this.nextAt) {
      this.stop();
      this.emit({ playing: false, part: 0, at: 0 });
      return;
    }
    this.emit({ part, at });
    await this.fill();
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const source of this.sources) {
      try { source?.stop(); } catch { /* not started */ }
    }
    this.sources = [];
    this.starts = [];
    if (this.state.playing) this.emit({ playing: false });
  }

  close() {
    this.stop();
    this.buffers.clear();
    void this.context?.close();
    this.context = null;
  }
}
