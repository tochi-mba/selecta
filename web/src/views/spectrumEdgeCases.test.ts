import { describe, expect, it, vi } from 'vitest';
import {
  frequencyLevels, MAX_SPECTRUM_HISTORY, MAX_TRAIL_HISTORY, paintFrequencyFrame,
  SPECTRUM_MODES, spectrumLevelCount, type SpectrumShape,
} from './spectrumVisuals';

// Edge cases named in ADR-0185 to ADR-0197, one block per horizontal mode. Every
// case paints into a recording context, so geometry is checked without a canvas.
const CALLS = ['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath',
  'fill', 'stroke', 'fillRect', 'arc'] as const;
type Call = typeof CALLS[number];

function recorder() {
  const fns = Object.fromEntries(CALLS.map((name) => [name, vi.fn()]));
  return { ...fns, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineCap: 'butt' } as unknown as CanvasRenderingContext2D;
}
const brush = { accent: '#d5f36b', soft: '#ffffff', gradient: '#d5f36b' };
const count = (context: CanvasRenderingContext2D, name: Call) => vi.mocked(context[name]).mock.calls.length;
const calls = (context: CanvasRenderingContext2D, name: Call) => vi.mocked(context[name]).mock.calls as number[][];
const paint = (mode: SpectrumShape, levels: number[], width = 900, height = 140, history: number[][] = []) => {
  const context = recorder();
  const drew = paintFrequencyFrame(context, width, height, levels, mode, brush, history);
  return { context, drew, history };
};
const geometry = (context: CanvasRenderingContext2D) =>
  CALLS.map((name) => vi.mocked(context[name]).mock.calls);
const ys = (context: CanvasRenderingContext2D) => [
  ...calls(context, 'moveTo').map(([, y]) => y),
  ...calls(context, 'lineTo').map(([, y]) => y),
  ...calls(context, 'quadraticCurveTo').flatMap(([, y1, , y2]) => [y1, y2]),
];

describe('every horizontal mode', () => {
  it.each(SPECTRUM_MODES.map((mode) => mode.id))(
    '%s paints identical geometry for an identical measured frame', (mode) => {
      const levels = [0.1, 0.3, 0.8, 0, 0.4, 0.9, 0.2, 0.6];
      expect(geometry(paint(mode, levels).context)).toEqual(geometry(paint(mode, levels).context));
    },
  );

  it.each(SPECTRUM_MODES.map((mode) => mode.id))(
    '%s keeps every mark inside a 320px and a 2560px canvas', (mode) => {
      for (const width of [320, 2560]) {
        const levels = Array.from({ length: spectrumLevelCount(width, 1, mode) }, (_, i) => (i % 5) / 4);
        const { context, drew } = paint(mode, levels, width, 120);
        expect(drew).toBe(true);
        for (const [x, y] of [...calls(context, 'moveTo'), ...calls(context, 'lineTo')]) {
          expect(x).toBeGreaterThanOrEqual(-0.001);
          expect(x).toBeLessThanOrEqual(width + 0.001);
          expect(y).toBeGreaterThanOrEqual(-4);
          expect(y).toBeLessThanOrEqual(124);
        }
        expect(context.globalAlpha).toBe(1);
      }
    },
  );

  it('low DPI and narrow canvases still get a real axis; high DPI is capped by the caller', () => {
    expect(spectrumLevelCount(320, 1, 'skyline')).toBeGreaterThanOrEqual(24);
    expect(spectrumLevelCount(2560 * 2, 2, 'skyline')).toBeLessThanOrEqual(128);
    expect(frequencyLevels(new Uint8Array(1024), spectrumLevelCount(320, 1, 'pins')).every((v) => v === 0)).toBe(true);
  });
});

describe('ADR-0185 aurora contours', () => {
  it('three layers each reach the right edge and silence raises no wave', () => {
    const { context } = paint('aurora', [0.4, 0.4, 0.4, 0.4], 1200);
    expect(calls(context, 'lineTo').filter(([x]) => x === 1200).length).toBeGreaterThanOrEqual(3);
    expect(paint('aurora', Array(32).fill(0)).drew).toBe(false);
  });
});

describe('ADR-0186 spectral lanes', () => {
  it('four rows stay distinct from 320px to 2560px', () => {
    for (const width of [320, 2560]) {
      const { context } = paint('lanes', Array(48).fill(0.5), width, 120);
      const tops = new Set(calls(context, 'fillRect').map(([, y]) => Math.round(y)));
      expect(tops.size).toBe(4);
    }
  });

  it('a noise-like flat reference fills every lane equally; silence fills none', () => {
    const { context } = paint('lanes', Array(48).fill(0.3), 1000, 120);
    const filled = calls(context, 'fillRect').filter(([, , w]) => w < 1000).map(([, , w]) => w);
    expect(filled).toHaveLength(4);
    expect(new Set(filled).size).toBe(1);
    expect(paint('lanes', Array(48).fill(0)).drew).toBe(false);
  });
});

describe('ADR-0187 frequency constellation', () => {
  it('zero samples yield no dots and no links', () => {
    const { context } = paint('constellation', [0, 0.5, 0, 0]);
    expect(count(context, 'arc')).toBe(1);
    expect(count(context, 'stroke')).toBe(0);
  });

  it('works at low and high resolution, capping points near 42', () => {
    expect(count(paint('constellation', Array(24).fill(0.5)).context, 'arc')).toBe(24);
    expect(count(paint('constellation', Array(128).fill(0.5)).context, 'arc')).toBeLessThanOrEqual(43);
  });

  it('variation follows actual analyser change', () => {
    const a = paint('constellation', [0.2, 0.5, 0.8]).context;
    const b = paint('constellation', [0.2, 0.9, 0.8]).context;
    expect(calls(a, 'arc')[1][1]).not.toBe(calls(b, 'arc')[1][1]);
    expect(calls(a, 'arc')[0]).toEqual(calls(b, 'arc')[0]);
  });
});

describe('ADR-0188 recent spectrum', () => {
  it('missing analyser output clears history, silence only advances it', () => {
    const history: number[][] = [];
    for (let i = 0; i < 50; i += 1) paint('waterfall', [0.5, 0.2], 800, 110, history);
    expect(history).toHaveLength(MAX_SPECTRUM_HISTORY);
    paint('waterfall', [0, 0], 800, 110, history);
    expect(history).toHaveLength(MAX_SPECTRUM_HISTORY);
    expect(history.at(-1)).toEqual([0, 0]);
    expect(paint('waterfall', [], 800, 110, history).drew).toBe(false);
    expect(history).toEqual([]);
  });
});

describe('ADR-0189 spectrum skyline', () => {
  it('all zeros produce no towers', () => {
    const { context, drew } = paint('skyline', Array(24).fill(0));
    expect(drew).toBe(false);
    expect(count(context, 'fill')).toBe(0);
  });

  it('one nonzero bin raises exactly one roof, the rest rest on the floor', () => {
    const height = 140;
    const floor = height * 0.93;
    const { context } = paint('skyline', [0, 0, 1, 0], 800, height);
    const roofs = calls(context, 'lineTo').filter(([, y]) => y < floor - 0.001);
    expect(roofs).toEqual([[400, floor - height * 0.83], [600, floor - height * 0.83]]);
  });

  it('ascending and descending bins give monotone roofs over the measured interval', () => {
    const up = calls(paint('skyline', [0.1, 0.3, 0.6, 0.9]).context, 'lineTo').slice(0, 8).map(([, y]) => y);
    const down = calls(paint('skyline', [0.9, 0.6, 0.3, 0.1]).context, 'lineTo').slice(0, 8).map(([, y]) => y);
    for (let i = 2; i < 8; i += 2) {
      expect(up[i]).toBeLessThan(up[i - 2]);
      expect(down[i]).toBeGreaterThan(down[i - 2]);
    }
  });
});

describe('ADR-0190 glass threads', () => {
  it('one energetic window moves only its own thread off the baseline', () => {
    const levels = Array(50).fill(0);
    for (let i = 20; i < 30; i += 1) levels[i] = 0.8;
    const height = 140;
    const { context } = paint('threads', levels, 1000, height);
    expect(count(context, 'stroke')).toBe(5);
    const lifted = ys(context).filter((y) => ![0, 1, 2, 3, 4].some((lane) => Math.abs(y - height * (0.18 + lane * 0.16)) < 0.001));
    expect(lifted.every((y) => y < height * (0.18 + 2 * 0.16) && y > height * (0.18 + 1 * 0.16))).toBe(true);
    expect(lifted.length).toBeGreaterThan(0);
  });

  it('a flat signal draws five flat threads; missing bins draw nothing', () => {
    const { context } = paint('threads', Array(50).fill(0.5), 1000, 100);
    expect(count(context, 'stroke')).toBe(5);
    expect(new Set(ys(context).map((y) => Math.round(y * 1000))).size).toBe(5);
    expect(paint('threads', []).drew).toBe(false);
  });
});

describe('ADR-0191 signal pins', () => {
  it('interleaved zero and nonzero bins draw pins only at nonzero bins', () => {
    const { context } = paint('pins', [0.5, 0, 0.5, 0, 0.5, 0], 600, 100);
    expect(count(context, 'stroke')).toBe(3);
    expect(calls(context, 'moveTo').map(([x]) => x)).toEqual([50, 250, 450]);
  });

  it('extremely quiet audio still draws a short true pin, never a full-height one', () => {
    const quiet = frequencyLevels(Uint8Array.from([1, 1, 1, 1]), 4);
    const { context } = paint('pins', quiet, 600, 100);
    const [[, top], [, bottom]] = [calls(context, 'moveTo')[0], calls(context, 'lineTo')[0]];
    expect(bottom - top).toBeLessThan(5);
    expect(bottom - top).toBeGreaterThan(0);
  });

  it('the pin count is capped so wide canvases cannot overload paint', () => {
    expect(count(paint('pins', Array(256).fill(0.5), 2560, 120).context, 'stroke')).toBeLessThanOrEqual(80);
  });
});

describe('ADR-0192 spectrum mosaic', () => {
  it('lights 0, 1, 3 and 6 rows at the 0, 1/6, 1/2 and 1 thresholds', () => {
    const lit = (value: number) => count(paint('matrix', [value], 300, 120).context, 'fillRect');
    expect(lit(1 / 6)).toBe(1);
    expect(lit(1 / 2)).toBe(3);
    expect(lit(1)).toBe(6);
    expect(paint('matrix', [0]).drew).toBe(false);
  });

  it('changing one bin changes only its column, even on a very narrow canvas', () => {
    const before = calls(paint('matrix', [0.5, 0.5, 0.5], 60, 40).context, 'fillRect');
    const after = calls(paint('matrix', [0.5, 1, 0.5], 60, 40).context, 'fillRect');
    const column = (rects: number[][], i: number) => rects.filter(([x]) => Math.floor(x / 20) === i);
    expect(column(after, 0)).toEqual(column(before, 0));
    expect(column(after, 2)).toEqual(column(before, 2));
    expect(column(after, 1).length).toBeGreaterThan(column(before, 1).length);
  });
});

describe('ADR-0193 afterglow trails', () => {
  it('the first frame starts from empty history and draws only itself', () => {
    const { context, history } = paint('trails', [0.4, 0.6]);
    expect(history).toEqual([[0.4, 0.6]]);
    expect(count(context, 'stroke')).toBe(1);
  });

  it('after 20+ frames holds the last seven in order; seven silent frames displace sound', () => {
    const history: number[][] = [];
    for (let i = 1; i <= 25; i += 1) paint('trails', [i / 25, 0.5], 900, 140, history);
    expect(history.map(([first]) => Math.round(first * 25))).toEqual([19, 20, 21, 22, 23, 24, 25]);
    for (let i = 0; i < MAX_TRAIL_HISTORY; i += 1) paint('trails', [0, 0], 900, 140, history);
    expect(history.every((frame) => frame.every((level) => level === 0))).toBe(true);
    expect(count(paint('trails', [0.5, 0.5], 900, 140, history).context, 'stroke')).toBe(1);
  });
});

describe('ADR-0194 spectral dunes', () => {
  it.each([1, 2, 4, 128, 256])('%i bins still give exactly four ridges and four outlines', (bins) => {
    const { context } = paint('dunes', Array(bins).fill(0.5), 1024, 160);
    expect(count(context, 'fill')).toBe(4);
    expect(count(context, 'stroke')).toBe(4);
  });

  it('low-only or high-only signal raises only the matching partition', () => {
    const height = 160;
    const lifted = (levels: number[]) => {
      const { context } = paint('dunes', levels, 1024, height);
      return [0, 1, 2, 3].filter((band) => {
        const base = height * (0.235 + band * 0.25);
        return ys(context).some((y) => y < base - 0.001 && y > base - height * 0.25);
      });
    };
    expect(lifted([0.9, 0.9, 0, 0, 0, 0, 0, 0])).toEqual([0]);
    expect(lifted([0, 0, 0, 0, 0, 0, 0.9, 0.9])).toEqual([3]);
  });
});

describe('ADR-0195 signal ranges', () => {
  it('one populated group gives one wick and one marker; all zeros give none', () => {
    const { context } = paint('candles', [0, 0, 0, 0.2, 0.6, 0.4, 0, 0, 0]);
    expect(count(context, 'stroke')).toBe(1);
    expect(count(context, 'fillRect')).toBe(1);
    expect(paint('candles', Array(9).fill(0)).drew).toBe(false);
  });

  it('flat nonzero bins give zero-length wicks at the measured level', () => {
    const { context } = paint('candles', Array(6).fill(0.5), 600, 100);
    const [from] = calls(context, 'moveTo');
    const [to] = calls(context, 'lineTo');
    expect(from[1]).toBeCloseTo(to[1]);
    expect(from[1]).toBeCloseTo(100 * 0.93 - 0.5 * 100 * 0.82);
  });

  it('groups are capped at 42 for a 256-bin spectrum', () => {
    expect(count(paint('candles', Array(256).fill(0.4), 2560, 120).context, 'fillRect')).toBe(42);
  });
});

describe('ADR-0196 frequency mesh', () => {
  it('disjoint buckets get rungs only; one bucket one rung; an adjacent pair adds two diagonals', () => {
    const moves = (levels: number[]) => calls(paint('mesh', levels).context, 'moveTo').length;
    expect(moves([0.5, 0, 0.5, 0, 0.5])).toBe(3);
    expect(moves([0, 0, 0.5, 0])).toBe(1);
    expect(moves([0, 0.5, 0.5, 0])).toBe(4);
  });

  it('a 128-bin spectrum samples at most 64 positions; quiet data draws nothing', () => {
    expect(new Set(calls(paint('mesh', Array(128).fill(0.5)).context, 'moveTo').map(([x]) => x)).size)
      .toBeLessThanOrEqual(64);
    expect(paint('mesh', Array(128).fill(0)).drew).toBe(false);
  });
});

describe('ADR-0197 split flow', () => {
  const height = 160;
  it('lower-half energy draws only the upper-region flow, upper-half only the lower region', () => {
    const lowOnly = ys(paint('split', [0.8, 0.8, 0.8, 0, 0, 0], 1000, height).context);
    expect(lowOnly.every((y) => y <= height * 0.47 + 0.001)).toBe(true);
    const highOnly = ys(paint('split', [0, 0, 0, 0.8, 0.8, 0.8], 1000, height).context);
    expect(highOnly.every((y) => y >= height * 0.53 - 0.001)).toBe(true);
  });

  it('an uneven bin count puts the extra bin in the lower half; quiet input is blank', () => {
    const { context } = paint('split', [0, 0, 0.7, 0, 0], 1000, height);
    expect(count(context, 'fill')).toBe(1);
    expect(ys(context).every((y) => y <= height * 0.47 + 0.001)).toBe(true);
    expect(paint('split', [0, 0, 0, 0, 0]).drew).toBe(false);
  });
});
