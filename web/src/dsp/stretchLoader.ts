import { STRETCH_IMPLEMENTATION } from './stretchLimits';

/** Load the time-stretch module and prove it works before anyone may call it ready
 * (ADR-0459, BF-0459-05).
 *
 * The capability record only marks Tier 2 `time_stretch` ready when this resolves with
 * evidence: the module was actually fetched and loaded on this device, and a quarter second
 * of test tone came back at the right length with finite samples. A failed chunk load or a
 * failed self-test resolves to null, which keeps the feature `unsupported_here`.
 */

export type StretchEvidence = { implementation: string };

type StretchModule = typeof import('./stretch');

export async function loadStretchEvidence(load: () => Promise<StretchModule> = () => import('./stretch')): Promise<StretchEvidence | null> {
  try {
    const module = await load();
    const rate = 44100;
    const tone = new Float32Array(rate / 4);
    for (let index = 0; index < tone.length; index += 1) tone[index] = 0.5 * Math.sin((2 * Math.PI * 440 * index) / rate);
    const result = module.timeStretch([tone], rate, 1.05);
    if (result.status !== 'ready') return null;
    const [out] = result.channels;
    if (out.length !== Math.round(tone.length / 1.05)) return null;
    for (let index = 0; index < out.length; index += 1) if (!Number.isFinite(out[index])) return null;
    if (result.implementation !== STRETCH_IMPLEMENTATION) return null;
    return { implementation: result.implementation };
  } catch {
    return null;
  }
}
