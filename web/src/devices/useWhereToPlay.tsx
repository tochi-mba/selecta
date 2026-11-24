import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { AskState } from './playOn';
import { tabLog } from './audioTab';
import { showToast } from '../ui/toasts';
import { navigate } from '../router';
import type { DeviceHolding } from './controller';
import { SpeakerPicker } from './SpeakerPicker';
import { becauseWords, NOBODY_OPEN, whereToPlay, type Choice, type Situation } from './whereToPlay';

// ADR-0475: what a press of Play does when nothing is playing elsewhere, by the one rule
// (whereToPlay.ts). Every way of starting music in the local-first shell goes through the
// shell's player, whose playFrom asks `decide` first: play here, ask another device to play, open
// "Where should the music play?", or say that no device with music is open.

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Device = { device_id: string; name: string };
/** The one message about where the music is going, with its choices inline. */
export type PlayNotice = { deviceId: string | null; text: string; actions: { label: string; run: () => void }[] };

export function useWhereToPlay({ enabled, situation, cloud, playHere, askToPlay, refreshHoldings, asking: told }: {
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
}): { decide: () => boolean; picker: ReactNode; choice: Choice | null; notice: PlayNotice | null; clearNotice: () => void } {
  const [asking, setAsking] = useState<Extract<Choice, { kind: 'ask' }> | null>(null);
  const said = useRef(new Set<string>());
  // A1: devices that did not answer an ask this visit, left out until the next press
  const silent = useRef(new Set<string>());
  const started = useRef<string | null>(null);
  // one state, one message: the latest replaces any earlier one (shown on Listen's status line)
  const [notice, setNotice] = useState<PlayNotice | null>(null);
  const choice = enabled && situation ? whereToPlay(situation) : null;
  const latest = useRef({ choice, situation });
  latest.current = { choice, situation };

  const saveDefault = useCallback(async (deviceId: string) => {
    try {
      await cloud('/devices/default-speaker', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_id: deviceId }) });
      refreshHoldings();
    } catch {
      showToast('Couldn’t save your default speaker. Try again from Devices.', { tone: 'problem' });
    }
  }, [cloud, refreshHoldings]);

  const startOn = useCallback((device: DeviceHolding, note?: string) => {
    const here = latest.current.situation?.thisDeviceId;
    if (device.device_id === here) {
      setNotice(note ? { deviceId: device.device_id, text: note, actions: [] } : null);
      playHere();
      return;
    }
    started.current = device.device_id;
    askToPlay(device);
    navigate('/listen');
    // the person is holding this device while the sound starts elsewhere: one way back
    const thisHolds = latest.current.situation?.devices.some((one) => one.device_id === here && one.online && one.songs > 0);
    setNotice({ deviceId: device.device_id, text: note ?? `Starting on ${device.name}.`, actions: thisHolds ? [{ label: 'Play here instead', run: () => { setNotice(null); playHere(); } }] : [] });
  }, [askToPlay, playHere]);

  /** True when the press was handled here (asked elsewhere, picker opened, or nothing to do). */
  const decide = useCallback((): boolean => {
    const now = latest.current.choice;
    tabLog('decide', now?.kind ?? 'no rule', latest.current.situation ? latest.current.situation.devices.map((one) => `${one.name}:${one.online ? 'open' : 'away'}:${one.songs}`).join(',') : 'no holdings');
    if (!now || now.kind === 'speaker') return false;
    if (now.kind === 'default') {
      if (now.device.device_id === latest.current.situation?.thisDeviceId) return false;
      startOn(now.device);
      return true;
    }
    if (now.kind === 'only') {
      const note = now.defaultAway ? becauseWords(now.device.name, now.defaultAway.name) : undefined;
      if (now.device.device_id === latest.current.situation?.thisDeviceId && !note) return false;
      startOn(now.device, note);
      return true;
    }
    if (now.kind === 'ask') { setAsking(now); return true; }
    setNotice({ deviceId: null, text: NOBODY_OPEN, actions: [{ label: 'Connect music here', run: () => navigate('/library') }] });
    return true;
  }, [startOn]);

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
      }}
    />
  ) : null;
  return { decide, picker, choice, notice, clearNotice: useCallback(() => setNotice(null), []) };
}
