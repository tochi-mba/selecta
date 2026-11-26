import { isOnline } from '../cloud/connection';
import { onRoomClosed } from '../rooms/useRoomSession';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { AskState } from './playOn';
import { tabLog } from './audioTab';
import { showToast } from '../ui/toasts';
import { navigate } from '../router';
import type { DeviceHolding } from './controller';
import { SpeakerPicker } from './SpeakerPicker';
import { becauseWords, NOBODY_OPEN, playsHere, whereToPlay, type Choice, type Situation } from './whereToPlay';

// ADR-0475: what a press of Play does when nothing is playing elsewhere, by the one rule
// (whereToPlay.ts). Every way of starting music in the local-first shell goes through the
// shell's player, whose playFrom asks `decide` first: play here, ask another device to play, open
// "Where should the music play?", or say that no device with music is open.

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Device = { device_id: string; name: string };
/** The one message about where the music is going, with its choices inline. */
export type PlayNotice = { deviceId: string | null; text: string; actions: { label: string; run: () => void }[] };

/** B16: a one-time offer or note is shown once on this device, then never again. */
export function onceOnly(key: string): boolean {
  try {
    const name = `selecta.once.${key}`;
    if (localStorage.getItem(name)) return false;
    localStorage.setItem(name, '1');
    return true;
  } catch { return true; }
}

/** T-20261125-45b5: whether "none of your devices with music is open" contradicts this device,
 * which can play its own music or is already the one playing. */
export function nobodyOpenWrong(playableHere: boolean, speakingHere: boolean): boolean {
  return playableHere || speakingHere;
}

/** A5: after this long unseen, the default speaker's note offers to forget it. */
export const GHOST_AFTER_SECONDS = 30 * 24 * 3600;

export function useWhereToPlay({ enabled, situation, cloud, playHere, askToPlay, refreshHoldings, asking: told, playingOn = null, playHereInstead, playableHere = false, speakingHere = false }: {
  enabled: boolean;
  /** null until the holdings are read (then the press plays here, as before) */
  situation: Situation | null;
  cloud: Request;
  /** Start the current mix here, from the top. */
  playHere: () => void;
  /** Ask another device to play the current mix (ADR-0475 R2). */
  askToPlay: (device: Device) => void;
  refreshHoldings: () => void;
  /** What the asked device said (usePlayOn): no answer in time makes it unusable this once. */
  asking?: AskState;
  /** The device the session shows playing now, wherever it is. */
  playingOn?: string | null;
  /** "Play here instead": take the music from whichever device is starting or playing it. */
  playHereInstead?: () => void;
  /** This device has music it can play now, by its own count, which may be ahead of the report the
   * server holds (an import in progress, or a report not refreshed yet). */
  playableHere?: boolean;
  /** This device is the session's speaker: its own tab makes the sound. */
  speakingHere?: boolean;
}): { decide: () => boolean; picker: ReactNode; choice: Choice | null; notice: PlayNotice | null; clearNotice: () => void; say: (deviceId: string | null, text: string) => void } {
  const [asking, setAsking] = useState<Extract<Choice, { kind: 'ask' }> | null>(null);
  // D30: closing the room while the picker is open closes the picker
  useEffect(() => onRoomClosed(() => setAsking(null)), []);
  const said = useRef(new Set<string>());
  // A1: devices that did not answer an ask this visit, left out until the next press
  const silent = useRef(new Set<string>());
  const started = useRef<string | null>(null);
  // one state, one message: the latest replaces any earlier one (shown on Listen's status line)
  const [notice, setNotice] = useState<PlayNotice | null>(null);
  const choice = enabled && situation ? whereToPlay(situation) : null;
  const latest = useRef({ choice, situation, playableHere });
  latest.current = { choice, situation, playableHere };

  const saveDefault = useCallback(async (deviceId: string) => {
    try {
      await cloud('/devices/default-speaker', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_id: deviceId }) });
      refreshHoldings();
    } catch {
      showToast('Couldn’t save your default speaker. Try again from Devices.', { tone: 'problem' });
    }
  }, [cloud, refreshHoldings]);

  // A5: a default speaker not seen for 30 days is likely a ghost (its browser's storage was
  // cleared and it came back as a new device): the note about it offers to forget it
  const forgetGhost = useCallback((away: DeviceHolding | null): { label: string; run: () => void }[] => {
    const now = Date.now() / 1000;
    if (!away || now - away.last_seen_at < GHOST_AFTER_SECONDS) return [];
    return [{ label: `Forget ${away.name}`, run: () => {
      setNotice(null);
      void cloud(`/devices/${encodeURIComponent(away.device_id)}/sign-out`, { method: 'POST' }).then(refreshHoldings, () => showToast(`Couldn’t forget ${away.name}. Try again from Devices.`, { tone: 'problem' }));
    } }];
  }, [cloud, refreshHoldings]);

  const startOn = useCallback((device: DeviceHolding, note?: string, extra: { label: string; run: () => void }[] = []) => {
    const here = latest.current.situation?.thisDeviceId;
    if (device.device_id === here) {
      setNotice(note ? { deviceId: device.device_id, text: note, actions: [] } : null);
      playHere();
      return;
    }
    started.current = device.device_id;
    askToPlay(device);
    navigate('/listen');
    // the person is holding this device while the sound starts elsewhere: one way back (also when
    // this device has no music of its own and the mix has songs in the cloud library)
    const thisHolds = latest.current.situation ? playsHere(latest.current.situation) : false;
    setNotice({ deviceId: device.device_id, text: note ?? `Starting on ${device.name}.`, actions: [...(thisHolds ? [{ label: 'Play here instead', run: () => { setNotice(null); (playHereInstead ?? playHere)(); } }] : []), ...extra] });
  }, [askToPlay, playHere]);

  /** True when the press was handled here (asked elsewhere, picker opened, or nothing to do). */
  const decide = useCallback((): boolean => {
    const now = latest.current.choice;
    tabLog('decide', now?.kind ?? 'no rule', latest.current.situation ? latest.current.situation.devices.map((one) => `${one.name}:${one.online ? 'open' : 'away'}:${one.songs}`).join(',') : 'no holdings');
    if (!now || now.kind === 'speaker') return false;
    // E34: with no connection the other devices can't be asked and what they hold may be stale:
    // no picker and no ask; this device plays if it can, under the usual offline words
    if (!isOnline()) return false;
    if (now.kind === 'default') {
      if (now.device.device_id === latest.current.situation?.thisDeviceId) return false;
      startOn(now.device);
      return true;
    }
    if (now.kind === 'only') {
      // B16: "Playing on X because Y isn't open." is said once per default and device, not every press
      const note = now.defaultAway && onceOnly(`because.${now.defaultAway.device_id}.${now.device.device_id}`) ? becauseWords(now.device.name, now.defaultAway.name) : undefined;
      if (now.device.device_id === latest.current.situation?.thisDeviceId && !note) return false;
      startOn(now.device, note, forgetGhost(now.defaultAway));
      return true;
    }
    if (now.kind === 'ask') { setAsking(now); return true; }
    // the server's report can lag this device's own music: never say none is open from here, nor
    // when this device can play the mix's songs in the cloud library
    const cloudHere = !!latest.current.situation?.cloud && playsHere(latest.current.situation);
    if (nobodyOpenWrong(latest.current.playableHere || cloudHere, false)) return false;
    setNotice({ deviceId: null, text: NOBODY_OPEN, actions: [{ label: 'Connect music here', run: () => navigate('/library') }] });
    return true;
  }, [forgetGhost, startOn]);

  // A1: the device asked did not answer: say so once, with Try again and Choose another device
  const phase = told?.phase;
  const toldId = told?.deviceId;
  useEffect(() => {
    // not answering, or already known not to be open (the server refused the ask)
    if ((phase !== 'no_answer' && phase !== 'offline') || !toldId || toldId !== started.current) return;
    started.current = null;
    silent.current.add(toldId);
    const name = latest.current.situation?.devices.find((one) => one.device_id === toldId)?.name ?? 'That device';
    const others = latest.current.situation ? { ...latest.current.situation, devices: latest.current.situation.devices.map((one) => (silent.current.has(one.device_id) ? { ...one, online: false } : one)) } : null;
    const next = others ? whereToPlay(others) : null;
    const choose = next && next.kind !== 'speaker' && next.kind !== 'none'
      ? [{ label: 'Choose another device', run: () => { setNotice(null); if (next.kind === 'ask') setAsking(next); else startOn(next.device, next.kind === 'only' && next.defaultAway ? becauseWords(next.device.name, next.defaultAway.name) : undefined); } }] : [];
    setNotice({
      deviceId: toldId,
      text: phase === 'offline' ? `${name} isn’t open. Open SelectaDJ there, or play somewhere else.` : `${name} didn’t answer. It may be asleep; try again, or play somewhere else.`,
      actions: [{ label: 'Try again', run: () => { setNotice(null); silent.current.delete(toldId); const again = latest.current.situation?.devices.find((one) => one.device_id === toldId); if (again) startOn(again); } }, ...choose],
    });
  }, [phase, toldId, startOn]);

  // "none of your devices with music is open" is wrong once this tab can play or is playing
  const nobodyWrong = notice?.text === NOBODY_OPEN && nobodyOpenWrong(playableHere, speakingHere);
  useEffect(() => { if (nobodyWrong) setNotice(null); }, [nobodyWrong]);

  // the device named started playing: the session says so now, so the notice has done its job
  const playingThere = playingOn;
  useEffect(() => {
    if (notice?.deviceId && playingThere === notice.deviceId && notice.text.startsWith('Starting on')) setNotice(null);
  }, [notice, playingThere]);

  const live = choice?.kind === 'ask' ? choice : asking;
  const picker = asking && live && situation ? (
    <SpeakerPicker
      options={live.options} suggested={asking.suggested} defaultAway={live.defaultAway}
      total={situation.mixIds.length} thisDeviceId={situation.thisDeviceId} now={Date.now() / 1000}
      onCancel={() => setAsking(null)}
      onChoose={(device, makeDefault) => {
        setAsking(null);
        if (makeDefault) void saveDefault(device.device_id);
        startOn(device);
        // B16: with no default yet, once on this device: offer to make the chosen one usual
        if (!makeDefault && !latest.current.situation?.defaultId && onceOnly('usual-speaker')) {
          setNotice({ deviceId: null, text: `Make ${device.name} your usual speaker?`, actions: [
            { label: 'Make it usual', run: () => { setNotice(null); void saveDefault(device.device_id); } },
            { label: 'Not now', run: () => setNotice(null) },
          ] });
        }
      }}
    />
  ) : null;
  /** B7: one line from elsewhere on the page ("Carrying on from {old} on {new}."), replacing any other. */
  const say = useCallback((deviceId: string | null, text: string) => setNotice({ deviceId, text, actions: [] }), []);
  return { decide, picker, choice, notice, say, clearNotice: useCallback(() => setNotice(null), []) };
}
