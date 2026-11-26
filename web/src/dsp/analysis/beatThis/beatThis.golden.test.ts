import { describe, expect, it } from 'vitest';
import { analyseSong, measureSongAsync, prepareSignal } from '../song';
import { renderSong, type SynthSong } from '../synth';
import { BEAT_BORDER, BEAT_CHUNK, placeChunk, splitPiece, UNPREDICTED } from './chunks';
import { deduplicatePeaks, minimalPostprocess, peakFrames } from './postprocess';
import { beatFrameCount, BEAT_MELS, BeatSpectrogram, beatThisFilterbank, melEdgesHz } from './spectrogram';
import { beatThisSource } from './source';
import { songLogits } from './track';

// Beat This in the browser against the Desktop tracker (docs/engineering/device-beats.md), on the
// synthetic songs of tools/device_analysis_golden.py --beat-this. The network itself does not run
// here: these tests feed the Python logits recorded in the fixtures through the ported chunking
// and peak picking, so they check everything around the model. The model's own agreement
// (ONNX against PyTorch, onnxruntime-web against the Desktop's logits) was proved by the
// standalone scripts the doc names.

type Fixture = {
  name: string; monoLength: number; frames: number; spectSampleFrames: number[]; spect: number[][];
  logits: { beat: number[]; downbeat: number[] };
  port: { beats: number[]; downbeats: number[] };
  measured: { grid: { beats: number[]; barStarts: number[]; beatsPerBar: number; bpm: number; constantTempo: boolean; confidence: number } | null; row: Record<string, unknown> | null };
};
type Original = { song: SynthSong };

const files = import.meta.glob('../../golden/device-analysis/beat-this/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const originals = import.meta.glob('../../golden/device-analysis/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const manifest = JSON.parse(files['../../golden/device-analysis/beat-this/manifest.json']) as { songs: Array<{ name: string; file: string }> };
const fixtures = manifest.songs.map((entry) => ({
  fixture: JSON.parse(files[`../../golden/device-analysis/beat-this/${entry.file}`]) as Fixture,
  song: (JSON.parse(originals[`../../golden/device-analysis/${entry.file}`]) as Original).song,
}));

/** The port's 22,050 Hz mono, as the fixtures' `port` signal. */
function portSignal(song: SynthSong): Float32Array {
  return prepareSignal(renderSong(song), song.sampleRate).mono22k;
}

/** A runtime that answers each chunk with the Desktop's aggregated logits for those frames:
 * where the package keeps a chunk's frames, they are exactly the frames it kept. */
function replay(fixture: Fixture) {
  const chunks = splitPiece(fixture.frames);
  let next = 0;
  return async (_spect: Float32Array, frames: number) => {
    const chunk = chunks[next];
    next += 1;
    expect(frames).toBe(chunk.length);
    const beat = new Float32Array(frames).fill(UNPREDICTED);
    const downbeat = new Float32Array(frames).fill(UNPREDICTED);
    for (let k = 0; k < frames; k += 1) {
      const at = chunk.start + k;
      if (at >= 0 && at < fixture.frames) {
        beat[k] = fixture.logits.beat[at];
        downbeat[k] = fixture.logits.downbeat[at];
      }
    }
    return { beat, downbeat };
  };
}

describe('the log-mel spectrogram Beat This hears', () => {
  it('builds torchaudio\'s filter bank from its own edges, which the recipe reproduces within a float32 step', () => {
    const bank = beatThisFilterbank();
    expect(bank.filters).toBe(BEAT_MELS);
    expect(bank.bins).toBe(513);
    const edges = melEdgesHz();
    expect(edges.length).toBe(130);
    // the table (torch's float32 edges) and the recipe agree to one float32 step
    expect(edges[0]).toBeCloseTo(30, 4);
    expect(edges[129]).toBeCloseTo(11000, 1);
  });

  it.each(fixtures.map(({ fixture, song }) => [fixture.name, fixture, song] as const))('%s: frames match the package within 5e-4', (_name, fixture, song) => {
    const signal = portSignal(song);
    expect(signal.length).toBe(fixture.monoLength);
    const spect = new BeatSpectrogram(signal);
    expect(spect.frames).toBe(fixture.frames);
    expect(beatFrameCount(signal.length)).toBe(fixture.frames);
    const out = new Float32Array(BEAT_MELS);
    fixture.spectSampleFrames.forEach((frame, index) => {
      spect.fill(frame, 1, out);
      let worst = 0;
      for (let mel = 0; mel < BEAT_MELS; mel += 1) worst = Math.max(worst, Math.abs(out[mel] - fixture.spect[index][mel]));
      // measured 2.7e-4 at worst, only in near-silent bins (device-beats.md)
      expect(worst).toBeLessThan(5e-4);
    });
  });
});

describe('chunks, as split_predict_aggregate makes them', () => {
  it('splits like split_piece: a border of 6, steps of 1488, the last chunk moved to the end', () => {
    expect(splitPiece(1200).map((chunk) => [chunk.start, chunk.length])).toEqual([[-6, 1212]]);
    expect(splitPiece(1800).map((chunk) => [chunk.start, chunk.length])).toEqual([[-6, 1500], [306, 1500]]);
    expect(splitPiece(3000).map((chunk) => chunk.start)).toEqual([-6, 1482, 1506]);
    for (const chunk of splitPiece(12001)) expect(chunk.length).toBe(BEAT_CHUNK);
  });

  it('keeps the earlier chunk where two overlap, and every frame is predicted', () => {
    const frames = 3000;
    const piece = new Float32Array(frames).fill(UNPREDICTED);
    const written = new Uint8Array(frames);
    splitPiece(frames).forEach((chunk, index) => placeChunk(piece, written, chunk, new Float32Array(chunk.length).fill(index), BEAT_BORDER));
    expect(piece[0]).toBe(0);
    expect(piece[1487]).toBe(0);
    expect(piece[1488]).toBe(1);
    // chunk 2 starts at 1506, so its first kept frame 1512 is already chunk 1's
    expect(piece[2975]).toBe(1);
    expect(piece[2976]).toBe(2);
    // the last chunk ends 6 frames past the song, so its dropped border is padding
    expect(piece[2999]).toBe(2);
    expect(piece.includes(UNPREDICTED)).toBe(false);
  });
});

describe('peak picking, as the minimal postprocessor does it', () => {
  it('merges adjacent peaks into their mean frame', () => {
    // the running mean is what the next peak is measured from, as in the package
    expect(deduplicatePeaks([3, 4, 10, 11, 12, 20])).toEqual([3.5, 10.5, 12, 20]);
    expect(peakFrames(Float32Array.from([-1, 2, 2, -1, -1, -1, -1, -1, 0.5]))).toEqual([1, 2, 8]);
  });

  it.each(fixtures.map(({ fixture }) => [fixture.name, fixture] as const))('%s: the Desktop\'s logits give the Desktop\'s beats and downbeats', (_name, fixture) => {
    const { beats, downbeats } = minimalPostprocess(Float32Array.from(fixture.logits.beat), Float32Array.from(fixture.logits.downbeat));
    expect(Array.from(beats)).toEqual(fixture.port.beats);
    expect(Array.from(downbeats)).toEqual(fixture.port.downbeats);
  });
});

describe('a whole song with Beat This', () => {
  it.each(fixtures.map(({ fixture, song }) => [fixture.name, fixture, song] as const))('%s: chunked logits, beats and the grid match the Desktop', async (_name, fixture, song) => {
    const logits = await songLogits(portSignal(song), replay(fixture));
    expect(Array.from(logits.beat)).toEqual(Array.from(Float32Array.from(fixture.logits.beat)));

    const measured = await measureSongAsync(renderSong(song), song.sampleRate, beatThisSource(replay(fixture)));
    expect(measured.facts.beat_source).toBe('web-beatthis-small0-1');
    const grid = measured.detail.grid;
    if (!fixture.measured.grid) {
      expect(grid).toBeNull();
      return;
    }
    expect(grid).not.toBeNull();
    expect(Math.abs(grid!.bpm - fixture.measured.grid.bpm)).toBeLessThan(0.05);
    expect(grid!.beats.length).toBe(fixture.measured.grid.beats.length);
    grid!.beats.forEach((beat, index) => expect(Math.abs(beat - fixture.measured.grid!.beats[index])).toBeLessThan(0.002));
    expect(Array.from(grid!.barStarts)).toEqual(fixture.measured.grid.barStarts);
    expect(grid!.beatsPerBar).toBe(fixture.measured.grid.beatsPerBar);
    expect(grid!.constantTempo).toBe(fixture.measured.grid.constantTempo);
    expect(measured.facts.row?.beats_per_bar).toBe(fixture.measured.row?.beats_per_bar);
    expect(measured.facts.row?.bpm).toBe(fixture.measured.row?.bpm);
  });

  it('reads the waltz as three beats to the bar, from the model\'s downbeats', () => {
    const waltz = fixtures.find(({ fixture }) => fixture.name === 'waltz-132-g-major')!;
    const channels = renderSong(waltz.song);
    const run = analyseSong(channels, waltz.song.sampleRate, {
      beats: Float64Array.from(waltz.fixture.port.beats), downbeats: Float64Array.from(waltz.fixture.port.downbeats), confidence: 1, implementation: 'web-beatthis-small0-1',
    });
    expect(run.facts.row?.beats_per_bar).toBe(3);
  });
});
