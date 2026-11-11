import { test, type TestInfo } from '@playwright/test';

/**
 * Specs written ahead of the UI they measure. Each one names a checklist item that is not finished
 * (the checklists in docs/adr say "Not started" or "In progress", or say "Implemented" while the
 * spec still fails), so the spec stays in the tree, listed as fixme, instead of failing every run.
 * When the item's work lands, delete its line here and the spec runs again.
 *
 * Keyed by the test's full title. Call `aheadOfTheUi` from a `test.beforeEach` in each such file.
 */
export const AHEAD: Record<string, string> = {};

export function aheadOfTheUi(info: TestInfo) {
  const why = AHEAD[info.title];
  test.fixme(why !== undefined, why);
}
