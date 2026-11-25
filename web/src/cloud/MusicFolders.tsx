import { useEffect, useId, useRef, useState } from 'react';
import { useFlag } from '../flags';
import { dirPicker, type FileHandleLike, type StoredFolderHandle } from '../media';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Action, Menu, Skeleton, Status, type StatusKind } from '../ui/controls';
import { countOf, relativeTime } from '../ui/format';
import { Icon } from '../ui/Icon';
import { Meter } from '../ui/Meter';
import {
  allowFolder, checkFolders, clearFolderNotice, importLooseHandles, pickFolderAgain, stopCounts, stopWatching, useMusicFolders, watchChosen, watchParentInstead,
  type AddNotice, type FolderRow, type WatchSnapshot,
} from './folderWatch';
import { checkedOf, checkedWords } from './ImportStatus';
import { useImportSession, type ImportSnapshot } from './importSession';
import { useInstallState, type InstallState } from './install';
import './libraryWorkspace.css';

/** Your music folders (`cloud.music_folders`): every folder this browser watches for this
 * account, how many songs came from each, when it was last checked and whether the browser still
 * allows it, with the one next step for each. One component in two places: folded into the
 * Library's lead (`compact`, open by itself when a folder needs the member), and in full on
 * Workspace > Sources. Off, it draws nothing and the pages are exactly as before. */

const STATE: Record<FolderRow['state'] | 'checking', { kind: StatusKind; words: string }> = {
  watching: { kind: 'ready', words: 'Watching' },
  unchecked: { kind: 'queued', words: 'Not checked yet' },
  permission: { kind: 'needs-action', words: 'Needs your permission' },
  missing: { kind: 'warning', words: 'Not found' },
  visit: { kind: 'paused', words: 'Chosen this visit' },
  checking: { kind: 'working', words: 'Checking' },
};

/** What the folder holds and when it was looked at, in words. */
export function rowWords(row: FolderRow, now = Date.now()): string {
  const parts: string[] = [];
  if (row.songs !== null) parts.push(countOf(row.songs, 'song'));
  if (row.lastNew > 0) parts.push(`${row.lastNew} new last time`);
  if (row.missing > 0) parts.push(`${countOf(row.missing, 'file')} not found`);
  if (row.state === 'permission') parts.push('The browser asks before SelectaDJ reads it again. Allow brings back all its songs at once.');
  else if (row.state === 'missing') parts.push('It may have been renamed or moved. Choose it again and its songs are kept.');
  else if (row.state === 'visit') parts.push('This browser can’t keep it between visits, so choose it again next time.');
  else parts.push(row.checkedAt ? `Checked ${relativeTime((now - row.checkedAt) / 1000)}` : 'Not checked yet');
  return parts.join(', ');
}

/** Under a folder that needs permission again: how to stop being asked each visit. Installed, the
 * browser usually keeps a folder's permission by itself, so only the first sentence is said then. */
export function keepAccessWords(install: InstallState, installOffered: boolean): string {
  const ask = 'Choose Allow on every visit when the browser offers it, and it stops asking.';
  return install === 'installed' || !installOffered ? ask : `${ask} Installed as an app, SelectaDJ usually keeps this permission between visits.`;
}

/** How far a check of this row has got, in words, or null when it is not being checked. */
export function checkWords(row: FolderRow, watch: WatchSnapshot, live: ImportSnapshot): { words: string; value?: number; max?: number } | null {
  const checking = watch.checking?.folderId === row.id ? watch.checking : null;
  if (live.phase === 'running' && live.folderId === row.id) {
    return { words: `Adding new songs, ${checkedWords(live)}`, ...(typeof live.total === 'number' ? { value: checkedOf(live), max: Math.max(live.total, 1) } : {}) };
  }
  if (!checking) return null;
  if (checking.stage === 'looking') return { words: checking.done ? `Looking through it, ${countOf(checking.done, 'song')} found` : 'Looking through it' };
  if (checking.stage === 'reading') return { words: `Checking now, ${checking.done.toLocaleString()} of ${(checking.total ?? 0).toLocaleString()}`, value: checking.done, max: Math.max(checking.total ?? 1, 1) };
  return { words: 'Adding new songs' };
}

function summaryOf(watch: WatchSnapshot): string {
  const rows = watch.rows ?? [];
  if (!rows.length) return 'None yet';
  const checking = rows.find((row) => row.id === watch.checking?.folderId);
  if (checking) return `Checking ${checking.name}`;
  const need = rows.filter((row) => row.state === 'permission').length;
  const gone = rows.filter((row) => row.state === 'missing').length;
  if (need) return `${countOf(need, 'folder')} ${need === 1 ? 'needs' : 'need'} your permission`;
  if (gone) return `${countOf(gone, 'folder')} not found`;
  return rows.every((row) => row.state === 'watching') ? `${countOf(rows.length, 'folder')}, all watching` : countOf(rows.length, 'folder');
}

function noticeWords(notice: AddNotice): string {
  if (notice.kind === 'same') return `You already watch ${notice.name}, so it is not added twice. SelectaDJ is checking it now.`;
  if (notice.kind === 'inside') return `${notice.name} is inside ${notice.parent}, which SelectaDJ already watches, so its songs are already included.`;
  if (notice.kind === 'parent') {
    const names = notice.children.map((child) => child.name).join(', ');
    return `${notice.handle.name} holds ${names}, which you already watch. Watch ${notice.handle.name} in their place? Their songs stay, and nothing is read twice.`;
  }
  return 'SelectaDJ could not open that folder. Try again, or choose songs instead.';
}

/** Whether this browser hands over a dropped folder as a handle SelectaDJ can keep. */
function dropSupported(): boolean {
  return typeof DataTransferItem !== 'undefined' && 'getAsFileSystemHandle' in DataTransferItem.prototype;
}

/** A folder (or songs) dragged onto the page: a clear drop target while dragging, and the
 * folder joins the list as if chosen with Add a folder (its keyboard equivalent). */
function useFolderDrop(on: boolean): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!on || !dropSupported()) return undefined;
    const carriesFiles = (event: DragEvent) => !!event.dataTransfer && [...event.dataTransfer.types].includes('Files');
    const enter = (event: DragEvent) => { if (carriesFiles(event)) { event.preventDefault(); setOver(true); } };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setOver(false); };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setOver(false);
      // the items are only readable during the event itself, so every handle is asked for now
      const asked = [...(event.dataTransfer?.items ?? [])]
        .filter((item) => item.kind === 'file')
        .map((item) => (item as DataTransferItem & { getAsFileSystemHandle(): Promise<unknown> }).getAsFileSystemHandle().catch(() => null));
      void Promise.all(asked).then(async (handles) => {
        const files: FileHandleLike[] = [];
        for (const handle of handles) {
          if ((handle as { kind?: string } | null)?.kind === 'directory') await watchChosen(handle as StoredFolderHandle);
          else if ((handle as { kind?: string } | null)?.kind === 'file') files.push(handle as FileHandleLike);
        }
        importLooseHandles(files);
      });
    };
    document.addEventListener('dragenter', enter);
    document.addEventListener('dragover', enter);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('dragenter', enter);
      document.removeEventListener('dragover', enter);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', drop);
    };
  }, [on]);
  return over;
}

function FolderRowView({ row, watch, live, onAddFolder, onStop }: {
  row: FolderRow; watch: WatchSnapshot; live: ImportSnapshot; onAddFolder: () => void; onStop: (row: FolderRow) => void;
}) {
  const [refused, setRefused] = useState(false);
  const progress = checkWords(row, watch, live);
  const state = progress ? STATE.checking : STATE[row.state];
  const canPick = dirPicker().supported;
  const installNow = useInstallState();
  const installOn = useFlag('app.install');
  const again = () => (row.handle && canPick ? void pickFolderAgain(row.id) : onAddFolder());
  const busy = !!progress;
  const allow = async () => { setRefused(!(await allowFolder(row.id))); };
  const primary = row.state === 'permission'
    ? <Action className="primary" run={allow} working="Asking…">Allow</Action>
    : row.state === 'missing' || row.state === 'visit'
      ? <button type="button" onClick={again}>Choose it again</button>
      : <Action className="quiet" run={() => checkFolders([row.id])} waiting={busy}>Check now</Action>;
  return (
    <li className="mf-row" data-state={progress ? 'checking' : row.state}>
      <span className="lw-source-mark" aria-hidden="true"><Icon name="folder" /></span>
      <div className="mf-row-text">
        <b dir="auto">{row.name}</b>
        <span className="mf-row-words">{progress ? progress.words : rowWords(row)}</span>
        {row.state === 'permission' && canPick && !progress && <span className="mf-row-words">{keepAccessWords(installNow, installOn)}</span>}
        {refused && <span className="mf-row-refused" role="alert">The browser did not allow it. Press Allow to be asked again.</span>}
        {/* the bar's place is always kept, so a check starting or ending never moves the list */}
        <div className="mf-row-meter" aria-hidden={progress ? undefined : 'true'}>
          {progress && <Meter label={`Checking ${row.name}`} showLabel={false} value={progress.value} max={progress.max} valueText={progress.words} />}
        </div>
      </div>
      <Status kind={state.kind}>{state.words}</Status>
      <div className="lw-source-actions mf-row-actions">
        {primary}
        <Menu className="mf-more" label={<><Icon name="more" size="toolbar" /><span className="visually-hidden">{`More for ${row.name}`}</span></>}>
          {/* a folder not found may be back (a drive plugged in again): look once more */}
          {row.handle && row.state === 'missing' && <button type="button" role="menuitem" disabled={busy} onClick={() => void checkFolders([row.id])}><Icon name="search" size="toolbar" />Check now</button>}
          {row.state !== 'missing' && row.state !== 'visit' && <button type="button" role="menuitem" onClick={again}><Icon name="folder" size="toolbar" />Choose it again</button>}
          <button type="button" role="menuitem" onClick={() => onStop(row)}><Icon name="close" size="toolbar" />Stop watching</button>
        </Menu>
      </div>
    </li>
  );
}

function StopDialog({ row, onClose }: { row: FolderRow; onClose: () => void }) {
  const [choice, setChoice] = useState<'keep' | 'remove'>('keep');
  const [counts, setCounts] = useState<{ only: number; shared: number } | null>(null);
  const undo = useRef<(() => Promise<void>) | null>(null);
  const name = useId();
  useEffect(() => {
    let live = true;
    void stopCounts(row.id).then((found) => { if (live) setCounts(found); }, () => undefined);
    return () => { live = false; };
  }, [row.id]);
  const only = counts?.only ?? 0;
  const removing = choice === 'remove' && only > 0;
  return (
    <ConfirmDialog
      title={`Stop watching ${row.name}?`}
      confirmLabel="Stop watching"
      cancelLabel="Keep watching"
      destructive={removing}
      working="Stopping…"
      body={(
        <>
          <p>SelectaDJ stops checking this folder for new songs. The folder and its files on this device are not touched.</p>
          <fieldset className="mf-choices">
            <legend className="visually-hidden">Its songs</legend>
            <label>
              <input type="radio" name={name} checked={choice === 'keep'} onChange={() => setChoice('keep')} />
              <span><b>Keep its songs in my library</b><span>They play here only while this browser can still open them.</span></span>
            </label>
            <label>
              <input type="radio" name={name} checked={choice === 'remove'} onChange={() => setChoice('remove')} disabled={counts !== null && only === 0} />
              <span>
                <b>{counts === null ? 'Remove its songs from my library too' : only === 0 ? 'Remove its songs from my library too (none come only from here)' : `Remove its ${countOf(only, 'song')} from my library too`}</b>
                <span>{counts?.shared ? `${countOf(counts.shared, 'song')} also in another watched folder ${counts.shared === 1 ? 'stays' : 'stay'}.` : 'The files themselves stay where they are.'}</span>
              </span>
            </label>
          </fieldset>
        </>
      )}
      onConfirm={async () => { undo.current = (await stopWatching(row.id, choice === 'remove')).undo; }}
      onClose={onClose}
      undo={() => undo.current?.()}
      undoMessage={removing ? `Stopped watching ${row.name} and took out ${countOf(only, 'song')}.` : `Stopped watching ${row.name}. Its songs stay in your library.`}
    />
  );
}

export function MusicFolders({ workspaceId, variant, onAddFolder, onChooseSongs }: {
  workspaceId: string;
  variant: 'compact' | 'full';
  /** "Add a folder": the page's own folder picker (Connect music's), so the directory input and
   * its fallbacks are the same everywhere. */
  onAddFolder: () => void;
  onChooseSongs: () => void;
}) {
  const on = useFlag('cloud.music_folders');
  const watch = useMusicFolders(workspaceId);
  const live = useImportSession(workspaceId);
  const [stopping, setStopping] = useState<FolderRow | null>(null);
  const [opened, setOpened] = useState(false);
  const over = useFolderDrop(on);
  const titleId = useId();
  if (!on) return null;
  const rows = watch.rows;
  const checkable = (rows ?? []).filter((row) => row.handle && row.state !== 'permission' && row.state !== 'missing');
  const needs = (rows ?? []).some((row) => row.state === 'permission' || row.state === 'missing') || !!watch.notice;
  const kept = dirPicker().supported;
  const notice = watch.notice;
  const body = (
    <>
      <div className="mf-actions">
        <button type="button" className="primary" onClick={onAddFolder}><Icon name="plus" size="toolbar" />Add a folder</button>
        {checkable.length >= 2 && <Action run={() => checkFolders(checkable.map((row) => row.id))} waiting={!!watch.checking}>Check all</Action>}
        <button type="button" className="quiet" onClick={onChooseSongs}><Icon name="music" size="toolbar" />Choose songs</button>
      </div>
      {notice && (
        <div className="banner" data-tone={notice.kind === 'failed' ? 'danger' : 'info'} role="status">
          <Icon name={notice.kind === 'failed' ? 'warning' : 'folder'} size="toolbar" />
          <p>{noticeWords(notice)}</p>
          {notice.kind === 'parent' && <Action className="primary" run={() => watchParentInstead(notice)} working="Changing…">{`Watch ${notice.handle.name} instead`}</Action>}
          <button type="button" className="quiet" onClick={clearFolderNotice}>{notice.kind === 'parent' ? 'Keep as it is' : 'Dismiss'}</button>
        </div>
      )}
      {watch.refused && <p className="banner" data-tone="warn" role="note"><Icon name="warning" size="toolbar" /><span>This browser is not keeping your folder list, so these folders will not be remembered next visit. A private window often causes this.</span></p>}
      {watch.waiting === 'tab' && <p className="hint">Another SelectaDJ tab is checking your folders.</p>}
      {watch.waiting === 'music' && <p className="hint">Your folders are checked when the music pauses.</p>}
      {rows === null
        ? <Skeleton variant="rows" lines={2} label="Looking for your folders" />
        : rows.length === 0
          ? <p className="hint mf-empty">No folders yet. Add the folder your songs are in on this device, and new songs in it show up by themselves while SelectaDJ is open.</p>
          : (
            <ul className="lw-sources mf-list">
              {rows.map((row) => <FolderRowView key={row.id} row={row} watch={watch} live={live} onAddFolder={onAddFolder} onStop={setStopping} />)}
            </ul>
          )}
      <p className="hint mf-limits">{kept
        ? 'SelectaDJ checks these folders when it opens and when you come back to it. It can only check while it is open.'
        : 'This browser can’t keep folders between visits, so choose them again next time. SelectaDJ can only check while it is open.'}</p>
      {over && <div className="mf-drop" aria-hidden="true"><Icon name="folder" size="hero" /><span>Drop a folder to watch it</span></div>}
      {stopping && <StopDialog row={stopping} onClose={() => setStopping(null)} />}
    </>
  );
  if (variant === 'compact') {
    return (
      <details className="mf-folders" open={opened || needs} onToggle={(event) => setOpened((event.currentTarget as HTMLDetailsElement).open)} aria-labelledby={titleId}>
        <summary><span id={titleId}>Your music folders</span><span className="mf-summary">{rows === null ? 'Loading' : summaryOf(watch)}</span></summary>
        <div className="mf-body">{body}</div>
      </details>
    );
  }
  return (
    <section className="ui-card mf-folders" aria-labelledby={titleId}>
      <h2 className="section-title" id={titleId}>Your music folders</h2>
      <p className="section-lead">Songs in these folders on this device are added by themselves while SelectaDJ is open. Folder names stay in this browser.</p>
      <div className="mf-body">{body}</div>
    </section>
  );
}
