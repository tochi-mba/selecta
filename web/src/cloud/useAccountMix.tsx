import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { MixData, Request } from '../api';
import { showToast } from '../ui/toasts';
import { onReconnect } from './connection';
import { conflictWords, CURRENT_MIX_CONFLICT, CURRENT_MIX_EVENT, type AccountCurrent } from './currentMix';
import type { RecipeStore } from './recipeStore';

// ADR-0475 R8 in the local-first shell: the account's current mix, followed on every open device.
//
// - Opening, coming back online, and each `mix.current` event take the account's current mix
//   into this browser, so a mix made on any device is current here without a reload.
// - The speaker is the exception: what plays is the playback session's to say, so while this
//   device is making the sound a new current mix never switches it. It shows "{device} made a new
//   mix" with Play it now and Keep playing, and does not start it on its own later.
// - The device that made a mix while another device plays is asked whether to play it there now
//   ("Play on {speaker} now") or later.
// - A choice that lost to another device's at the same moment says so once.

type Device = { device_id: string; name: string };

export function useAccountMix({ recipes, request, refreshMix, setMixData, audibleHere, playHere, askToPlay }: {
  recipes: RecipeStore;
  request: Request;
  refreshMix: () => void;
  setMixData: (data: MixData) => void;
  /** This device is the speaker and its music is going. */
  audibleHere: boolean;
  /** Start this device's current mix from the top, here. */
  playHere: () => void;
  /** Ask another device to play a saved mix (ADR-0475 R2). */
  askToPlay: (device: Device, mixId: string | null) => void;
}): { banner: ReactNode; offerLater: (device: Device) => void; clearOffers: () => void } {
  const [arrived, setArrived] = useState<{ mixId: string; by: string | null } | null>(null);
  const [later, setLater] = useState<{ device: Device; mixId: string | null } | null>(null);
  const audible = useRef(audibleHere);
  audible.current = audibleHere;
  const refresh = useRef(refreshMix);
  refresh.current = refreshMix;

  useEffect(() => {
    const account = recipes.account;
    if (!account) return undefined;
    let live = true;
    const take = (value: AccountCurrent) => {
      if (!live) return;
      account.heard(value);
      if (value.mix_id === recipes.current()) return;
      if (audible.current) {
        // the speaker keeps playing what it plays; a cleared mix is simply not offered
        if (value.mix_id) setArrived({ mixId: value.mix_id, by: value.updated_by_device_name });
        return;
      }
      recipes.setCurrent(value.mix_id);
      refresh.current();
    };
    const look = () => { void account.sync().then(take).catch(() => undefined); };
    const heard = (event: Event) => { const value = (event as CustomEvent<AccountCurrent>).detail; if (value) take(value); };
    const lost = (event: Event) => {
      const value = (event as CustomEvent<AccountCurrent>).detail;
      showToast(conflictWords(value?.updated_by_device_name ?? null));
      refresh.current();
    };
    look();
    window.addEventListener(CURRENT_MIX_EVENT, heard);
    window.addEventListener(CURRENT_MIX_CONFLICT, lost);
    const off = onReconnect(look);
    return () => {
      live = false;
      window.removeEventListener(CURRENT_MIX_EVENT, heard);
      window.removeEventListener(CURRENT_MIX_CONFLICT, lost);
      off();
    };
  }, [recipes]);

  const playArrived = useCallback(async () => {
    const offer = arrived;
    setArrived(null);
    if (!offer) return;
    recipes.setCurrent(offer.mixId);
    const mix = await request<MixData>('/mix').catch(() => null);
    if (!mix?.mix.length) { showToast('That mix couldn’t be opened here. Try again from My Mixes.', { tone: 'problem' }); return; }
    setMixData(mix);
    playHere();
  }, [arrived, playHere, recipes, request, setMixData]);

  const banner = (
    <>
      {/* gone once that mix is the one here (played from this banner, or asked from another device) */}
      {arrived && arrived.mixId !== recipes.current() && (
        <p className="asked-to-play" role="status" data-testid="new-mix-arrived">
          <span className="asked-to-play-words">{arrived.by ?? 'Another device'} made a new mix.</span>
          <button className="primary" onClick={() => void playArrived()}>Play it now</button>
          <button onClick={() => setArrived(null)}>Keep playing</button>
        </p>
      )}
      {later && (
        <p className="asked-to-play" role="status" data-testid="new-mix-later">
          <span className="asked-to-play-words">Your new mix is the current mix. {later.device.name} is still playing the last one.</span>
          <button className="primary" onClick={() => { const offer = later; setLater(null); askToPlay(offer.device, offer.mixId); }}>Play on {later.device.name} now</button>
          <button onClick={() => setLater(null)}>Later</button>
        </p>
      )}
    </>
  );
  return {
    banner,
    offerLater: useCallback((device: Device) => setLater({ device, mixId: recipes.current() }), [recipes]),
    clearOffers: useCallback(() => { setArrived(null); setLater(null); }, []),
  };
}
