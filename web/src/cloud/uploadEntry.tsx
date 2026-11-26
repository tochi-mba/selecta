import { ReactNode, useCallback, useState, useSyncExternalStore } from 'react';
import type { LibrarySong } from '../api';
import { useFlag } from '../flags';
import type { MediaStore } from '../media/store';
import { Icon } from '../ui/Icon';
import { formatCount } from './ImportStatus';
import { candidatesFrom, onUploadStart, uploadStart, type Request, type StartUploads, type UploadCandidate } from './uploadConsent';
import { UploadToCloudSheet } from './UploadToCloudSheet';

// Where "Upload to your cloud library" is offered (`cloud.move_to_cloud`, plan "two places" 6c):
// a Library selection, "Upload all N shown" on the Library's On this device list, a song's details
// and Workspace's "Upload everything on this device". Each opens UploadToCloudSheet. Nothing is
// offered unless the flag is on (it needs the cloud library grant) and the upload queue has bound
// its start (`bindUploadStart`), so no button offers what this device can't do.

/** One upload action for a Library selection, list or song details. */
export type UploadAction = { id: 'upload_selected' | 'upload_shown' | 'upload_song'; label: string; songIds: number[] };

/** The upload actions for what the Library shows, for its selection bar, its list header and a
 * song's details. `onDevice` says whether a song's file is on this device (only those upload);
 * `showHere` is the Library's `show=here` list. Pure, so any page can ask. */
export function uploadActionsFor(input: {
  selected?: readonly number[];
  shown?: readonly number[];
  showHere?: boolean;
  song?: number;
  onDevice: (songId: number) => boolean;
  /** A song that already has a cloud copy has nothing to upload. */
  inCloud?: (songId: number) => boolean;
}): UploadAction[] {
  const wanted = (ids: readonly number[]) => ids.filter((id) => input.onDevice(id) && !input.inCloud?.(id));
  const out: UploadAction[] = [];
  if (input.song !== undefined && wanted([input.song]).length) out.push({ id: 'upload_song', label: 'Upload to your cloud library', songIds: [input.song] });
  const selected = wanted(input.selected ?? []);
  if (selected.length) out.push({ id: 'upload_selected', label: 'Upload to your cloud library', songIds: selected });
  const shown = input.showHere ? wanted(input.shown ?? []) : [];
  if (shown.length) out.push({ id: 'upload_shown', label: `Upload all ${formatCount(shown.length)} shown`, songIds: shown });
  return out;
}

/** The bound queue start, as it comes and goes. */
function useStart(): StartUploads | null {
  return useSyncExternalStore(onUploadStart, uploadStart, uploadStart);
}

/** Opens the sheet for some songs (or every song on this device) and draws it. `available` is
 * false while the flag is off or no queue can run; then `open` does nothing. */
export function useUploadToCloud({ request, openStore, onStarted }: {
  request: Request;
  openStore: () => Promise<MediaStore>;
  onStarted?: (count: number) => void;
}): { available: boolean; open: (songIds?: readonly number[]) => Promise<void>; sheet: ReactNode; problem: string } {
  const on = useFlag('cloud.move_to_cloud');
  const start = useStart();
  const [songs, setSongs] = useState<UploadCandidate[] | null>(null);
  const [problem, setProblem] = useState('');
  const available = on && start !== null;
  const open = useCallback(async (songIds?: readonly number[]) => {
    if (!available) return;
    setProblem('');
    try {
      const found = await candidatesFrom(await openStore(), songIds);
      if (found.length === 0) { setProblem('There are no songs on this device to upload.'); return; }
      setSongs(found);
    } catch {
      setProblem('SelectaDJ could not read this device’s songs. Try again.');
    }
  }, [available, openStore]);
  const sheet = available && songs
    ? <UploadToCloudSheet request={request} songs={songs} start={start} onClose={() => setSongs(null)} onStarted={onStarted} />
    : null;
  return { available, open, sheet, problem };
}

type UploadParts = { request: Request; openStore: () => Promise<MediaStore>; onStarted?: (count: number) => void };

/** One upload action as a button, hosting its own sheet: for the Library's selection bar ("Upload
 * to your cloud library") and its On this device list ("Upload all N shown"). */
export function UploadSongsButton({ action, className, row = false, ...parts }: UploadParts & { action: UploadAction; className?: string; row?: boolean }) {
  const upload = useUploadToCloud(parts);
  if (!upload.available) return null;
  const body = (
    <>
      <button type="button" className={className} onClick={() => void upload.open(action.songIds)}><Icon name="plus" size="toolbar" />{action.label}</button>
      {upload.problem && <span className="hint" role="status">{upload.problem}</span>}
      {upload.sheet}
    </>
  );
  return row ? <div className="row wrap">{body}</div> : body;
}

/** The Library's selection bar and its On this device list (`LibraryPlacesChrome.uploadSongs`):
 * the songs among these whose file is on this device and that have no cloud copy. */
export function libraryUploadSongs(parts: UploadParts): (songs: readonly Pick<LibrarySong, 'id' | 'places'>[], kind: 'selected' | 'shown') => ReactNode {
  return function LibraryUpload(songs, kind) {
    const known = new Map(songs.map((song) => [song.id, song]));
    const ids = songs.map((song) => song.id);
    const [action] = uploadActionsFor({
      ...(kind === 'selected' ? { selected: ids } : { shown: ids, showHere: true }),
      onDevice: (id) => !!known.get(id)?.places?.device,
      inCloud: (id) => !!known.get(id)?.places?.cloud,
    });
    return action ? <UploadSongsButton action={action} row={kind === 'shown'} {...parts} /> : null;
  };
}

/** A song's details: "Upload to your cloud library" for a song whose file is on this device and
 * that has no cloud copy. Given to the Library's places chrome as `uploadActions`
 * (views/LibraryPlaces.tsx), which SongPlaces draws. */
export function songUploadActions(parts: UploadParts): (song: Pick<LibrarySong, 'id' | 'places'>) => ReactNode {
  return function SongUpload(song) {
    const [action] = uploadActionsFor({ song: song.id, onDevice: () => !!song.places?.device, inCloud: () => !!song.places?.cloud });
    return action ? <UploadSongsButton action={action} row {...parts} /> : null;
  };
}

/** Workspace > Sources: "Upload everything on this device". */
export function UploadEverything({ request, openStore, songsHere }: {
  request: Request;
  openStore: () => Promise<MediaStore>;
  /** How many songs this device holds, or null before the count is known. */
  songsHere: number | null;
}) {
  const upload = useUploadToCloud({ request, openStore });
  if (!upload.available || songsHere === 0) return null;
  return (
    <section className="ui-card" aria-labelledby="upload-everything-title">
      <h2 className="section-title" id="upload-everything-title">Your cloud library</h2>
      <ul className="lw-sources">
        <li>
          <span className="lw-source-mark" aria-hidden="true"><Icon name="music" /></span>
          <div>
            <b>Upload the songs on this device</b>
            <span>Each song’s file is copied to your cloud library, so it plays on all your devices. The file on this device stays as it is.</span>
          </div>
          <div className="lw-source-actions">
            <button type="button" onClick={() => void upload.open()}>Upload everything on this device</button>
          </div>
        </li>
      </ul>
      {upload.problem && <p className="hint" role="status">{upload.problem}</p>}
      {upload.sheet}
    </section>
  );
}
