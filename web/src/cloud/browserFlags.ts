/** Shell features a device-music Cloud account does not have in the browser, each a product
 * decision with a to-do naming what would change it (docs/engineering/cloud-device-features.md).
 * The shell reads them through the one flag read, so their controls are absent and the page
 * reflows, rather than present and dead. The command palette and the keyboard shortcuts stay:
 * this shell offers their server-free subset (serverFreeControls.tsx). */
export const NOT_IN_THE_BROWSER = {
  // A request joins when the member adds it (localFirstRequests.ts). Bridge songs between a
  // request and the mix are chosen by the app's request planner (T-20261126-a246 covers the
  // browser making a request's transitions; bridges are T-20261126-ae4f).
  'requests.bridges': false,
  // The energy horizon draws the app's measured energy along a mix (T-20261126-bfec).
  'editor.energy_horizon': false,
  // Locks: on below when the account keeps the mix (cloud.account_mixes), whose lock route is the
  // app's own; a mix kept in this browser has no lock.
  'editor.locks': false,
  // The Seam Inspector reads the app's rendered transition files (T-20261126-827e). Each
  // transition here can still be rated Good or Bad and its move chosen (cloud.browser_moves).
  seam_inspector: false,
  // The Activity drawer lists the app's own jobs (T-20261126-36c7).
  'app.activity': false,
  // Export writes audio files from the app's renders; the account's data download is in Account.
  export: false,
  // Lucy: on below with lucy.cloud_conversation (ADR-0476).
  lucy: false,
  // Lyrics need a licence for showing them (ADR-0406); none covers a browser (T-20261126-2cbe).
  'lyrics.lookup': false,
  // Tempo and key corrections: on below when the account keeps measurements (cloud.brain with
  // cloud.device_analysis). "Is it music?" stays the app's: Song details hides it in a browser (T-20261126-3f92).
  'library.corrections': false,
  // Transition feel is a setting of the app's transition maker (T-20261126-6f97).
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
  }
  if (reach.accountMixes) delete off['editor.locks'];
  return off;
}
