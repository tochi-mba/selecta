import { PASSED_TIER3_RECORDS, STEMS_LICENCE_RECORD, STEMS_LICENCE_REASON } from '../../dsp/capability';
import { REGISTRY, type FlagId } from '../../flags';

/** The flag that gates every stems surface. It may not be registered yet; until it is, stems are
 * off, because the flag rule reads an unmentioned flag as on and that must not show stems. */
export const STEMS_FLAG = 'cloud.browser_stems';

/** Whether stems are on: the flag is registered, on, and local mode's own `stems` flag is on.
 * Pass `useFlags()` in a component, or `flagOn` outside one. */
export function stemsFlagOn(on: (id: FlagId) => boolean): boolean {
  return STEMS_FLAG in REGISTRY && on(STEMS_FLAG as FlagId) && on('stems');
}

/** Why the stem model may not run anywhere yet, or null once its licence record has passed (ADR-0459). */
export function stemsLicenceHold(): string | null {
  return STEMS_LICENCE_RECORD && PASSED_TIER3_RECORDS.includes(STEMS_LICENCE_RECORD) ? null : STEMS_LICENCE_REASON;
}
