import { useCallback, useEffect, useRef, useState } from 'react';
import type { MixData, Request } from '../api';
import { navigate } from '../router';
import { PageLink } from '../shell/PageLink';
import { Skeleton } from '../ui/controls';
import { Mix } from '../views/Mix';
import { MixScope } from '../views/mixScope';
import type { ViewProps } from '../views/shared';

/** The account's drafts in the shared pages (cloud.account_mixes, engine-store-mixes.md): My
 * Mixes lists them with the Desktop's own drafts list, and the editor opens one, both through the
 * account's routes, which the shell's request answers. Off, the browser's saved mixes are shown
 * and a draft's editor is the app's alone, as before. */

type Actions = Pick<ViewProps, 'openDraft' | 'playDraft' | 'undo'>;

/** Open, play and Undo for the account's mixes. Playing a draft makes it the current mix (what was
 * current becomes a draft) and starts it in Listen; Undo puts the one before back. */
export function accountDraftActions({ request, setMixData, refreshStatus, player, notify }: {
  request: Request;
  setMixData: (data: MixData) => void;
  refreshStatus: () => void;
  player: ViewProps['player'];
  notify: ViewProps['notify'];
}): Actions {
  const undoCurrent = async () => { setMixData(await request<MixData>('/mix/undo', { method: 'POST' })); };
  return {
    openDraft: (id) => navigate(`/mixes/drafts/${id}/edit`),
    playDraft: async (id, from = 0, face) => {
      const next = await request<MixData>(`/drafts/${id}/play`, { method: 'POST' });
      setMixData(next);
      refreshStatus();
      // the pressed row's face travels into Listen's cover (ADR-0477)
      navigate('/listen', face?.isConnected ? { share: [[face, 'player-art']] } : undefined);
      void player.playFrom(from);
      notify(`Now playing ${next.name}. What was playing is kept in your drafts.`, undoCurrent);
    },
    undo: async (scope) => { if (scope === null) await undoCurrent(); },
  };
}

/** One of the account's drafts in the editor, read and changed through `?draft=`. */
export function AccountDraftEditor({ draftId, shared, request, actions }: { draftId: number; shared: ViewProps; request: Request; actions: Actions }) {
  const [data, setData] = useState<MixData | null>(null);
  const [gone, setGone] = useState(false);
  const asked = useRef(draftId);
  asked.current = draftId;
  // an edit's answer is newer than a read already on its way
  const changes = useRef(0);
  const setDraftMix = useCallback((next: MixData) => { changes.current += 1; setData(next); }, []);
  const refresh = useCallback(() => {
    const want = draftId;
    const seen = changes.current;
    request<MixData>(`/mix?draft=${want}`)
      .then((next) => {
        if (asked.current !== want || seen !== changes.current) return;
        setData(next);
        setGone(false);
      })
      .catch((problem: { status?: number }) => {
        // a draft that's gone says so, rather than quietly showing a different mix
        if (asked.current === want && problem?.status === 404) setGone(true);
      });
  }, [draftId, request]);
  useEffect(() => {
    setData(null);
    setGone(false);
    refresh();
  }, [refresh]);
  const undo = useCallback(async (scope: number | null) => {
    if (scope === null) return actions.undo?.(null);
    setDraftMix(await request<MixData>(`/mix/undo?draft=${scope}`, { method: 'POST' }));
  }, [actions, request, setDraftMix]);
  const renamed = useCallback((name: string) => setData((before) => (before ? { ...before, name } : before)), []);
  if (gone) {
    return (
      <main className="page" id="main">
        <h1 className="display small">That draft isn’t there any more.</h1>
        <p className="lede">It may have been deleted or played on another device. Nothing else has changed.</p>
        <PageLink to="/mixes/mine" className="button primary">See my mixes</PageLink>
      </main>
    );
  }
  if (!data) return <main className="page mix" id="main" aria-busy="true"><Skeleton variant="timeline" label="Opening your draft" /></main>;
  return (
    <MixScope.Provider value={draftId}>
      <Mix
        {...shared}
        {...actions}
        key={draftId}
        mix={data.mix}
        mixName={data.name}
        canUndo={data.can_undo}
        mixEta={data.eta}
        draftPlace={null}
        refreshMix={refresh}
        setMixData={setDraftMix}
        renamedDraft={renamed}
        closeDraft={() => navigate('/mix/current/edit')}
        undo={undo}
      />
    </MixScope.Provider>
  );
}
