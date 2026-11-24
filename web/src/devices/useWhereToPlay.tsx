import { ReactNode, useCallback, useRef, useState } from 'react';
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

export function useWhereToPlay({ enabled, situation, cloud, playHere, askToPlay, refreshHoldings }: {
  enabled: boolean;
  /** null until the holdings are read (then the press plays here, as before) */
  situation: Situation | null;
  cloud: Request;
  /** Start the current mix here, from the top. */
  playHere: () => void;
  /** Ask another device to play the current mix (ADR-0475 R2). */
  askToPlay: (device: Device) => void;
  refreshHoldings: () => void;
}): { decide: () => boolean; picker: ReactNode; choice: Choice | null } {
  const [asking, setAsking] = useState<Extract<Choice, { kind: 'ask' }> | null>(null);
  const said = useRef(new Set<string>());
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
      if (note && !said.current.has(note)) { said.current.add(note); showToast(note); }
      playHere();
      return;
    }
    askToPlay(device);
    navigate('/listen');
    // the person is holding this device while the sound starts elsewhere: one way back
    const thisHolds = latest.current.situation?.devices.some((one) => one.device_id === here && one.online && one.songs > 0);
    showToast(note ?? `Playing on ${device.name}.`, thisHolds ? { actions: [{ label: 'Play here instead', run: playHere }] } : {});
  }, [askToPlay, playHere]);

  /** True when the press was handled here (asked elsewhere, picker opened, or nothing to do). */
  const decide = useCallback((): boolean => {
    const now = latest.current.choice;
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
    showToast(NOBODY_OPEN, { actions: [{ label: 'Connect music here', run: () => navigate('/library') }] });
    return true;
  }, [startOn]);

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
  return { decide, picker, choice };
}
