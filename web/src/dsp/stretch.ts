/** Time-stretch: an honest placeholder (ADR-0459, BF-0459-05).
 *
 * No vetted pitch-preserving stretch is bundled in this release, so `timeStretch` returns the
 * first-class `unsupported_here` state with its reason, never an error and never a worse
 * substitute.
 *
 * ADR-0459 rule, restated so it cannot be "fixed" casually: naive `playbackRate` changes shift
 * pitch along with speed, and the acceptance criteria for BF-0459-05 say playbackRate pitch
 * shifts are never used for musical stretch. Offering playbackRate here as a stretch would be
 * exactly the silent "same feature" lie the honesty rules ban, so this module deliberately has
 * no such code path. A real implementation needs a vetted WASM DSP, ratio and window limits,
 * and the owner's listening pass before it may claim anything.
 */

export const STRETCH_IMPLEMENTATION = 'time-stretch-unsupported-v0';

export interface StretchUnsupported {
  status: 'unsupported_here';
  reason: string;
  implementation: string;
}

export function timeStretch(): StretchUnsupported {
  return {
    status: 'unsupported_here',
    reason: 'no vetted pitch-preserving stretch is bundled',
    implementation: STRETCH_IMPLEMENTATION,
  };
}
