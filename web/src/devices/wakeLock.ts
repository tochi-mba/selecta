// Keep the screen awake while this device is the speaker, where the browser allows it.
//
// A wake lock is released whenever the page is hidden, so it's asked for again when the page
// comes back. On iOS this is what keeps Web Audio alive: a locked screen suspends it.

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
    try {
      const granted = await api.request('screen');
      // Released while the browser was still deciding: let the late lock go at once.
      if (!wanted || doc.visibilityState !== 'visible') { void granted.release().catch(() => undefined); return; }
      sentinel = granted;
    } catch { sentinel = null; }
    finally { requesting = false; }
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
