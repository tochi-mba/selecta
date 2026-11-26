import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { MixData, Request } from '../api';
import { MOVE_NOW_EVENT, MOVE_OFFER_EVENT, moveWords, type MoveOffer } from '../devices/controller';
import { showToast } from '../ui/toasts';
import { accountMixesOn, recipeAsCurrent } from './accountMixes';
import { onReconnect } from './connection';
import { conflictWords, CURRENT_MIX_CONFLICT, CURRENT_MIX_EVENT, isAccountTurn, type AccountCurrent } from './currentMix';
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
// - I85: a Library song the speaker lacks but another open device holds asks "Move the music
//   there?": Move and play puts it first in the current mix and asks that device to play it;
//   Add it later puts it at the end of the current mix, for when the music is there.
// - cloud.account_mixes: the account keeps the current mix itself, and its `mix.current` events
//   say what it now is (cloud_brain/mix_current.py). A device already showing that order does
//   nothing; another reads it again; the speaker is offered it, as above. The last change on any
//   device stands, and Undo there brings the one before back here the same way.

type Device = { device_id: string; name: string };
/** A new mix another device made: a recipe by id, or the account's own (`order`, its song ids). */
type Arrived = { mixId: string; by: string | null; order?: string };

export function useAccountMix({ recipes, request, refreshMix, setMixData, audibleHere, playHere, askToPlay, devices, heldOrder }: {
  recipes: RecipeStore;
  request: Request;
  refreshMix: () => void;
  setMixData: (data: MixData) => void;
  /** This device is the speaker and its music is going. */
  audibleHere: boolean;
  /** Start this device's current mix from the top, here. */
  playHere: () => void;
  /** Ask another device to play a saved mix (ADR-0475 R2). */
  askToPlay: (device: Device, mixId: string | null, move?: boolean) => void;
  /** The person's devices, to find the one an offer names. */
  devices?: () => readonly Device[];
  /** The song ids this device shows as the current mix, in order ("3,1,2"). */
  heldOrder?: () => string;
}): { banner: ReactNode; offerLater: (device: Device) => void; clearOffers: () => void } {
  const [arrived, setArrived] = useState<Arrived | null>(null);
  const [later, setLater] = useState<{ device: Device; mixId: string | null } | null>(null);
  const [move, setMove] = useState<MoveOffer | null>(null);
  useEffect(() => {
    const offered = (event: Event) => { const offer = (event as CustomEvent<MoveOffer>).detail; if (offer) setMove(offer); };
    window.addEventListener(MOVE_OFFER_EVENT, offered);
    return () => window.removeEventListener(MOVE_OFFER_EVENT, offered);
  }, []);
  const moveOn = useCallback(async (offer: MoveOffer, play: boolean) => {
    setMove(null);
    try {
      if (play) {
        // the song first, then the speaker's song and what followed it, as a mix of its own
        const songs = [offer.songId, ...offer.programme.filter((id) => id !== offer.songId)];
        const made = await recipes.create(`Moved to ${offer.device}`, songs);
        const device = devices?.().find((one) => one.name === offer.device);
        if (!device) { showToast(`${offer.device} isn’t open right now. Open SelectaDJ on it.`, { tone: 'problem' }); return; }
        recipes.setCurrent(made.mix_id);
        askToPlay(device, made.mix_id, true);
        return;
      }
      // at the end of the current mix, for when the music is on that device
      const current = recipes.current();
      const read = current ? await recipes.read(current) : null;
      if (read) await recipes.edit(read.mix_id, read.revision, { songIds: [...read.songs.map((one) => one.song_id), offer.songId] });
      else recipes.setCurrent((await recipes.create(`For ${offer.device}`, [offer.songId])).mix_id);
      refresh.current();
      showToast(`${offer.title} is in your mix for when the music is on ${offer.device}.`);
    } catch {
      showToast(`${offer.title} couldn’t be added. Try again.`, { tone: 'problem' });
    }
  }, [askToPlay, devices, recipes]);
  const moveNow = useRef(moveOn);
  moveNow.current = moveOn;
  useEffect(() => {
    const chosen = (event: Event) => { const offer = (event as CustomEvent<MoveOffer>).detail; if (offer) void moveNow.current(offer, true); };
    window.addEventListener(MOVE_NOW_EVENT, chosen);
    return () => window.removeEventListener(MOVE_NOW_EVENT, chosen);
  }, []);
  const audible = useRef(audibleHere);
  audible.current = audibleHere;
  const refresh = useRef(refreshMix);
  refresh.current = refreshMix;
  const held = useRef(heldOrder);
  held.current = heldOrder;

  // cloud.account_mixes: the account's own current mix changed on some device
  useEffect(() => {
    let newest = 0;
    const follow = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (!isAccountTurn(value) || !accountMixesOn()) return;
      // the event stream replays its history to a device that has just connected: an older
      // change is not the account's now
      if (value.updated_at < newest) return;
      newest = value.updated_at;
      if (value.order === held.current?.()) {
        // this device made it, or already shows it
        setArrived((was) => (was?.order !== undefined ? null : was));
        return;
      }
      if (audible.current) {
        // the speaker keeps playing what it plays; a cleared mix is simply not offered
        setArrived(value.songs ? { mixId: 'account', by: value.updated_by_device_name, order: value.order } : (was) => (was?.order !== undefined ? null : was));
        return;
      }
      refresh.current();
    };
    window.addEventListener(CURRENT_MIX_EVENT, follow);
    // back online: what the account has now, unless this device is making the sound
    const off = onReconnect(() => { if (accountMixesOn() && !audible.current) refresh.current(); });
    return () => {
      window.removeEventListener(CURRENT_MIX_EVENT, follow);
      off();
    };
  }, []);

  useEffect(() => {
    const account = recipes.account;
    if (!account) return undefined;
    let live = true;
    const take = (value: AccountCurrent) => {
      if (!live) return;
      // An older value than the one already seen (the event stream replays its history to a
      // device that has just connected) is not the account's now: taking it would make this
      // browser tell the account an old mix is current, and the speaker hear "made a new mix"
      const known = account.seen();
      if (known && value.revision < known.revision) return;
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
    // the account's own mix is followed above, never read as a recipe
    const heard = (event: Event) => { const value = (event as CustomEvent<AccountCurrent>).detail; if (value && !isAccountTurn(value)) take(value); };
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
    // the account's own mix is already current there; a recipe is made current first
    const mix = await (offer.order !== undefined ? request<MixData>('/mix') : recipeAsCurrent(recipes, request, offer.mixId)).catch(() => null);
    if (!mix?.mix.length) { showToast('That mix couldn’t be opened here. Try again from My Mixes.', { tone: 'problem' }); return; }
    setMixData(mix);
    playHere();
  }, [arrived, playHere, recipes, request, setMixData]);

  const banner = (
    <>
      {/* gone once that mix is the one here (played from this banner, or asked from another device) */}
      {arrived && (arrived.order !== undefined ? arrived.order !== held.current?.() : arrived.mixId !== recipes.current()) && (
        <p className="asked-to-play" role="status" data-testid="new-mix-arrived">
          <span className="asked-to-play-words">{arrived.by ?? 'Another device'} made a new mix.</span>
          <button className="primary" onClick={() => void playArrived()}>Play it now</button>
          <button onClick={() => setArrived(null)}>Keep playing</button>
        </p>
      )}
      {move && (
        <p className="asked-to-play" role="status" data-testid="move-offer">
          <span className="asked-to-play-words">{moveWords(move)}</span>
          <button className="primary" onClick={() => void moveOn(move, true)}>Move and play</button>
          <button onClick={() => void moveOn(move, false)}>Add it later</button>
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
