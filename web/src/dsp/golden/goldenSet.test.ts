import { describe, expect, it } from 'vitest';
import { loadGoldenSet, runGoldenSet } from '../golden';
import goldenJson from './golden.json?raw';

/**
 * BF-0459-02/03, BF-0457-08: the browser DSP against values the Python engine produced
 * (tools/bf_golden.py). The tolerances are the ones ADR-0459 work recorded for the golden run;
 * a failing row names the metric so a regression is never hidden inside an average.
 */
describe('golden set from the Python engine', () => {
  const rows = runGoldenSet(loadGoldenSet(goldenJson), {
    lufs: 1.0,
    truePeakDb: 1.0,
    tempoBpm: 3.0,
    seamSeconds: 0.01,
  });

  it('runs every fixture and metric the generator wrote', () => {
    expect(new Set(rows.map((row) => row.name)).size).toBe(5);
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });

  it.each(['lufs', 'truePeakDb', 'tempoBpm', 'tempoAmbiguous', 'key', 'mode', 'seamStartSeconds', 'seamKind'])(
    'matches the Python engine on %s',
    (metric) => {
      const failing = rows.filter((row) => row.metric === metric && !row.pass);
      expect(failing, JSON.stringify(failing)).toEqual([]);
    },
  );
});
