/** Shell features a device-music Cloud account does not have in the browser, each a product
 * decision with a to-do naming what would change it (docs/engineering/cloud-device-features.md).
 * The shell reads them through the one flag read, so their controls are absent and the page
 * reflows, rather than present and dead. The command palette and the keyboard shortcuts stay:
 * this shell offers their server-free subset (serverFreeControls.tsx). */
export const NOT_IN_THE_BROWSER = {
  // A request joins when the member adds it, or by itself where the account placed it and this
  // device made its transitions (accountPlacements.ts). On below with that: a bridge the account
  // found with a request's place is offered to agree to; searching every song for one is the app's.
  'requests.bridges': false,
  // The energy horizon: on below when the account keeps measurements; the mix's rows carry each
  // song's measured energy from the account (localFirstRequest.ts withMeasured).
  'editor.energy_horizon': false,
  // Locks: on below when the account keeps the mix (cloud.account_mixes), whose lock route is the
  // app's own; a mix kept in this browser has no lock.
  'editor.locks': false,
  // The Seam Inspector: on below when this device makes transitions ahead and the account keeps
  // them (cloud.device_render with cloud.brain): it shows the clips this device made
  // (seamInspection.ts). Without, each transition can still be rated and its move chosen.
  seam_inspector: false,
  // Saving a mix as a file: on below with cloud.local_export, written on this device
  // (localExport.ts) with the transitions playback plays.
  export: false,
  // Lucy: on below with lucy.cloud_conversation (ADR-0476).
  lucy: false,
  // Lyrics need a licence for showing them (ADR-0406); none covers a browser (T-20261126-2cbe).
  'lyrics.lookup': false,
  // Tempo and key corrections: on below when the account keeps measurements (cloud.brain with
  // cloud.device_analysis). "Is it music?" stays the app's: Song details hides it in a browser (T-20261126-3f92).
  'library.corrections': false,
  // Transition feel: on below when the account plans (cloud.brain with cloud.device_analysis): the
  // order is planned in the feel, and the device makes each of its transitions in it (mixFeel.ts).
  'mixes.shaping.feel': false,
  // The energy shape: on below when the account plans the order (cloud.brain with
  // cloud.device_analysis), which sends the shape to the planner.
  'mixes.shaping.energy_arc': false,
  // Stem moves need the stem splitter, whose model is not published (T-20261125-03a3).
  'mixes.shaping.stem_moves': false,
} as const;

/** What the account can do in this browser, from flags its server named (flagListed). */
export type BrowserReach = {
  /** cloud.brain and cloud.device_analysis: corrections and the energy shape work here. */
  measured?: boolean;
  /** cloud.brain and cloud.account_mixes: the account keeps the mix, so locks work here. */
  accountMixes?: boolean;
  /** cloud.device_render and cloud.brain: this device makes transitions and the account keeps
   * them, so the Seam Inspector works here. */
  studio?: boolean;
  /** cloud.local_export: a mix can be saved as a file on this device. */
  localExport?: boolean;
  /** The account places requests and this device makes their transitions (accountPlacements.ts),
   * so a bridge the account found can be agreed to here. */
  placing?: boolean;
};

/** What this shell turns off, with Harmonic matches off too unless the browser's own version
 * (cloud.browser_harmonic) is on for the account. */
export function browserFlags(browserHarmonic: boolean, lucyHere = false, reach: BrowserReach = {}): Record<string, boolean> {
  const off: Record<string, boolean> = browserHarmonic ? { ...NOT_IN_THE_BROWSER } : { ...NOT_IN_THE_BROWSER, 'discover.harmonic': false };
  // ADR-0476: Lucy's conversation answers from the account (lucy.cloud_conversation)
  if (lucyHere) delete off.lucy;
  if (reach.measured) {
    delete off['library.corrections'];
    delete off['mixes.shaping.energy_arc'];
    delete off['mixes.shaping.feel'];
    delete off['editor.energy_horizon'];
  }
  if (reach.accountMixes) delete off['editor.locks'];
  if (reach.studio) delete off.seam_inspector;
  if (reach.localExport) delete off.export;
  if (reach.placing) delete off['requests.bridges'];
  return off;
}
