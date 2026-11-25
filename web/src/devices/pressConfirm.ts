import { couldNotReach, type Api, type SessionState } from './playbackWire';

// ADR-0475 G3 (item 68): a remote shows a change only once the speaker has carried it out.
//
// The session takes a press at once, but the session is not the sound: the speaker follows it
// and acks the command. A remote that sent play, pause, skip or seek asks the server what became
// of its own press until the speaker acks it, or has reported where it is at the press's state
// (`followed`: its heartbeat came after the press), or the limit passes. Until then the press is
// pending; past the limit the remote says "{Speaker} didn't answer." and shows the session as it
// was before the press, so it never shows a state the speaker is not in.

/** How long a remote waits for the speaker to carry out a press before saying it didn't. */
export const CONFIRM_MS = 7000;
/** How often the sender asks what became of its press while it waits. */
export const CONFIRM_POLL_MS = 500;
/** After saying it didn't answer, the remote keeps an ear out this long (within the press's
 * 60-second life) in case the speaker carries it out late. */
export const LATE_MS = 54_000;
/** The presses a remote waits on the speaker for (volume and the programme settle by themselves). */
export const CONFIRMED_PRESSES = new Set(['play', 'pause', 'skip', 'seek', 'stop']);

export type PressOutcome = 'applied' | 'unavailable_here' | 'superseded' | 'expired' | 'unanswered';

/** A press the speaker has not carried out: the session state the press made, and the one before. */
export type Unconfirmed = { command: string; seq: number; before: SessionState; speakerName: string | null };

type Outcome = { ack_result: string | null; status: string; followed?: boolean };

/** What the speaker did with the press, or 'unanswered' once `limitMs` passes. `stillWanted`
 * false (a newer press, or the page closed) ends the wait early as unanswered, saying nothing. */
export async function awaitSpeaker(
  api: Api, workspaceId: string, deviceId: string, commandId: string,
  { limitMs = CONFIRM_MS, everyMs = CONFIRM_POLL_MS, stillWanted = () => true }: { limitMs?: number; everyMs?: number; stillWanted?: () => boolean } = {},
): Promise<PressOutcome> {
  const until = Date.now() + limitMs;
  while (Date.now() < until && stillWanted()) {
    await new Promise((resolve) => window.setTimeout(resolve, everyMs));
    if (!stillWanted()) break;
    try {
      const outcome = await api<Outcome>(`/playback/commands/${encodeURIComponent(commandId)}?device_id=${encodeURIComponent(deviceId)}`, undefined, workspaceId);
      const result = outcome?.ack_result;
      if (outcome?.followed && !result) return 'applied';
      if (result === 'applied' || result === 'unavailable_here' || result === 'superseded' || result === 'expired') return result;
    } catch {
      // a lost read is tried again on the next beat; the limit still holds
    }
  }
  return 'unanswered';
}

/** Said on the remote when the speaker did not carry out a press in time. */
export const unansweredWords = (speakerName: string | null) => `${speakerName ?? 'The speaker'} didn't answer. Nothing changed there.`;

/** The session as the remote should show it: while a press is unconfirmed and nothing newer has
 * happened, the state, song and place it had before the press. */
export function asConfirmed<T extends SessionState>(session: T, unconfirmed: Unconfirmed | null): T {
  if (!unconfirmed || session.seq !== unconfirmed.seq) return session;
  const { before } = unconfirmed;
  return { ...session, state: before.state, song_index: before.song_index, offset_ms: before.offset_ms, anchor_at: before.anchor_at };
}

/** A press that did not reach the session: offline only for real network loss, never for a
 * refusal or a server that did not answer (ADR-0475 edge cases). */
export function pressFailedWords(problem: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return "You're offline, so that press wasn't sent.";
  if (couldNotReach(problem)) return "Couldn't reach SelectaDJ, so that press wasn't sent. Try again.";
  return (problem as Error)?.message || "That press wasn't taken. Try again.";
}
