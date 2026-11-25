import { setFlags } from '../flags';

/** Every feel flag (ADR-0477) off, every other feature on: the page exactly as it was before the
 * feel system. For tests that pin that behaviour (exact wording split by a rolling count, no tick
 * after an action, no page travel). Tests otherwise run with every flag on, the feel included. */
export const FEEL_OFF = {
  'app.feel_motion': false,
  'app.feel_depth': false,
  'app.feel_pointer_light': false,
  'app.feel_music': false,
  'app.feel_ambient': false,
  'app.feel_moments': false,
  'app.feel_haptics': false,
} as const;

/** Turn the feel off for this test, keeping `others` as given. */
export function feelOff(others: Record<string, boolean> = {}) {
  setFlags({ ...others, ...FEEL_OFF });
}
