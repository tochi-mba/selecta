import { describe, expect, it } from 'vitest';
import { audit, auditFacts, type AuditReport, type Check, type VocalSpans } from './audit';
import { inContext, type Rendered, renderScript, type StageName } from './engine';
import type { Channels } from './filters';
import { compareSummary, type GoldenSong, goldenProvider, onsetOffsetsMs, type Perceptual, perceptualMeasures, type SignalSummary } from './goldenSupport';
import { RENDER_IMPLEMENTATION } from './ids';
import { auditFactsToJson } from './repair';
import { scriptFromDict } from './scriptJson';
import { wsolaStretcher } from './warpStretch';

// The device studio's renderer and audit against the Desktop's render() and audit(), on the
// scripts of tools/device_render_golden.py (docs/engineering/device-render.md).
// `port` is Python with soxr replaced by the browser's resampler: family "a" (nothing stretched)
// must match it sample for sample, stage by stage. `desktop` is Python as the Desktop runs.
// Family "b" stretches: the Desktop uses Rubber Band and the browser WSOLA, so only the audit's
// verdicts and perceptual measures are compared, with the tolerances measured on these fixtures.

/** Every family-a stage and the clip: largest sample difference measured 1.2e-7 (float32 rounding
 * in the nudge's sinc and the sweep's bank); the brief allows 1e-4. */
const SAMPLE_TOLERANCE = 1e-6;
/** The nudge, in samples: measured 6.5e-7 (a float32 dot product's last bits). */
const NUDGE_TOLERANCE_SAMPLES = 1e-3;
const LOUDNESS_TOLERANCE_LU = 0.05;
const TRUE_PEAK_TOLERANCE_DB = 0.05;
/** soxr against the port's resampler moves the true peak by up to 0.05 dB (measured 0.050). */
const SOXR_TRUE_PEAK_DB = 0.06;
/** Family b: loudness measured within 0.194 LU of Rubber Band's render. */
const STRETCHED_LOUDNESS_LU = 0.5;
/** Family b: share of Python's onsets with a port onset within 10 ms, measured 0.769 at worst;
 * the median distance measured 2.9 ms at worst. */
const STRETCHED_ONSET_SHARE = 0.7;
const STRETCHED_ONSET_MEDIAN_MS = 5;

type ReportJson = { passed: boolean; checks: Check[] };
type Side = { drift_ms: { a: number; b: number; nudge: number }; report: ReportJson; facts: unknown; perceptual: Perceptual };
type PortSide = Side & {
  clip: SignalSummary;
  a_dry: SignalSummary;
  b_dry: SignalSummary;
  nudge_seconds?: number;
  stages?: Record<StageName, SignalSummary>;
  in_context?: { before: number; after: number; clip_at: number; audio: SignalSummary };
};
type Fixture = { name: string; family: 'a' | 'b'; script: Record<string, unknown>; vocal_spans: VocalSpans; port: PortSide; desktop: Side & { clip_max_abs_vs_port: number } };

const files = import.meta.glob('../golden/device-render/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const read = (name: string) => JSON.parse(files[`../golden/device-render/${name}`]);
const manifest = read('manifest.json') as { cases: { name: string; file: string; family: string }[] };
const songs = (read('songs.json') as { songs: GoldenSong[] }).songs;
const fixtures = manifest.cases.map((entry) => read(entry.file) as Fixture);
const provider = goldenProvider(songs);

type Run = { rendered: Rendered; stages: Partial<Record<StageName, Channels>>; report: AuditReport };
const runs = new Map<string, Run>();
/** One render and audit per script, shared by the tests below. */
function run(fixture: Fixture): Run {
  const kept = runs.get(fixture.name);
  if (kept) return kept;
  const stages: Partial<Record<StageName, Channels>> = {};
  const result = renderScript(scriptFromDict(fixture.script), provider, wsolaStretcher, { onStage: (name, audio) => (stages[name] = audio) });
  if (result.status !== 'ready') throw new Error(`${fixture.name}: ${result.reason}`);
  const made = { rendered: result, stages, report: audit(result, fixture.vocal_spans) };
  runs.set(fixture.name, made);
  return made;
}

const scale = (limit: number) => Math.max(Math.abs(limit), 1);

function expectClose(audio: Channels, summary: SignalSummary, tolerance = SAMPLE_TOLERANCE) {
  const difference = compareSummary(audio, summary);
  expect(difference.lengthMatches).toBe(true);
  expect(difference.samples).toBeLessThanOrEqual(tolerance);
  expect(difference.blocks).toBeLessThanOrEqual(tolerance);
}

const SLOW = 120_000;

describe('scripts that stretch nothing (family a): the same samples as Python', () => {
  for (const fixture of fixtures.filter((entry) => entry.family === 'a')) {
    describe(fixture.name, () => {
      it('places, moves and sums every stage as render() does', () => {
        const { stages } = run(fixture);
        for (const [name, summary] of Object.entries(fixture.port.stages ?? {})) {
          expect(stages[name as StageName], name).toBeDefined();
          expectClose(stages[name as StageName] as Channels, summary);
        }
      }, SLOW);

      it('chooses the same pocket nudge', () => {
        const { rendered } = run(fixture);
        expect(Math.abs(rendered.nudgeSeconds - (fixture.port.nudge_seconds ?? 0)) * 44100).toBeLessThanOrEqual(NUDGE_TOLERANCE_SAMPLES);
        expect(rendered.driftMs).toEqual(fixture.port.drift_ms);
      }, SLOW);

      it('limits to the same clip, and hears the same sides', () => {
        const { rendered } = run(fixture);
        expectClose(rendered.audio, fixture.port.clip);
        expectClose(rendered.aDry, fixture.port.a_dry);
        expectClose(rendered.bDry, fixture.port.b_dry);
        expect(rendered.implementation).toBe(`${RENDER_IMPLEMENTATION}+wsola-stretch-v1`);
      }, SLOW);

      it('measures every check as audit() does, with the same verdict and fix', () => {
        const { report } = run(fixture);
        const python = fixture.port.report.checks;
        expect(report.checks.map((item) => item.name)).toEqual(python.map((item) => item.name));
        report.checks.forEach((item, index) => {
          const reference = python[index];
          expect(Math.abs(item.value - reference.value), item.name).toBeLessThanOrEqual(0.01 * scale(reference.limit));
          expect(item.limit, item.name).toBeCloseTo(reference.limit, 9);
          expect(item.passed, item.name).toBe(reference.passed);
          expect(item.fix, item.name).toBe(reference.fix);
          expect(item.unit, item.name).toBe(reference.unit);
          expect(item.detail, item.name).toBe(reference.detail);
        });
        const facts = auditFactsToJson(auditFacts(report)) as { passed: boolean; failures: { name: string; fix: string | null }[] };
        const expected = fixture.port.facts as typeof facts;
        expect(facts.passed).toBe(expected.passed);
        expect(facts.failures.map((item) => [item.name, item.fix])).toEqual(expected.failures.map((item) => [item.name, item.fix]));
      }, SLOW);

      it('reads the same loudness and true peak', () => {
        const mine = perceptualMeasures(run(fixture).rendered.audio);
        expect(Math.abs(mine.lufs_playback_meter - fixture.port.perceptual.lufs_playback_meter)).toBeLessThanOrEqual(LOUDNESS_TOLERANCE_LU);
        expect(Math.abs(mine.true_peak_db - fixture.port.perceptual.true_peak_db)).toBeLessThanOrEqual(TRUE_PEAK_TOLERANCE_DB);
        expect(onsetOffsetsMs(run(fixture).rendered.audio, fixture.port.perceptual.onsets).every((offset) => offset === 0)).toBe(true);
      }, SLOW);

      it('stays within the Desktop where soxr is stood in for', () => {
        const { report } = run(fixture);
        const desktop = fixture.desktop.report.checks;
        report.checks.forEach((item, index) => {
          const tolerance = item.name === 'true peak' ? SOXR_TRUE_PEAK_DB : 0.01 * scale(desktop[index].limit);
          expect(Math.abs(item.value - desktop[index].value), item.name).toBeLessThanOrEqual(tolerance);
          expect(item.passed, item.name).toBe(desktop[index].passed);
        });
      }, SLOW);

      if (fixture.port.in_context) {
        it('joins the clip to the native songs as in_context() does', () => {
          const context = fixture.port.in_context!;
          const joined = inContext(run(fixture).rendered, context.before, context.after, provider);
          expect(joined.clipAt).toBe(context.clip_at);
          expectClose(joined.audio, context.audio);
        }, SLOW);
      }
    });
  }
});

/** Python's value within 10 percent of its limit's scale: listed in the doc, not asserted. */
const nearLimit = (item: Check) => Math.abs(item.value - item.limit) <= 0.1 * scale(item.limit);

describe('scripts that stretch (family b): WSOLA against Rubber Band, by measurement', () => {
  for (const fixture of fixtures.filter((entry) => entry.family === 'b')) {
    describe(fixture.name, () => {
      it('gives every audit verdict Python gives, except checks near their limit', () => {
        const { report } = run(fixture);
        const python = fixture.port.report.checks;
        expect(report.checks.map((item) => item.name)).toEqual(python.map((item) => item.name));
        report.checks.forEach((item, index) => {
          if (nearLimit(python[index])) return;
          expect(item.passed, item.name).toBe(python[index].passed);
          expect(item.fix, item.name).toBe(python[index].fix);
        });
        // the warp is the script's, not the stretcher's: the stretch check is exact
        const stretch = report.checks.find((item) => item.name === 'stretch');
        expect(stretch?.value).toBe(python.find((item) => item.name === 'stretch')?.value);
      }, SLOW);

      it('is as loud as the Desktop render, and its onsets land near the same times', () => {
        const audio = run(fixture).rendered.audio;
        const mine = perceptualMeasures(audio);
        expect(Math.abs(mine.lufs_playback_meter - fixture.port.perceptual.lufs_playback_meter)).toBeLessThanOrEqual(STRETCHED_LOUDNESS_LU);
        const offsets = onsetOffsetsMs(audio, fixture.port.perceptual.onsets).map(Math.abs).sort((a, b) => a - b);
        const share = offsets.filter((offset) => offset <= 10).length / offsets.length;
        expect(share).toBeGreaterThanOrEqual(STRETCHED_ONSET_SHARE);
        expect(offsets[offsets.length >> 1]).toBeLessThanOrEqual(STRETCHED_ONSET_MEDIAN_MS);
      }, SLOW);

      it('names WSOLA as its stretcher, never Rubber Band', () => {
        expect(run(fixture).rendered.implementation).toBe('web-render-1+wsola-stretch-v1');
      }, SLOW);
    });
  }
});
