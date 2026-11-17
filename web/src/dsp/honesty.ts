/** The banned-claims list and truthful labels (ADR-0459, BF-0459-08).
 *
 * A lighter method is a different verified implementation or an explicit reduced capability,
 * never silently "the same feature". Copy anywhere in SelectaDJ must not contain any phrase on
 * the banned list; the copy audit imports BANNED_CLAIMS and scans every user-facing string.
 * `labelFor` turns a capability record into the honest label a surface shows.
 */

import type { Capability } from './capability';

/** Phrases no SelectaDJ surface may show about browser DSP. Matched case-insensitively. */
export const BANNED_CLAIMS: readonly string[] = [
  'same as the native engine',
  'identical to the native engine',
  'same mix as the desktop app',
  'studio-grade stems on any phone',
  'neural accuracy on every device',
  'full native quality in the browser',
  'lossless time-stretch on any device',
  'exactly what the desktop engine would play',
];

/** True when a piece of copy contains a banned claim. */
export function violatesHonesty(copy: string): boolean {
  const lowered = copy.toLowerCase();
  return BANNED_CLAIMS.some((claim) => lowered.includes(claim));
}

/** Feature-specific honest labels for the common estimates. Tier 2 estimates always say so. */
const READY_LABELS: Record<string, string> = {
  tempo: 'estimated tempo (lightweight)',
  key: 'estimated key (lightweight)',
  onsets: 'onset estimate (lightweight)',
  beatmatch: 'scripted beatmatched seam (lightweight analysis)',
  loudness: 'integrated loudness',
  true_peak: 'true peak estimate',
  limiter: 'loudness-safe limiter',
  crossfade: 'equal-power crossfade',
};

/** The truthful UI label for a capability record. */
export function labelFor(capability: Capability): string {
  if (capability.status === 'unsupported_here') {
    return `not available on this device: ${capability.reason ?? 'no reason recorded'}`;
  }
  const known = READY_LABELS[capability.feature];
  if (known) {
    return capability.tier === 1 ? known : ensureLightweight(known);
  }
  return capability.tier === 1
    ? capability.feature
    : `${capability.feature} (${capability.implementation})`;
}

function ensureLightweight(label: string): string {
  return label.includes('lightweight') ? label : `${label} (lightweight)`;
}
