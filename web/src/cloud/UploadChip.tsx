import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../ui/Icon';
import { Truncate } from '../ui/format';
import { navigate } from '../router';
import { sizeWords } from './cloudUploadPacing';
import {
  answerMobileData, cancelUploads, chooseFilesAgain, clearFinishedUploads, IDLE_UPLOADS, pauseUploads, resumeUploads, subscribeUploads,
  uploadRows, uploadSnapshot, type UploadSnapshot,
} from './cloudUploadQueue';
import { outcomeWords } from './cloudUploadWords';
import './libraryWorkspace.css';

/** The upload queue as one workspace may see it: another workspace's queue reads as idle. */
export function useUploadQueue(workspaceId: string): UploadSnapshot {
  const read = () => {
    const state = uploadSnapshot();
    return state.workspaceId === workspaceId ? state : IDLE_UPLOADS;
  };
  return useSyncExternalStore(subscribeUploads, read, read);
}

/** Where "Manage storage" goes: the cloud library's songs, largest first (plan Phase 2). */
const MANAGE_STORAGE = '/library?show=cloud&sort=largest';
/** View lists this many songs, then says how many more. */
const VIEW_ROWS = 200;

/** The upload chip in the notice stack's progress row (`cloud.move_to_cloud`), drawn like the
 * import chip: how far the queue has got from any page, with Pause, Cancel and View, on one line
 * at 320px. It also asks the one question (mobile data), says why it paused or stopped, and offers
 * "Choose these files" where the browser cannot read a file twice. The count is not a live region:
 * the words change only when the queue's state does. */
export function UploadChip({ workspaceId }: { workspaceId: string }) {
  const live = useUploadQueue(workspaceId);
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const listId = useId();
  if (live.phase === 'idle') return null;
  const tone = live.phase === 'running' ? 'info' : live.phase === 'finished' ? 'ok' : 'warn';
  const icon = live.phase === 'running' ? 'music' : live.phase === 'finished' ? 'check' : live.phase === 'stopped' ? 'warning' : 'pause';
  const view = <button type="button" className="quiet" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>View</button>;
  // songs not yet uploaded stay on this device as they are: nothing to confirm
  const cancel = <button type="button" className="quiet" onClick={() => void cancelUploads()}>Cancel</button>;
  const choose = live.choose.length > 0 && (
    <>
      <input ref={picker} type="file" multiple hidden accept="audio/*,.aiff,.aif,.flac,.mp3,.m4a,.wav,.ogg,.opus" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void chooseFilesAgain(files); }} />
      <button type="button" onClick={() => picker.current?.click()}>Choose these files</button>
    </>
  );
  let line;
  let actions;
  if (live.phase === 'running') {
    const lead = live.elsewhere ? 'Uploading in another tab' : live.waiting === 'server' ? 'Trying again' : 'Uploading';
    line = <p className="cloud-upload-chip-words"><b>{lead}</b> <span>{`${live.settled} of ${live.total}`}</span></p>;
    actions = <><button type="button" className="quiet" onClick={() => void pauseUploads()}>Pause</button>{cancel}{view}</>;
  } else if (live.phase === 'asking' && live.ask) {
    line = <p className="cloud-upload-chip-words">{live.words}</p>;
    actions = <><button type="button" className="primary" onClick={() => void answerMobileData('now')}>{`Upload now on mobile data (${sizeWords(live.ask.bytes)})`}</button><button type="button" onClick={() => void answerMobileData('wifi')}>Wait for Wi-Fi</button>{view}</>;
  } else if (live.phase === 'paused') {
    line = <p className="cloud-upload-chip-words">{live.words}</p>;
    actions = <>{live.waiting === 'member' && <button type="button" onClick={() => void resumeUploads()}>Resume</button>}{cancel}{view}</>;
  } else if (live.phase === 'stopped') {
    line = <p className="cloud-upload-chip-words">{live.words}</p>;
    actions = live.stop === 'quota'
      ? <><button type="button" onClick={() => navigate(MANAGE_STORAGE)}>Manage storage</button><button type="button" className="quiet" onClick={() => void resumeUploads()}>Try again</button>{view}</>
      : <>{cancel}{view}</>;
  } else {
    line = <p className="cloud-upload-chip-words">{live.words}</p>;
    actions = <>{choose}{view}{!live.choose.length && <button type="button" className="quiet" onClick={() => { setOpen(false); void clearFinishedUploads(); }}>Done</button>}</>;
  }
  return (
    <>
      <div className="cloud-import-chip cloud-upload-chip banner" data-tone={tone} data-phase={live.phase}>
        <Icon name={icon} size="toolbar" />
        {line}
        {live.phase !== 'finished' && choose}
        {actions}
      </div>
      {open && <UploadList id={listId} />}
    </>
  );
}

/** View: each song and what happened to it. */
function UploadList({ id }: { id: string }) {
  const rows = uploadRows();
  const shown = rows.slice(0, VIEW_ROWS);
  return (
    <section id={id} className="cloud-upload-chip-list" aria-label="Uploads to your cloud library">
      <ul>
        {shown.map((row) => (
          <li key={row.songId}><Truncate text={row.title} /><small>{row.state === 'done' ? outcomeWords(row) : row.choose ? 'Choose this file again to upload it.' : 'Waiting.'}</small></li>
        ))}
      </ul>
      {rows.length > shown.length && <p>{`And ${rows.length - shown.length} more.`}</p>}
    </section>
  );
}
