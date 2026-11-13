import { describe, expect, it } from 'vitest';
import inventory from '../../../docs/adr/mp-0272-surface-inventory.json' with { type: 'json' };
import map from '../../../docs/adr/s3-0075-coverage-map.json' with { type: 'json' };
import mp from '../../e2e/mp-baseline.mp.ts?raw';
import p0132 from '../../e2e/polish-p0132-baselines.e2e.ts?raw';
import fp0271 from '../../e2e/fp-0271-paired-states.e2e.ts?raw';
import states from '../../e2e/s3-0075-01-state-candidates.e2e.ts?raw';
import regression from '../../e2e/s3-0075-visual-regression.e2e.ts?raw';
import helpers from '../../e2e/helpers.ts?raw';

/** S3-0075-01: docs/adr/s3-0075-coverage-map.json names every state of every surface in the MP-0272
 * inventory, with the review candidates that capture it or the reason none does yet. The candidates
 * come from specs that save images marked candidate-not-independently-verified and never compare
 * against a golden, so nothing here can turn an unreviewed capture into a baseline. */

type Candidate = { spec: string; capture: string };
type Entry = { surface: string; state: string; candidates?: Candidate[]; uncovered?: string };
type Surface = { id: string; fixtureId: string; states: string[] };

const SPECS: Record<string, string> = {
  'web/e2e/mp-baseline.mp.ts': mp,
  'web/e2e/polish-p0132-baselines.e2e.ts': p0132,
  'web/e2e/fp-0271-paired-states.e2e.ts': fp0271,
  'web/e2e/s3-0075-01-state-candidates.e2e.ts': states,
  'web/e2e/s3-0075-visual-regression.e2e.ts': regression,
};
const entries = map.entries as Entry[];
const surfaces = [...inventory.routes, ...inventory.overlays, ...inventory.persistent] as Surface[];
const key = (surface: string, state: string) => `${surface} / ${state}`;

describe('S3-0075-01 visual coverage map', () => {
  it('has exactly one entry for every state of every inventory surface', () => {
    const expected = surfaces.flatMap((surface) => surface.states.map((state) => key(surface.id, state))).sort();
    const listed = entries.map((entry) => key(entry.surface, entry.state));
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(expected);
    expect(map.inventory).toBe('docs/adr/mp-0272-surface-inventory.json');
  });

  it('captures a state or says which written reason leaves it uncovered, and the totals add up', () => {
    for (const entry of entries) {
      const captured = (entry.candidates?.length ?? 0) > 0;
      expect(captured !== !!entry.uncovered, key(entry.surface, entry.state)).toBe(true);
      if (entry.uncovered) expect(Object.keys(map.reasons), key(entry.surface, entry.state)).toContain(entry.uncovered);
    }
    const captured = entries.filter((entry) => entry.candidates?.length).length;
    expect(map.totals.states).toBe(entries.length);
    expect(map.totals.captured).toBe(captured);
    for (const [reason, count] of Object.entries(map.totals.uncovered)) {
      expect(entries.filter((entry) => entry.uncovered === reason).length, reason).toBe(count);
    }
    // every opening page and every route that can lose its connection has a candidate
    for (const route of inventory.routes as Surface[]) {
      const first = route.states.includes('initial') ? 'initial' : 'idle';
      expect(entries.find((entry) => entry.surface === route.id && entry.state === first)?.candidates, route.id).toBeTruthy();
      if (route.states.includes('offline')) {
        expect(entries.find((entry) => entry.surface === route.id && entry.state === 'offline')?.candidates, route.id).toBeTruthy();
      }
    }
  });

  it('points only at candidate specs that exist, save unreviewed candidates and never compare to a golden', () => {
    const used = new Set(entries.flatMap((entry) => entry.candidates ?? []).map((candidate) => candidate.spec));
    expect([...used].sort()).toEqual(Object.keys(map.specs).sort());
    for (const spec of used) {
      const source = SPECS[spec];
      expect(source, spec).toBeTruthy();
      expect(source, spec).not.toMatch(/\.toHaveScreenshot\(/);
      expect(source, spec).toMatch(/candidate/);
    }
    for (const spec of ['web/e2e/mp-baseline.mp.ts', 'web/e2e/polish-p0132-baselines.e2e.ts', 'web/e2e/s3-0075-01-state-candidates.e2e.ts']) {
      expect(SPECS[spec], spec).toContain('candidate-not-independently-verified');
    }
  });

  it('names captures each spec really produces', () => {
    for (const entry of entries) {
      for (const { spec, capture } of entry.candidates ?? []) {
        const where = `${key(entry.surface, entry.state)} in ${spec}`;
        if (spec === 'web/e2e/mp-baseline.mp.ts') {
          const [surface, fixture] = capture.replace(/^candidate-/, '').split('--');
          if (surface !== '<route>') expect(surfaces.map((item) => item.id), where).toContain(surface);
          const routeFixture = (inventory.routes as Surface[]).some((route) => route.id === surface && route.fixtureId === fixture);
          if (!routeFixture && surface !== '<route>') expect(mp, where).toContain(`'${fixture}'`);
        } else if (spec === 'web/e2e/polish-p0132-baselines.e2e.ts') {
          const name = capture.replace('candidate-p0132-<width>-<scheme>-', '').replace(/\.png$/, '');
          const page = `'/${name.replace(/-/g, '/')}'`;
          expect(helpers.includes(page) || p0132.includes(`-${name}\``), where).toBe(true);
        } else if (spec === 'web/e2e/fp-0271-paired-states.e2e.ts') {
          const id = capture.replace('candidate-<width>x<height>-', '').replace(/-<theme>\.png$/, '');
          expect(fp0271, where).toContain(`id: '${id}'`);
        } else if (spec === 'web/e2e/s3-0075-01-state-candidates.e2e.ts') {
          expect(capture, where).toBe(`candidate-s3-0075-${entry.surface}--${entry.state}--<width>-<scheme>.png`);
          if (entry.state === 'offline') expect(states).toContain("route.states.includes('offline')");
          else expect(states, where).toContain(`'${entry.surface}'`);
        } else {
          expect(regression, where).toContain(capture.replace('candidate-<theme>-<size>-', '').replace('.png', ''));
        }
      }
    }
  });
});
