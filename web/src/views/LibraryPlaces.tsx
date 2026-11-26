import { createContext, useState, type ReactNode } from 'react';
import type { LibrarySong } from '../api';
import { Action, Dialog } from '../ui/controls';
import { countOf } from '../ui/format';

/** library.places: what the Library knows about where songs are kept, given by a Cloud shell
 * with a cloud library (plan phase 2). Null everywhere else, and then the Library draws exactly
 * as before: local mode and an account without a cloud library never see any of this. */
export type LibraryPlacesChrome = {
  /** the signed-in person, so a note they put away stays away for them in this browser */
  accountId: string;
  /** the member has other signed-in devices, so "On another device" is offered */
  otherDevices: boolean;
  /** the account can upload to its cloud library (it holds the grant and uploads are on) */
  canUpload: boolean;
  /** SelectaDJ cannot be reached from this page, so cloud songs need a connection */
  offline: boolean;
  /** Remove songs from the cloud library; the files on the member's devices are never touched. */
  removeFromCloud: (songIds: readonly number[]) => Promise<RemovedFromCloud>;
  /** Opens Add music's uploads. */
  upload: () => void;
  /** Phase 6 (cloud.move_to_cloud): the upload actions in a song's details. Nothing is given
   * yet, so nothing is drawn. */
  uploadActions?: (song: LibrarySong) => ReactNode;
  /** cloud.move_to_cloud: "Upload to your cloud library" for a selection, or "Upload all N
   * shown" for the On this device list; nothing when no song there can upload. */
  uploadSongs?: (songs: readonly LibrarySong[], kind: 'selected' | 'shown') => ReactNode;
};

/** The server's answer to a removal: per song, how many copies went and whether it is now
 * kept nowhere at all. */
export type RemovedFromCloud = {
  songs: { id: number; found: boolean; removed?: number; left_nowhere?: boolean }[];
  bytes_released: number;
};

export const LibraryPlacesContext = createContext<LibraryPlacesChrome | null>(null);

/** The place chips, place first so they fit a phone; Set aside combines with a place. */
const PLACE_CHIPS: { name: string; label: string; others?: true }[] = [
  { name: 'all', label: 'All' },
  { name: 'here', label: 'On this device' },
  { name: 'cloud', label: 'In your cloud library' },
  { name: 'other', label: 'On another device', others: true },
  { name: 'attention', label: 'Needs attention' },
  { name: 'set_aside', label: 'Set aside' },
];
/** Shown only while an address asks for them: Workspace's "Show them", and older links. */
const LINK_ONLY: Record<string, string> = { none: 'Not kept anywhere', ready: 'Plays here', playable_now: 'Can play now' };
/** The places Set aside combines with. */
const COMBINES = ['here', 'cloud', 'other', 'none'];
const KNOWN = [...PLACE_CHIPS.map((chip) => chip.name), ...Object.keys(LINK_ONLY)];

export type PlaceFilter = { place: string; aside: boolean; state: string };

/** The filter an address asks for: `show` and `aside=1`. The adapter's state for it is the
 * place, `set_aside`, or `set_aside:<place>` when both. */
export function placeFilter(show: string, aside: boolean): PlaceFilter {
  if (show === 'set_aside') return { place: 'all', aside: true, state: 'set_aside' };
  const place = KNOWN.includes(show) ? show : 'all';
  const combined = aside && (place === 'all' || COMBINES.includes(place));
  return { place, aside: combined, state: combined ? (place === 'all' ? 'set_aside' : `set_aside:${place}`) : place };
}

/** The address after pressing a chip: Set aside turns on and off, a place keeps it. */
export function pressPlace(now: PlaceFilter, name: string): { show: string | null; aside: string | null } {
  if (name === 'set_aside') {
    if (now.aside) return { show: now.place === 'all' ? null : now.place, aside: null };
    return COMBINES.includes(now.place) ? { show: now.place, aside: '1' } : { show: 'set_aside', aside: null };
  }
  if (now.aside && COMBINES.includes(name)) return { show: name, aside: '1' };
  if (now.aside && name === 'all') return { show: 'set_aside', aside: null };
  return { show: name === 'all' ? null : name, aside: null };
}

/** The chips to draw, and whether each is pressed. */
export function placeChips(now: PlaceFilter, otherDevices: boolean): { name: string; label: string; pressed: boolean }[] {
  const chips = PLACE_CHIPS.filter((chip) => !chip.others || otherDevices || now.place === chip.name)
    .map((chip) => ({ name: chip.name, label: chip.label, pressed: chip.name === 'set_aside' ? now.aside : chip.name === now.place }));
  const linked = LINK_ONLY[now.place];
  return linked ? [...chips, { name: now.place, label: linked, pressed: true }] : chips;
}

/** The label of the filter shown, for an empty view; null for All. */
export function placeLabel(now: PlaceFilter): string | null {
  const place = PLACE_CHIPS.find((chip) => chip.name === now.place)?.label ?? LINK_ONLY[now.place] ?? null;
  if (!now.aside) return now.place === 'all' ? null : place;
  return now.place === 'all' ? 'Set aside' : `Set aside, ${place}`;
}

/** "Largest" sorts the cloud library only; anywhere else the sort is by title. */
export function placeSort(sort: string, now: PlaceFilter): string {
  return sort === 'largest' && now.place !== 'cloud' ? 'title' : sort;
}

export function placeSorts<T extends { name: string; label: string }>(sorts: readonly T[], now: PlaceFilter): { name: string; label: string }[] {
  return now.place === 'cloud' ? [...sorts, { name: 'largest', label: 'Largest' }] : [...sorts];
}

/** A size the way the member reads it. */
export function sizeWords(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** Whether removing its cloud copy leaves the song with no copy anywhere. */
export function lastCopy(song: LibrarySong): boolean {
  const places = song.places;
  return !!places?.cloud && places.device === null && places.other.devices === 0
    && !places.other.online.length && !places.other.before.length;
}

/** The words of a removal's confirmation: what goes, its size, and what is left nowhere. */
export function removalWords(songs: readonly LibrarySong[]): { title: string; body: string; warning: string | null } {
  const inCloud = songs.filter((song) => song.places?.cloud);
  const copies = inCloud.reduce((sum, song) => sum + (song.places?.cloud?.copies ?? 1), 0);
  const size = sizeWords(inCloud.reduce((sum, song) => sum + (song.places?.cloud?.bytes ?? 0), 0));
  const one = inCloud.length === 1;
  const title = one ? `Remove “${inCloud[0].title ?? 'this song'}” from your cloud library?` : `Remove ${countOf(inCloud.length, 'song')} from your cloud library?`;
  const what = one
    ? copies > 1 ? `Its ${copies} copies in your cloud library are deleted (${size}).` : `Its copy in your cloud library is deleted (${size}).`
    : `Their ${countOf(copies, 'copy', 'copies')} in your cloud library are deleted (${size}).`;
  const nowhere = inCloud.filter(lastCopy).length;
  const warning = !nowhere ? null
    : one ? 'This song is not on any of your devices, so no copy of it will be left anywhere.'
      : nowhere === inCloud.length ? 'None of these songs is on any of your devices, so no copy of them will be left anywhere.'
        : `${nowhere.toLocaleString()} of these songs ${nowhere === 1 ? 'is' : 'are'} not on any of your devices, so no copy of ${nowhere === 1 ? 'it' : 'them'} will be left anywhere.`;
  return { title, body: `${what} Files on your devices are not touched.`, warning };
}

/** What the member hears once a removal is done. */
export function removedWords(songs: readonly LibrarySong[], answer: RemovedFromCloud): string {
  const gone = answer.songs.filter((song) => (song.removed ?? 0) > 0);
  const nowhere = answer.songs.filter((song) => song.left_nowhere).length;
  const first = songs.find((song) => song.id === gone[0]?.id);
  const done = !gone.length ? 'Those songs were no longer in your cloud library.'
    : gone.length === 1 ? `${first?.title ?? 'That song'} is no longer in your cloud library.`
      : `${countOf(gone.length, 'song')} are no longer in your cloud library.`;
  return nowhere ? `${done} ${nowhere === 1 ? 'One song has' : `${nowhere} songs have`} no copy left anywhere.` : done;
}

/** "Remove from cloud library": the button and its confirmation, for a selection or one song. */
export function RemoveFromCloud({ songs, chrome, onDone, disabled = false, label = 'Remove from cloud library' }: {
  songs: readonly LibrarySong[];
  chrome: LibraryPlacesChrome;
  /** told the server's answer and the words to say */
  onDone: (answer: RemovedFromCloud, words: string) => void | Promise<void>;
  disabled?: boolean;
  label?: string;
}) {
  const [asking, setAsking] = useState<readonly LibrarySong[] | null>(null);
  const [problem, setProblem] = useState('');
  const inCloud = songs.filter((song) => song.places?.cloud);
  if (!inCloud.length) return null;
  const said = asking ? removalWords(asking) : null;
  const remove = async () => {
    if (!asking) return;
    setProblem('');
    try {
      const answer = await chrome.removeFromCloud(asking.filter((song) => song.places?.cloud).map((song) => song.id));
      const chosen = asking;
      setAsking(null);
      await onDone(answer, removedWords(chosen, answer));
    } catch (error) {
      setProblem((error as Error).message || 'That didn’t work. Nothing was removed.');
    }
  };
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => { setProblem(''); setAsking(inCloud); }}>{label}</button>
      {asking && said && (
        <Dialog title={said.title} role="alertdialog" onClose={() => setAsking(null)} footer={<>
          <button type="button" onClick={() => setAsking(null)}>Keep it</button>
          <Action className="primary" working="Removing…" run={remove}>Remove from cloud library</Action>
        </>}>
          <p>{said.body}</p>
          {said.warning && <p className="warn" data-testid="places-last-copy">{said.warning}</p>}
          {problem && <p role="alert" className="warn">{problem}</p>}
        </Dialog>
      )}
    </>
  );
}
