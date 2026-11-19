import { useEffect, useMemo, useState } from 'react';
import { crashGuardState, hasWebGpu, noticeCrashOnLoad, observable, retryAfterCrash, StemModelManager, type PrefetchState, type Observable } from '../../dsp/stems';
import { useFlags } from '../../flags';
import type { StemSurfaces } from '../../views/liveTransitions';
import { browserMovesOffered, BROWSER_STEM_MOVES } from '../browserMoves';
import { engineStemsStore } from './engineStore';
import { stemsFlagOn, stemsLicenceHold } from './flag';
import { StemReadiness, StemsTabNotice } from './StemReadiness';
import { stemsAbility, type StemsRole } from './types';
import { useStems } from './useStems';

function meteredConnection(): boolean | null {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection;
  if (!connection) return null;
  return connection.saveData === true || connection.type === 'cellular';
}

/** The browser stem splitter for this shell: its store for the stems surfaces, and the surfaces the
 * shared editor and Listen views draw from (views/liveTransitions.ts StemSurfaces). With the flag
 * off, or while the model's licence is held, there is no store and no surfaces. `prefetch` is the
 * player's prefetcher state, when it has one. */
export function useStemsEngine({ role, programme, prefetch }: { role: StemsRole; programme: readonly number[]; prefetch: Observable<PrefetchState> | null }) {
  const on = useFlags();
  const enabled = stemsFlagOn(on);
  const [manager] = useState(() => new StemModelManager());
  const [pausedByMember] = useState(() => observable(false));
  useEffect(() => {
    if (!enabled) return;
    noticeCrashOnLoad();
    void manager.refresh();
  }, [enabled, manager]);
  const store = useMemo(() => {
    if (!enabled) return null;
    const sources: Observable<unknown>[] = [manager.state, pausedByMember, ...(prefetch ? [prefetch] : [])];
    return engineStemsStore(() => ({
      licenceHold: stemsLicenceHold(),
      deviceCannot: hasWebGpu() ? null : 'this browser has no WebGPU, and splitting without it is too slow',
      crash: crashGuardState(),
      model: manager.state.get(),
      artefactBytes: manager.artefact?.bytes ?? null,
      downloadPaused: pausedByMember.get(),
      prefetch: prefetch?.get() ?? null,
      programme,
      role,
      metered: meteredConnection(),
    }), sources, {
      download: () => { pausedByMember.set(false); return manager.download(); },
      pause: () => { pausedByMember.set(true); manager.pause(); },
      resume: () => { pausedByMember.set(false); return manager.download(); },
      cancel: () => { pausedByMember.set(false); manager.cancel(); return manager.remove(); },
      remove: () => manager.remove(),
      retryAfterCrash: () => { retryAfterCrash(); pausedByMember.set(pausedByMember.get()); },
    });
  }, [enabled, manager, pausedByMember, prefetch, programme, role]);
  const snapshot = useStems(store);
  const surfaces = useMemo<StemSurfaces | null>(() => {
    const ability = snapshot ? stemsAbility(snapshot.splitter, snapshot.role) : null;
    if (!enabled || !snapshot || !ability) return null;
    const stemMoves = browserMovesOffered(ability, on).filter((offered) => (BROWSER_STEM_MOVES as readonly string[]).includes(offered.move));
    return {
      stemMoves,
      readiness: (key) => <StemReadiness enabled status={snapshot.windows[key]} splitter={snapshot.splitter} role={snapshot.role} />,
      listenNotice: <StemsTabNotice enabled snapshot={snapshot} />,
    };
  }, [enabled, snapshot, on]);
  return { enabled, store, surfaces };
}
