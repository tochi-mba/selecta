import { useId, useState } from 'react';
import { Icon } from '../ui/Icon';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { showToast } from '../ui/toasts';
import { notOn } from './controller';
import { upNext, UP_NEXT_SHOWN } from './remoteNow';
import type { Remote } from './useRemote';

// ADR-0475 G2 (item 56): Up next on a remote, live from the session. A row plays that song now;
// Edit lets the person move a song up or down, remove it, or clear everything after the playing
// song but the next one (asked first; a browser mix keeps at least two songs, so the playing
// song and one after it always stay). Each change goes to the speaker as one programme change that keeps the
// music where it is, and each can be undone for a few seconds from the toast.

export function RemoteQueue({ remote, speakerSongs }: { remote: Remote; speakerSongs?: ReadonlySet<number> | null }) {
  const headingId = useId();
  const [editing, setEditing] = useState(false);
  const [all, setAll] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { session, view } = remote;
  const speaker = view.speaker_name ?? 'the speaker';
  const upcoming = session.programme.slice(session.song_index + 1).map((entry) => entry.song_id);
  const coming = upNext(session, remote.book, all ? upcoming.length : UP_NEXT_SHOWN);
  if (!coming.length) return null;

  /** One change to Up next, with Undo back to how it was. */
  const change = async (songs: number[], said: string) => {
    const before = upcoming;
    if (!(await remote.setUpNext(songs))) return;
    showToast(said, { scope: 'remote-queue', undo: () => { void remote.setUpNext(before); } });
  };
  const move = (from: number, by: number) => {
    const to = from + by;
    if (to < 0 || to >= upcoming.length) return;
    const songs = [...upcoming];
    [songs[from], songs[to]] = [songs[to], songs[from]];
    void change(songs, `Moved ${titleOf(from)} ${by < 0 ? 'up' : 'down'}.`);
  };
  const remove = (at: number) => {
    const songs = upcoming.filter((_, index) => index !== at);
    void change(songs, `Removed ${titleOf(at)} from Up next.`);
  };
  const titleOf = (at: number) => coming.find((entry) => entry.index === session.song_index + 1 + at)?.title ?? 'the song';

  return (
    <section className="remote-next" aria-labelledby={headingId} data-editing={editing || undefined}>
      <div className="remote-next-head">
        <h2 id={headingId}>Up next</h2>
        {editing && upcoming.length > 1 && <button type="button" className="remote-next-clear" onClick={() => setClearing(true)} data-testid="queue-clear"><Icon name="trash" /> Clear</button>}
        <button type="button" className="remote-next-toggle" aria-pressed={editing} onClick={() => setEditing((on) => !on)} data-testid="queue-edit">{editing ? 'Done' : 'Edit'}</button>
      </div>
      <ol>
        {coming.map((entry) => {
          const at = entry.index - session.song_index - 1;
          const words = (
            <span className="remote-next-words"><b dir="auto">{entry.title}</b>{entry.artist && <span dir="auto">{entry.artist}</span>}{speakerSongs && !speakerSongs.has(entry.songId) && <span className="remote-next-missing" data-testid="not-on-speaker">{notOn(speaker)}</span>}</span>
          );
          return (
            <li key={`${entry.index}-${entry.songId}`}>
              {editing ? (
                <div className="remote-next-row">
                  <span className="remote-next-place" aria-hidden="true">{entry.index + 1}</span>
                  {words}
                  <span className="remote-next-edit">
                    <button type="button" aria-label={`Move ${entry.title} up`} title="Move up" disabled={at === 0} onClick={() => move(at, -1)}><Icon name="up" /></button>
                    <button type="button" aria-label={`Move ${entry.title} down`} title="Move down" disabled={at === upcoming.length - 1} onClick={() => move(at, 1)}><Icon name="down" /></button>
                    <button type="button" aria-label={`Remove ${entry.title} from Up next`} title={upcoming.length > 1 ? 'Remove' : 'A mix keeps at least two songs'} disabled={upcoming.length <= 1} onClick={() => remove(at)}><Icon name="trash" /></button>
                  </span>
                </div>
              ) : (
                <button type="button" className="remote-next-play" onClick={() => void remote.skipTo(entry.index)} title={`Play ${entry.title} now`}>
                  <span className="remote-next-place" aria-hidden="true">{entry.index + 1}</span>
                  {words}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {upcoming.length > UP_NEXT_SHOWN && (
        <button type="button" className="remote-next-more" onClick={() => setAll((on) => !on)}>{all ? 'Show fewer' : `Show all ${upcoming.length}`}</button>
      )}
      {clearing && (
        <ConfirmDialog
          title={`Clear Up next on ${speaker}?`}
          body={`The song playing now and the next one stay (a mix keeps at least two songs). ${upcoming.length - 1 === 1 ? 'One song' : `${upcoming.length - 1} songs`} will be taken out.`}
          confirmLabel="Clear Up next"
          cancelLabel="Keep them"
          destructive
          working="Clearing…"
          onConfirm={async () => { if (!(await remote.setUpNext(upcoming.slice(0, 1)))) throw new Error(`${speaker} didn't take that change. Try again.`); }}
          undo={() => { void remote.setUpNext(upcoming); }}
          undoMessage="Up next cleared. You can undo this for a few seconds."
          onClose={() => setClearing(false)}
        />
      )}
    </section>
  );
}
