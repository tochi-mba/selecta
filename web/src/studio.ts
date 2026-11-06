/** Plays all eight stems of a Seam Studio session in lockstep, with each one's level set by the
 * grid. Everything is already decoded in the browser, so a tap on the grid is heard straight away
 * and nothing has to render. The loop runs on the sound card's clock, so stems can't drift apart. */

export type Lane = 'vocals' | 'drums' | 'bass' | 'other';
export type Side = 'a' | 'b';
export type Shape = Record<Side, Record<Lane, number[]>>;

export const LANES: Lane[] = ['vocals', 'drums', 'bass', 'other'];
export const SIDES: Side[] = ['a', 'b'];

const EDGE = 0.008;
const TICK_MS = 40;

type Voice = { source: AudioBufferSourceNode; gain: GainNode };

export class StemDeck {
  private context: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Map<string, Voice>();
  private startedAt = 0;
  private timer: number | null = null;
  private scheduledFor = -1;
  private shape: Shape;
  private soloed: string | null = null;
  readonly seconds: number;
  readonly cells: number;
  onCell: (cell: number) => void = () => {};

  constructor(seconds: number, cells: number, shape: Shape) {
    this.seconds = seconds;
    this.cells = cells;
    this.shape = shape;
  }

  private audio(): AudioContext {
    if (!this.context) this.context = new AudioContext({ sampleRate: 44100 });
    return this.context;
  }

  async load(urlOf: (side: Side, lane: Lane) => string): Promise<void> {
    const context = this.audio();
    await Promise.all(
      SIDES.flatMap((side) =>
        LANES.map(async (lane) => {
          const response = await fetch(urlOf(side, lane));
          if (!response.ok) throw new Error('Those stems aren’t available any more.');
          this.buffers.set(`${side}_${lane}`, await context.decodeAudioData(await response.arrayBuffer()));
        }),
      ),
    );
  }

  get playing(): boolean {
    return this.voices.size > 0;
  }

  private level(name: string, cell: number): number {
    if (this.soloed) return this.soloed === name ? 1 : 0;
    const [side, lane] = name.split('_') as [Side, Lane];
    return this.shape[side][lane][cell] ? 1 : 0;
  }

  private position(): number {
    const context = this.audio();
    return Math.max(context.currentTime - this.startedAt, 0) % this.seconds;
  }

  private cellAt(position: number): number {
    return Math.min(Math.floor(position / (this.seconds / this.cells)), this.cells - 1);
  }

  /** Set every stem for the stretch now playing, and line up the next stretch's change. */
  private apply() {
    if (!this.playing) return;
    const context = this.audio();
    const now = context.currentTime;
    const position = this.position();
    const cell = this.cellAt(position);
    const step = this.seconds / this.cells;
    const next = (cell + 1) % this.cells;
    const boundary = now + (step - (position % step));
    for (const [name, voice] of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(this.level(name, cell), now, EDGE);
      voice.gain.gain.setTargetAtTime(this.level(name, next), boundary, EDGE);
    }
    this.scheduledFor = next;
    this.onCell(cell);
  }

  private tick() {
    if (this.cellAt(this.position()) === this.scheduledFor) this.apply();
  }

  async play() {
    const context = this.audio();
    await context.resume();
    this.stop();
    const at = context.currentTime + 0.05;
    for (const [name, buffer] of this.buffers) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopEnd = this.seconds;
      const gain = context.createGain();
      gain.gain.value = this.level(name, 0);
      source.connect(gain);
      gain.connect(context.destination);
      source.start(at);
      this.voices.set(name, { source, gain });
    }
    this.startedAt = at;
    this.apply();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    for (const voice of this.voices.values()) {
      try {
        voice.source.stop();
      } catch {
        /* one that hasn't started can't be stopped, and that's fine */
      }
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.scheduledFor = -1;
  }

  /** Jump to a stretch of the loop, for checking one spot. */
  async playFrom(cell: number) {
    await this.play();
    this.startedAt -= cell * (this.seconds / this.cells);
    for (const voice of this.voices.values()) {
      voice.source.stop();
      voice.source.disconnect();
    }
    const context = this.audio();
    const at = context.currentTime + 0.03;
    const offset = cell * (this.seconds / this.cells);
    for (const [name, voice] of this.voices) {
      const source = context.createBufferSource();
      source.buffer = this.buffers.get(name)!;
      source.loop = true;
      source.loopEnd = this.seconds;
      source.connect(voice.gain);
      source.start(at, offset);
      voice.source = source;
    }
    this.startedAt = at - offset;
    this.apply();
  }

  setShape(shape: Shape) {
    this.shape = shape;
    this.apply();
  }

  solo(name: string | null) {
    this.soloed = name;
    this.apply();
  }

  close() {
    this.stop();
    void this.context?.close?.();
    this.context = null;
  }
}

/** Ready-made starting points, worded for what you'd hear rather than how it's built. */
export const SHAPES: { name: string; about: string; change: (shape: Shape) => Shape }[] = [
  {
    name: 'Keep the first voice longer',
    about: 'The first song keeps singing over the second song’s band.',
    change: (shape) => ({
      a: { ...shape.a, vocals: [1, 1, 1, 1, 1, 1, 1, 0], drums: [1, 1, 1, 0, 0, 0, 0, 0], bass: [1, 1, 1, 0, 0, 0, 0, 0], other: [1, 1, 1, 0, 0, 0, 0, 0] },
      b: { ...shape.b, vocals: [0, 0, 0, 0, 0, 0, 0, 1], drums: [0, 0, 1, 1, 1, 1, 1, 1], bass: [0, 0, 0, 1, 1, 1, 1, 1], other: [0, 0, 1, 1, 1, 1, 1, 1] },
    }),
  },
  {
    name: 'Bring the new drums in early',
    about: 'The second song’s drums start right away, before anything else of it.',
    change: (shape) => ({
      a: { ...shape.a, drums: [1, 1, 0, 0, 0, 0, 0, 0] },
      b: { ...shape.b, drums: [1, 1, 1, 1, 1, 1, 1, 1] },
    }),
  },
  {
    name: 'Strip it back for the swap',
    about: 'Everything drops away except the voices, then the second song lands.',
    change: () => ({
      a: { vocals: [1, 1, 1, 1, 1, 1, 0, 0], drums: [1, 1, 1, 0, 0, 0, 0, 0], bass: [1, 1, 1, 0, 0, 0, 0, 0], other: [1, 1, 1, 1, 0, 0, 0, 0] },
      b: { vocals: [0, 0, 0, 0, 0, 1, 1, 1], drums: [0, 0, 0, 0, 0, 0, 1, 1], bass: [0, 0, 0, 0, 0, 0, 1, 1], other: [0, 0, 0, 0, 1, 1, 1, 1] },
    }),
  },
  {
    name: 'Trade one at a time',
    about: 'Drums, then bass, then melody, then voice cross over in turn.',
    change: () => ({
      a: { drums: [1, 1, 0, 0, 0, 0, 0, 0], bass: [1, 1, 1, 1, 0, 0, 0, 0], other: [1, 1, 1, 1, 1, 1, 0, 0], vocals: [1, 1, 1, 1, 1, 1, 1, 0] },
      b: { drums: [0, 0, 1, 1, 1, 1, 1, 1], bass: [0, 0, 0, 0, 1, 1, 1, 1], other: [0, 0, 0, 0, 0, 0, 1, 1], vocals: [0, 0, 0, 0, 0, 0, 0, 1] },
    }),
  },
];
