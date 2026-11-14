/** Durable local fencing for a browser speaker.
 * Never acknowledge an output takeover if local storage cannot preserve the fence
 * across a reload. This is separate from ordinary personal/local playback.
 */
export function browserFenceKey(workspaceId: string, zoneId: string): string {
  return 'selecta:browser-fence:' + workspaceId + ':' + zoneId;
}

type FenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function restoreBrowserFence(storage: FenceStorage, key: string): number {
  const raw = storage.getItem(key);
  if (raw !== null && !/^(0|[1-9][0-9]*)$/.test(raw))
    throw new Error('Invalid saved speaker fence. Recover the device before remote control.');
  const generation = raw === null ? 0 : Number(raw);
  if (!Number.isSafeInteger(generation) || generation < 0)
    throw new Error('Invalid saved speaker generation. Recover the device before remote control.');
  try {
    // Probe actual durable write access; getItem alone may succeed in restricted contexts.
    storage.setItem(key, String(generation));
  } catch {
    throw new Error('Durable local fencing unavailable; remote speaker registration is unsafe.');
  }
  return generation;
}

export function advanceBrowserFence(
  storage: FenceStorage, key: string, current: number, next: number,
): number {
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(next) || current < 0 || next < current)
    throw new Error('Refusing stale or invalid browser speaker generation');
  try {
    storage.setItem(key, String(next));
  } catch {
    throw new Error('Durable local fencing unavailable; speaker ownership cannot be acknowledged.');
  }
  return next;
}
