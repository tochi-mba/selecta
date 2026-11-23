import { extrapolate, type SessionState, type SessionView } from './usePlaybackDevice';

// The remote on Listen (flag `devices.remote_control`): what a device that is not the speaker can
// truthfully say about the session, worked out from the session the playback hook already reads.
// Everything here is pure, so each rule has a unit test (remoteNow.test.ts).

/** What the library knows about a song: its catalogue row, in the few fields a remote shows. */
export type SongDetails = { title: string; artist: string; duration_s?: number | null };
export type SongBook = ReadonlyMap<number, SongDetails>;

/** A session another device is the speaker for, with a programme to steer. */
export type RemoteSession = SessionState & { programme: NonNullable<SessionState['programme']> };

/** One programme entry as the remote shows it. `known` is false when the library has no row for
 * the song yet, and then `title` is "Song 3 of 12", never a blank. */
export type RemoteEntry = { index: number; songId: number; title: string; artist: string; durationMs: number | null; known: boolean };

/** Previous restarts the song once it is this far in; before that it goes back one. */
export const PREVIOUS_RESTARTS_AFTER_MS = 3000;
export const UP_NEXT_SHOWN = 5;

/** The session to steer from here, or null: remote control must be on, another device must be the
 * speaker (online or not), and the session must carry a programme. */
export function remoteSession(view: SessionView | null | undefined, remoteControl: boolean): RemoteSession | null {
  if (!remoteControl || !view?.session) return null;
  if (view.speaker !== 'elsewhere' && view.speaker !== 'offline') return null;
  const programme = view.session.programme;
  if (!programme?.length) return null;
  return view.session as RemoteSession;
}

/** Whether this device's own mix is the programme that is playing (same songs, same order). Then
 * the ordinary Listen page already follows the speaker and nothing needs replacing. */
export function sameProgramme(programme: readonly { song_id: number }[], mixSongIds: readonly number[]): boolean {
  return programme.length === mixSongIds.length && programme.every((entry, index) => entry.song_id === mixSongIds[index]);
}

export function entryAt(session: RemoteSession, book: SongBook, index: number): RemoteEntry | null {
  const ref = session.programme[index];
  if (!ref) return null;
  const details = book.get(ref.song_id);
  const seconds = details?.duration_s;
  return {
    index,
    songId: ref.song_id,
    title: details?.title || `Song ${index + 1} of ${session.programme.length}`,
    artist: details ? details.artist || 'Unknown artist' : '',
    durationMs: typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null,
    known: Boolean(details),
  };
}

/** The entries after the current one, soonest first. */
export function upNext(session: RemoteSession, book: SongBook, count: number = UP_NEXT_SHOWN): RemoteEntry[] {
  const out: RemoteEntry[] = [];
  for (let index = session.song_index + 1; index < session.programme.length && out.length < count; index += 1) {
    const entry = entryAt(session, book, index);
    if (entry) out.push(entry);
  }
  return out;
}

export const hasNext = (session: RemoteSession) => session.song_index + 1 < session.programme.length;

/** Whether the position may be shown moving: only while a speaker that is checking in says it is
 * playing. An offline speaker, or one that has not checked in, keeps its last reported position. */
export function advancing(view: SessionView, session: RemoteSession): boolean {
  return view.speaker === 'elsewhere' && session.state === 'playing' && session.state_confidence !== 'uncertain';
}

/** Milliseconds into the current song, from the session's anchor (as the playing bar works it
 * out), held inside the song's length when that is known. */
export function remotePosition(view: SessionView, session: RemoteSession, serverNow: number, durationMs: number | null): number {
  const live = advancing(view, session) ? extrapolate(session, serverNow) : session.offset_ms;
  const at = Math.max(0, live);
  return durationMs === null ? at : Math.min(at, durationMs);
}

/** Where Previous goes: the start of this song once it is more than three seconds in (or when
 * there is no song before it), else the start of the one before. */
export function previousTarget(session: RemoteSession, positionMs: number): { song_index: number; offset_ms: number } {
  const back = positionMs > PREVIOUS_RESTARTS_AFTER_MS || session.song_index <= 0;
  return { song_index: back ? session.song_index : session.song_index - 1, offset_ms: 0 };
}

/** The line above the song: where the music is. */
export function whereWords(view: SessionView): string {
  const name = view.speaker_name ?? 'another device';
  if (view.speaker === 'offline') return `${view.speaker_name ?? 'The speaker'} is offline`;
  if (view.session?.state === 'paused') return `Paused on ${name}`;
  if (view.session?.state === 'stopped') return `Stopped on ${name}`;
  return `Playing on ${name}`;
}

/** What the speaker says about its own sound, told to someone holding a remote: about that
 * device by name, and never an instruction only the speaker could follow (the check tone plays
 * there, not here). Null when its sound is confirmed or it has said nothing. */
export function soundWords(view: SessionView, output: { state: string } | null): string | null {
  const who = view.speaker_name ?? 'The speaker';
  if (output?.state === 'output_unverified') return `${who} hasn’t confirmed its sound yet.`;
  if (output?.state === 'interrupted') return `Sound on ${who} was interrupted, so you may not hear it.`;
  if (output?.state === 'uncertain') return `${who} can’t be sure it is making sound right now.`;
  return null;
}

/** A small honest line under the song when the session is anything other than plainly playing
 * on a speaker that is checking in; null when there is nothing to add. */
export function stateWords(view: SessionView, session: RemoteSession): string | null {
  const who = view.speaker_name ?? 'The speaker';
  if (view.speaker === 'offline') return `${who} may still be playing. Anything you press waits for it to come back.`;
  if (session.state_confidence === 'uncertain') return `${who} has not checked in recently and may still be playing.`;
  if (session.state === 'stopped') return 'Playback has stopped. Press play to start it again.';
  return null;
}

/** m:ss, for the two ends of the seek bar. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The library rows as a book, by song id. */
export function bookOf(songs: readonly ({ id: number } & SongDetails)[]): Map<number, SongDetails> {
  return new Map(songs.map((song) => [song.id, { title: song.title, artist: song.artist, duration_s: song.duration_s ?? null }]));
}
