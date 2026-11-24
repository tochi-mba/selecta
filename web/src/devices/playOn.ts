import { useCallback, useEffect, useRef, useState } from 'react';
import { houseTab } from './audioTab';

// ADR-0475 R2, "Play on {device}": one device asks another of the same person's devices to
// become the speaker and start. It is an ask, not a remote take-over: the asked device decides
// (it may need its music folder again, or one press to allow sound), takes over by its own
// action (ADR-0461) and answers. The asker shows exactly what it was told, and never says sound
// started: that is believed only when the session shows the device as speaker and playing.

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

/** The ask as the workspace event stream delivers it (`playback.start_ask`). */
export type StartAsk = { ask_id: string; target_device_id: string; target_name: string; asker_device_id: string; asker_name: string; mix_id: string | null; expires_at: number };
/** What the asked device said (`playback.start_answer`). */
export type StartResult = 'starting' | 'needs_music' | 'needs_gesture' | 'no_mix' | 'declined';
export type StartAnswer = { ask_id: string; asker_device_id: string; target_device_id: string; target_name: string; result: StartResult };

/** Fired on window by the Cloud event stream (CloudApp) for each ask and each answer. */
export const START_ASK_EVENT = 'selecta-start-ask';
export const START_ANSWER_EVENT = 'selecta-start-answer';
/** How long the asker waits for any answer before saying the device did not answer. */
export const START_ASK_WAIT_MS = 10_000;
/** How long "Starting on {device}" may stand before the asker stops claiming even that. */
export const STARTING_WAIT_MS = 20_000;

export type AskPhase = 'asking' | StartResult | 'no_answer' | 'offline' | 'failed';
export type AskState = { phase: AskPhase; device: string; deviceId: string } | null;

/** The one sentence the asker shows for each thing it can be told. */
export function askWords(phase: AskPhase, device: string): string {
  switch (phase) {
    case 'asking': return `Asking ${device}…`;
    case 'starting': return `Starting on ${device}…`;
    case 'needs_music': return `${device} needs its music folder again. Choose it on ${device}.`;
    case 'needs_gesture': return `${device} needs one press of Play. Press Play on ${device} to allow sound.`;
    case 'no_mix': return `${device} has no mix to play. Make a mix first.`;
    case 'declined': return `Not started on ${device}.`;
    case 'offline': return `${device} isn’t open right now. Open SelectaDJ on it.`;
    case 'no_answer': return `${device} didn’t answer. Is SelectaDJ open on it?`;
    default: return `Couldn’t ask ${device}. Try again.`;
  }
}

/** True while the asker is still waiting on the other device (the button shows it is working). */
export const stillAsking = (state: AskState) => state?.phase === 'asking' || state?.phase === 'starting';

export function usePlayOn({ cloud, deviceId, enabled, serverNow, onAsk }: {
  cloud: Request;
  /** This device's own id; null until it has registered. */
  deviceId: string | null;
  enabled: boolean;
  /** The server's clock as this device knows it, to judge an ask's expiry. */
  serverNow: () => number;
  /** This device was asked to play: what it can say straight away. `needs_gesture` means it has
   * shown its own prompt and will answer again (through `answer`) when the person presses. */
  onAsk: (ask: StartAsk) => Promise<StartResult>;
}) {
  const [state, setState] = useState<AskState>(null);
  const waiting = useRef<{ askId: string | null; timer: number }>({ askId: null, timer: 0 });
  const handler = useRef(onAsk);
  handler.current = onAsk;
  const clock = useRef(serverNow);
  clock.current = serverNow;

  const stopWaiting = () => { window.clearTimeout(waiting.current.timer); waiting.current = { askId: null, timer: 0 }; };
  useEffect(() => () => window.clearTimeout(waiting.current.timer), []);

  /** Tell the asker what this device decided. */
  const answer = useCallback(async (ask: Pick<StartAsk, 'ask_id' | 'asker_device_id'>, result: StartResult) => {
    if (!deviceId) return;
    await cloud(`/playback/start-asks/${encodeURIComponent(ask.ask_id)}/answer`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, asker_device_id: ask.asker_device_id, result }),
    }).catch(() => undefined);
  }, [cloud, deviceId]);

  /** Ask `target` to start. `mixId`: the saved mix to play, or null for the one it already has. */
  const ask = useCallback(async (target: { device_id: string; name: string }, mixId: string | null) => {
    if (!deviceId || !enabled) return;
    stopWaiting();
    const told = (phase: AskPhase) => setState({ phase, device: target.name, deviceId: target.device_id });
    told('asking');
    try {
      const made = await cloud<StartAsk>('/playback/start-asks', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, target_device_id: target.device_id, ...(mixId ? { mix_id: mixId } : {}) }),
      });
      waiting.current = { askId: made.ask_id, timer: window.setTimeout(() => { waiting.current = { askId: null, timer: 0 }; told('no_answer'); }, START_ASK_WAIT_MS) };
    } catch (problem) {
      told((problem as { code?: string }).code === 'target_offline' ? 'offline' : 'failed');
    }
  }, [cloud, deviceId, enabled]);

  /** Forget what was said (the device is now the speaker, or the person moved on). */
  const reset = useCallback(() => { stopWaiting(); setState(null); }, []);

  useEffect(() => {
    if (!enabled || !deviceId) return undefined;
    // ADR-0475 F: every tab of this browser hears the ask; exactly one answers it
    const house = houseTab(`${deviceId}`);
    const asked = (event: Event) => {
      const one = (event as CustomEvent<StartAsk>).detail;
      if (!one || one.target_device_id !== deviceId || !house.holds()) return;
      // an ask that has run out is not acted on: the asker has already been told nobody answered
      if (clock.current() > one.expires_at) return;
      void handler.current(one).then((result) => answer(one, result)).catch(() => undefined);
    };
    const answered = (event: Event) => {
      const one = (event as CustomEvent<StartAnswer>).detail;
      if (!one || one.asker_device_id !== deviceId || one.ask_id !== waiting.current.askId) return;
      window.clearTimeout(waiting.current.timer);
      const told = (phase: AskPhase) => setState({ phase, device: one.target_name, deviceId: one.target_device_id });
      told(one.result);
      // waiting on a press there, or on its start: the ask stays the one being answered
      if (one.result === 'needs_gesture') { waiting.current = { askId: one.ask_id, timer: 0 }; return; }
      if (one.result === 'starting') {
        waiting.current = { askId: one.ask_id, timer: window.setTimeout(() => { waiting.current = { askId: null, timer: 0 }; told('no_answer'); }, STARTING_WAIT_MS) };
        return;
      }
      waiting.current = { askId: null, timer: 0 };
    };
    window.addEventListener(START_ASK_EVENT, asked);
    window.addEventListener(START_ANSWER_EVENT, answered);
    return () => { house.close(); window.removeEventListener(START_ASK_EVENT, asked); window.removeEventListener(START_ANSWER_EVENT, answered); };
  }, [answer, deviceId, enabled]);

  return { state, ask, answer, reset };
}

/** Whether this page may start sound without a press: browsers allow it only after the person
 * has pressed or typed something on the page since it loaded. Unknown is treated as not yet. */
export function soundAllowedHere(): boolean {
  const activation = (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation);
  return activation?.hasBeenActive === true;
}
