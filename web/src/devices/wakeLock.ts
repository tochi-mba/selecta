// Keep the screen awake while this device is the speaker, where the browser allows it.
//
// A wake lock is released whenever the page is hidden, so it's asked for again when the page
// comes back. On iOS this is what keeps Web Audio alive: a locked screen suspends it.

/** How long one wake lock request is waited for before it may be asked again. */
const ASK_WAIT_MS = 10_000;

type Sentinel = { release: () => Promise<void>; released?: boolean };
type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> };

export type WakeLockHold = { release: () => void; held: () => boolean };

export function holdWakeLock(nav: Navigator = navigator, doc: Document = document): WakeLockHold {
  const api = (nav as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  let sentinel: Sentinel | null = null;
  let wanted = true;
  let requesting = false;
  const ask = async () => {
    if (!api || !wanted || requesting || (sentinel && !sentinel.released) || doc.visibilityState !== 'visible') return;
    requesting = true;
    // A request the browser never settles left `requesting` set for good, so the lock was never
    // asked for again when the page came back. Past a limit it may be asked again.
    let late = false;
    const giveUp = setTimeout(() => { late = true; requesting = false; }, ASK_WAIT_MS);
    try {
      const granted = await api.request('screen');
      // Released while the browser was still deciding, or answered after a newer lock: let it go.
      if (!wanted || doc.visibilityState !== 'visible' || (late && sentinel && !sentinel.released)) { void granted.release().catch(() => undefined); return; }
      sentinel = granted;
    } catch { if (!late) sentinel = null; }
    finally { clearTimeout(giveUp); if (!late) requesting = false; }
  };
  const onVisible = () => {
    if (doc.visibilityState !== 'visible') {
      const held = sentinel;
      sentinel = null;
      void held?.release().catch(() => undefined);
    } else if (!sentinel || sentinel.released) void ask();
  };
  doc.addEventListener('visibilitychange', onVisible);
  void ask();
  return {
    held: () => Boolean(sentinel && !sentinel.released),
    release: () => {
      wanted = false;
      doc.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    },
  };
}

/** The speaker's lock follows what it does: held while it plays, let go while it is paused, so a
 * phone left on a table is not kept lit for silence. `playing` null (not known) changes nothing.
 * The browser drops a lock while the tab is hidden; `holdWakeLock` asks again when it is shown. */
export function followPlaying(hold: WakeLockHold | null, playing: boolean | null, make: () => WakeLockHold = holdWakeLock): WakeLockHold | null {
  if (playing === null) return hold;
  if (playing) return hold ?? make();
  hold?.release();
  return null;
}
