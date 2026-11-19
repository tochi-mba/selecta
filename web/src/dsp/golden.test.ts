import { describe, expect, it } from 'vitest';
import {
  compareStretch,
  fixtureChannels,
  loadGoldenSet,
  runGoldenSet,
  synthesize,
  type GoldenSet,
  type GoldenTolerances,
  type StretchReference,
} from './golden';

const TOLERANCES: GoldenTolerances = {
  lufs: 1.0,
  truePeakDb: 1.0,
  tempoBpm: 3.0,
  seamSeconds: 0.01,
};

// A tiny inline golden set: a tone whose loudness and true peak are known analytically, a
// click track at a known tempo, and a seam case held to the leave_after rule.
const amplitude = 10 ** ((-23 + 0.691) / 20);
const INLINE: GoldenSet = {
  fixtures: [
    {
      name: 'tone-minus-23-lufs',
      sampleRate: 22050,
      durationS: 3,
      synthSpec: [{ type: 'tone', freqHz: 997, amplitude, durS: 3 }],
      expected: { lufs: -23, truePeakDb: 20 * Math.log10(amplitude) },
    },
    {
      name: 'clicks-120',
      sampleRate: 22050,
      durationS: 8,
      channels: 1,
      synthSpec: [{ type: 'clicks', bpm: 120, durS: 8 }],
      expected: { tempoBpm: 120, tempoAmbiguous: false },
    },
    {
      name: 'seam-leave-after',
      sampleRate: 22050,
      durationS: 1,
      expected: { seamStartSeconds: 30, seamKind: 'beatmatch' },
      seamCase: {
        a: {
          beats: Array.from({ length: 120 }, (_, beat) => beat * 0.5),
          tempo: { bpm: 120, confidence: 0.9, ambiguous: false },
          durationSeconds: 60,
        },
        b: {
          beats: Array.from({ length: 120 }, (_, beat) => beat * 0.49),
          tempo: { bpm: 122.4, confidence: 0.9, ambiguous: false },
          durationSeconds: 60,
        },
        spec: { exitSeconds: 20 },
      },
    },
  ],
};

describe('golden comparison harness', () => {
  it('runs every metric through the real DSP and emits pass rows', () => {
    const rows = runGoldenSet(INLINE, TOLERANCES);
    const metrics = rows.map((row) => `${row.name}:${row.metric}`);
    expect(metrics).toContain('tone-minus-23-lufs:lufs');
    expect(metrics).toContain('tone-minus-23-lufs:truePeakDb');
    expect(metrics).toContain('clicks-120:tempoBpm');
    expect(metrics).toContain('clicks-120:tempoAmbiguous');
    expect(metrics).toContain('seam-leave-after:seamStartSeconds');
    expect(metrics).toContain('seam-leave-after:seamKind');
    for (const row of rows) {
      expect(row.pass, `${row.name}:${row.metric} expected ${row.expected} got ${row.actual}`).toBe(
        true
      );
    }
  });

  it('actually measures: the loudness row reflects the audio, not the expected value', () => {
    const rows = runGoldenSet(INLINE, TOLERANCES);
    const lufsRow = rows.find((row) => row.metric === 'lufs');
    expect(lufsRow).toBeDefined();
    expect(typeof lufsRow?.actual).toBe('number');
    expect(Number.isFinite(lufsRow?.actual as number)).toBe(true);
    // No-mocking tripwire: synthesising the same fixture louder must change the measurement.
    const louder: GoldenSet = JSON.parse(JSON.stringify(INLINE));
    const element = louder.fixtures[0].synthSpec?.[0];
    if (element && element.type === 'tone') {
      element.amplitude *= 2;
    }
    const louderRow = runGoldenSet(louder, TOLERANCES).find((row) => row.metric === 'lufs');
    expect((louderRow?.actual as number) - (lufsRow?.actual as number)).toBeGreaterThan(5);
  });

  it('fails rows outside the caller-chosen tolerance instead of hiding them', () => {
    const strict = { ...TOLERANCES, lufs: 0.000001 };
    const rows = runGoldenSet(INLINE, strict);
    const lufsRow = rows.find((row) => row.metric === 'lufs');
    expect(lufsRow?.pass).toBe(false);
    expect(Math.abs(lufsRow?.delta ?? 0)).toBeGreaterThan(0);
  });

  it('synthesis is deterministic and the fixture decoder honours channel count', () => {
    const first = synthesize([{ type: 'tone', freqHz: 440, amplitude: 0.5, durS: 0.1 }], 8000, 0.1);
    const second = synthesize([{ type: 'tone', freqHz: 440, amplitude: 0.5, durS: 0.1 }], 8000, 0.1);
    expect(first).toEqual(second);
    const channels = fixtureChannels(INLINE.fixtures[0]);
    expect(channels.length).toBe(2);
    expect(channels[0]).toEqual(channels[1]);
    expect(fixtureChannels(INLINE.fixtures[1]).length).toBe(1);
  });

  it('validates a parsed golden set', () => {
    expect(() => loadGoldenSet('{"fixtures": "no"}')).toThrow();
    expect(() => loadGoldenSet(JSON.stringify(INLINE))).not.toThrow();
  });
});

/**
 * BF-0459-05: the browser's WSOLA stretch against the Python engine's (pedalboard 0.9.26 Rubber
 * Band, `time_stretch(stereo, 44100, stretch_factor=ratio, high_quality=True,
 * transient_mode="crisp")` as src/selecta/render/dsp.py stretch_to_warp calls it), over the
 * shared synth of tools/bf_golden.py. The reference rows were measured in Python with the same
 * formulas as golden.ts stretchOnsets / stretchSpreadMs / dominantHz. A sample-exact match is not
 * expected from two different algorithms; what a listener hears must match.
 */
const PYTHON_STRETCH: StretchReference[] = [
  {
    ratio: 0.95,
    inputFrames: 352800,
    lengthFrames: 371368,
    onsetsS: [0.003, 0.53, 1.058, 1.586, 2.114, 2.642, 3.17, 3.698, 4.226, 4.754, 5.282, 5.81, 6.338, 6.866, 7.394, 7.922],
    spreadMs: 9,
    dominantHz: 219.957,
  },
  {
    ratio: 1.05,
    inputFrames: 352800,
    lengthFrames: 336000,
    onsetsS: [0.002, 0.481, 0.959, 1.437, 1.915, 2.393, 2.871, 3.349, 3.827, 4.305, 4.784, 5.262, 5.74, 6.218, 6.696, 7.174],
    spreadMs: 9,
    dominantHz: 219.957,
  },
];

describe('the stretch against the Python engine', () => {
  it.each(PYTHON_STRETCH)('matches length, hit positions, pitch and sharpness at ratio $ratio', (reference) => {
    // WSOLA picks each frame within +-10 ms of its nominal place, so a hit may land up to that far
    // from Rubber Band's (measured worst: 10 ms at 0.95); 12 ms allows the 1 ms measuring blocks.
    // That is under a fiftieth of a beat at 120 BPM, and a fifth of the seams' eighth-beat bound.
    const rows = compareStretch(reference, { onsetMs: 12, pitchShare: 0.005, spreadMs: 8 });
    console.info('stretch golden', JSON.stringify(rows.map(({ metric, expected, actual }) => ({ metric, expected, actual }))));
    expect(rows.map((row) => row.metric)).toEqual(['inputFrames', 'lengthFrames', 'onsetCount', 'worstOnsetMs', 'dominantHz', 'spreadMs']);
    const failing = rows.filter((row) => !row.pass);
    expect(failing, JSON.stringify(failing)).toEqual([]);
  });

  it('really measures: a stretch to the wrong ratio fails the length and hit rows', () => {
    const rows = compareStretch({ ...PYTHON_STRETCH[1], ratio: 1.04 }, { onsetMs: 10, pitchShare: 0.005, spreadMs: 8 });
    expect(rows.find((row) => row.metric === 'lengthFrames')?.pass).toBe(false);
  });
});
