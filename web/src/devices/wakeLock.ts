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
  const ask = async () => {
    if (!api || !wanted || doc.visibilityState !== 'visible') return;
    try { sentinel = await api.request('screen'); } catch { sentinel = null; }
  };
  const onVisible = () => { if (doc.visibilityState === 'visible' && (!sentinel || sentinel.released)) void ask(); };
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
