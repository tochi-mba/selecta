/** Shell features served by this computer's own server and not by the browser runtime yet. The
 * shell reads them through the one flag read, so their buttons are gone rather than dead. The
 * command palette and the keyboard shortcuts stay: this shell offers their server-free subset
 * (serverFreeControls.tsx), which needs nothing but this browser and its own player. */
export const NOT_IN_THE_BROWSER = {
  // Request a song is here (localFirstRequests.ts): a request joins only when the member adds it,
  // right after the playing song. Bridge songs need measured keys and tempos, which a browser
  // library has none of.
  'requests.bridges': false,
  // The editor is here (reorder, add, remove, clear, Save a copy, through the recipe store).
  // What it can't do in a browser: lock songs to analysed positions, draw an energy horizon
  // from measurements, or open a transition to re-render it (every one is worked out live).
  'editor.energy_horizon': false,
  'editor.locks': false,
  seam_inspector: false,
  'app.activity': false,
  export: false,
  lucy: false,
  // lyrics are looked up by this computer's own server; the browser has none to show or require
  'lyrics.lookup': false,
  // Harmonic matches are here with cloud.browser_harmonic (BrowserHarmonicMatches.tsx), from
  // whole-song key profiles measured on this device; without it the tab is off (browserFlags)
  // tempo and key corrections and "is it music?" are written to this computer's own analysis
  'library.corrections': false,
  // a browser mix has no measured feel, energy or stems to shape by; its ending can be chosen
  'mixes.shaping.feel': false,
  'mixes.shaping.energy_arc': false,
  'mixes.shaping.stem_moves': false,
} as const;
/** What this shell turns off, with Harmonic matches off too unless the browser's own version
 * (cloud.browser_harmonic) is on for the account. */
export function browserFlags(browserHarmonic: boolean, lucyHere = false): Record<string, boolean> {
  const off: Record<string, boolean> = browserHarmonic ? { ...NOT_IN_THE_BROWSER } : { ...NOT_IN_THE_BROWSER, 'discover.harmonic': false };
  // ADR-0476: Lucy's conversation answers from the account (lucy.cloud_conversation)
  if (lucyHere) delete off.lucy;
  return off;
}
