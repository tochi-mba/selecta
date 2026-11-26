import { useCallback, useSyncExternalStore } from 'react';
import type { StudioActivity } from './deviceStudio';
import { onStudios, studioOf } from './studioWiring';

/** "Getting transitions ready" in Listen's queue, under the next transition's info
 * (cloud.one_mixer): one quiet line while the mix's next transitions are prepared ahead, never a
 * card and never holding up the music. A transition that isn't ready when it comes up is blended
 * live, as it always was. Songs in the cloud library are blended live until the cloud studio
 * prepares them, so only this device's own work is counted here. */

export const GETTING_READY = 'Getting transitions ready';

/** What this workspace's player studio is doing, followed as studios come and go. */
function useStudioActivity(workspaceId: string): StudioActivity | null {
  const subscribe = useCallback((changed: () => void) => {
    let off = studioOf(workspaceId)?.state.subscribe(changed) ?? (() => {});
    const offStudios = onStudios(() => {
      off();
      off = studioOf(workspaceId)?.state.subscribe(changed) ?? (() => {});
      changed();
    });
    return () => { off(); offStudios(); };
  }, [workspaceId]);
  const read = useCallback(() => studioOf(workspaceId)?.state.get() ?? null, [workspaceId]);
  return useSyncExternalStore(subscribe, read, () => null);
}

/** The mix's own transitions are being prepared: one in hand for the mix, or more wanted. */
export function gettingReady(activity: StudioActivity | null): boolean {
  if (!activity) return false;
  return (!!activity.making && !activity.making.forRequest) || activity.waiting > 0;
}

export function TransitionsGettingReady({ workspaceId }: { workspaceId: string }) {
  const busy = gettingReady(useStudioActivity(workspaceId));
  if (!busy) return null;
  return (
    <p className="hint listen-getting-ready" role="status" data-testid="transitions-getting-ready">
      {GETTING_READY}. <span className="soft">The music plays meanwhile.</span>
    </p>
  );
}
