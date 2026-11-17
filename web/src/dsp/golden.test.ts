import { describe, expect, it } from 'vitest';
import {
  fixtureChannels,
  loadGoldenSet,
  runGoldenSet,
  synthesize,
  type GoldenSet,
  type GoldenTolerances,
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
