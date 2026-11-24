import { useState } from 'react';
import { Sheet } from '../ui/controls';
import type { Alternative, HeldPress, Notices, SessionState } from './usePlaybackDevice';

// What a controller is told about presses that did not simply happen (ADR-0461):
// - presses waiting for an offline speaker, and the ones dropped instead of applied late
//   (BF-0461-04: expired, overtaken by a take-over, or by another press);
// - a song the speaker could not play here, with alternatives from what it holds
//   (BF-0461-05), never a silent skip.
// Shown only with remote control on (`devices.remote_control`); with it off, nothing renders.

const LABEL: Record<string, string> = {
  play: 'Play', pause: 'Pause', skip: 'Skip', seek: 'Seek', set_volume: 'Volume', set_programme: 'Programme change',
};
const WHY: Record<string, string> = {
  expired: 'waited too long', superseded: 'playback moved to another device', stale: 'something changed first',
};

const label = (press: { command: string }) => LABEL[press.command] ?? press.command;

// A dismissed notice stays dismissed across page loads, and a "couldn't play that song" notice
// is only news for a few minutes: an old one from an earlier visit is not shown again.
const SEEN_KEY = 'selecta.controller.notices.seen';
const UNAVAILABLE_FRESH_SECONDS = 180;
function seenBefore(): Set<string> {
  try { return new Set(JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function rememberSeen(ids: Set<string>) {
  try { window.localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-60))); } catch { /* private window: this visit only */ }
}

/** The command that plays `alternative` in place of the missing song. */
export function alternativeCommand(alternative: Alternative, missing: number | null, session: SessionState | null): { name: string; args: Record<string, unknown> } | null {
  if (alternative.programme_index !== null) return { name: 'skip', args: { song_index: alternative.programme_index } };
  const songs = session?.programme?.map((ref) => ref.song_id);
  if (!songs || missing === null) return null;
  const at = songs.indexOf(missing);
  if (at < 0) return null;
  songs[at] = alternative.song_id;
  return { name: 'set_programme', args: { songs, song_index: at } };
}

export function ControllerNotices({ notices, speakerName, session, send }: { notices: Notices | null | undefined; speakerName: string | null; session: SessionState | null; send: (name: string, args?: Record<string, unknown>) => void }) {
  const [dismissed, setDismissed] = useState<Set<string>>(seenBefore);
  const [choosing, setChoosing] = useState(false);
  if (!notices) return null;
  const fresh = (press: { command_id: string }) => !dismissed.has(press.command_id);
  const waiting = notices.waiting.filter(fresh);
  const missed = notices.missed.filter(fresh);
  const recent = (notice: { acked_at: number }) => Date.now() / 1000 - notice.acked_at < UNAVAILABLE_FRESH_SECONDS;
  // a song from an earlier programme (a mix since replaced) is not news about this one
  const thisProgramme = (notice: { song_id: number | null }) => notice.song_id === null || !session?.programme?.length || session.programme.some((ref) => ref.song_id === notice.song_id);
  const unavailable = notices.unavailable.filter(fresh).filter(recent).filter(thisProgramme)[0];
  if (!waiting.length && !missed.length && !unavailable) return null;
  const who = speakerName ?? 'The speaker';
  // the songs that can stand in for the one the speaker could not play, each with its command
  const choices = (unavailable?.alternatives ?? []).flatMap((alternative) => {
    const next = alternativeCommand(alternative, unavailable!.song_id, session);
    return next ? [{ alternative, next }] : [];
  });
  // another copy of the same song carries its title; otherwise the notice cannot name it
  const sameSong = unavailable?.alternatives.find((alternative) => alternative.same_song);
  const missingName = sameSong ? `“${sameSong.title}”` : 'that song';
  const dismiss = (ids: string[]) => setDismissed((was) => { const next = new Set([...was, ...ids]); rememberSeen(next); return next; });
  return (
    <div className="playing-bar-notices" data-testid="controller-notices">
      {waiting.length > 0 && (
        <p data-testid="presses-waiting">{`Waiting for ${who} to come back: ${waiting.map(label).join(', ')}`}</p>
      )}
      {missed.length > 0 && (
        <p data-testid="presses-missed">
          {`Not played while ${who} was offline: ${missed.map((press: HeldPress) => `${label(press)} (${WHY[press.reason] ?? press.reason})`).join(', ')}`}
          <button type="button" onClick={() => dismiss(missed.map((press) => press.command_id))}>OK</button>
        </p>
      )}
      {unavailable && (
        <div data-testid="unavailable-here" className="notice-unavailable">
          <p title={`${who} couldn’t play ${missingName}: its file isn’t there.`}>{`${who} couldn’t play ${missingName}`}<span className="notice-why">: its file isn’t there</span>.</p>
          <div className="notice-actions">
            {choices.length > 0 && <button type="button" aria-haspopup="dialog" onClick={() => setChoosing(true)}>Choose another</button>}
            <button type="button" onClick={() => dismiss([unavailable.command_id])}>Dismiss</button>
          </div>
        </div>
      )}
      {unavailable && choosing && choices.length > 0 && (
        <Sheet title="Play another song" onClose={() => setChoosing(false)}>
          <ul className="notice-alternatives" data-testid="unavailable-alternatives">
            {choices.map(({ alternative, next }) => (
              <li key={alternative.song_id}>
                <button type="button" aria-label={`${alternative.title} - ${alternative.artist}${alternative.same_song ? ' (another copy)' : ''}`} onClick={() => { send(next.name, next.args); setChoosing(false); dismiss([unavailable.command_id]); }}>
                  <b dir="auto">{alternative.title}</b>
                  <span dir="auto">{alternative.artist}{alternative.same_song ? ' (another copy)' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
