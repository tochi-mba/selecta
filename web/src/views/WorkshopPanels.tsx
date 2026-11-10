import { flagOn } from '../flags';
import { LinkIfThere } from '../shell/PageLink';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, FolderCheck, Folders, get, Jobs, post, Storage } from '../api';
import { gb, storageWords } from '../lib';
import { PageLink } from '../shell/PageLink';
import { Action, Dialog, Problem, Skeleton, Status } from '../ui/controls';
import { Field, Slider } from '../ui/primitives';
import { useVisiblePoll } from '../ui/useVisiblePoll';
import { ViewProps } from './shared';
import { refreshJobs, useJobsStatus } from '../state/jobs';
import { words } from '../copy';

const GB = 1024 ** 3;

type Memory = { tried: number; clean: number; warned: number; failed: number; liked: number; disliked: number };

/** What Selecta has measured from rendering, kept apart from what a person thinks of it. A clean check
 * means nothing went wrong that a check can find, which isn't the same as sounding good. */
export function MemoryPanel() {
  const [memory, setMemory] = useState<Memory | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => get<Memory>('/memory').then((value) => { setMemory(value); setFailed(false); }).catch(() => setFailed(true)), []);
  useEffect(() => { void load(); }, [load]);
  if (failed) return <Problem retry={load}>Couldn’t load learning history.</Problem>;
  if (!memory) return <Skeleton variant="metrics" label="Loading learning history" />;
  if (!memory.tried) return <section className="panel"><h2>Learning starts with listening</h2><p className="hint">{words().learningStaysHere}</p></section>;
  const rated = memory.liked + memory.disliked;
  return (
    <section className="panel stack">
      <h2>What it’s learned</h2>
      <p>
        Selecta remembers {memory.tried} hand-over{memory.tried === 1 ? '' : 's'} it has tried: {memory.clean} came out clean,{' '}
        {memory.warned} with a warning, and {memory.failed} that can’t work.
        {rated > 0 && ` You’ve rated ${rated}.`} Mixes and suggestions use all of this, and it stays even when old seams are cleared to save space.
      </p>
      <p className="hint">
        “Clean” and “warning” are automatic checks on the audio. They can’t say how something sounds. Only your Good and Bad ratings and listening studies can, and those are one person’s ear, not proof.
      </p>
    </section>
  );
}

export function StoragePanel() {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const wait = useRef<number | undefined>(undefined);
  const saves = useRef(0);
  // A slow earlier budget write must not overtake the most recently chosen
  // limit. Serialise writes and apply only the newest answer to the controls.
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const budgetEditing = useRef(false);
  const confirmed = useRef<number | null>(null);
  const [saved, setSaved] = useState(true);
  const [problem, setProblem] = useState('');
  const [wanted, setWanted] = useState<number | null>(null);
  // SF-0230-05: a limit below what's already kept removes files, so it waits for a yes
  const [pending, setPending] = useState<number | null>(null);
  const [reclaimed, setReclaimed] = useState('');

  const [loadFailed, setLoadFailed] = useState(false);
  const refresh = () => {
    const seen = saves.current;
    return get<Storage>('/storage').then((data) => {
      if (seen !== saves.current || budgetEditing.current) return;
      setLoadFailed(false);
      setStorage(data);
      confirmed.current = data.budget_bytes / GB;
      setLimit((current) => current ?? data.budget_bytes / GB);
    }).catch(() => setLoadFailed(true));
  };
  useEffect(() => {
    void refresh().catch(() => {});
  }, []);
  useVisiblePoll(() => refresh().catch(() => {}), 15000);

  if ((!storage || limit === null) && loadFailed) return <Problem retry={refresh}>Couldn’t read storage information.</Problem>;
  if (!storage || limit === null) return <Skeleton variant="metrics" label="Working out how much room there is" />;
  const words = storageWords(storage);
  const overBudget = storage.cache_bytes > storage.budget_bytes;
  const largest = Math.max(storage.largest_budget_bytes / GB, 0.5);
  const smallest = storage.smallest_budget_bytes / GB;

  const move = (value: number, confirmedRemoval = false) => {
    budgetEditing.current = true;
    setLimit(value);
    setProblem('');
    setWanted(null);
    setReclaimed('');
    saves.current += 1;
    const mine = saves.current;
    window.clearTimeout(wait.current);
    if (!confirmedRemoval && value * GB < storage.cache_bytes) {
      // nothing is removed until this is confirmed; the preview says how much could go
      setPending(value);
      setSaved(true);
      return;
    }
    setPending(null);
    setSaved(false);
    const before = storage.cache_bytes;
    wait.current = window.setTimeout(() => {
      const work = writeQueue.current.then(() => post<Storage>('/storage', { budget_gb: value }))
        .then((answer) => {
          if (confirmedRemoval) {
            const gone = Math.max(before - answer.cache_bytes, 0);
            setReclaimed(gone ? `Removed ${gb(gone)}. Selecta now keeps ${gb(answer.cache_bytes)} it can make again.` : 'Nothing could be removed: what’s left belongs to priority songs.');
          }
          // All successful responses update the confirmed server value; only
          // the latest choice updates the visible setting. If that choice
          // later fails, the fallback is the last real accepted limit.
          confirmed.current = answer.budget_bytes / GB;
          if (mine !== saves.current) return;
          setStorage(answer);
          setLimit(answer.budget_bytes / GB);
          setProblem('');
          budgetEditing.current = false;
          setSaved(true);
        })
        .catch((error: Error) => {
          if (mine !== saves.current) return;
          setProblem(confirmedRemoval ? `Nothing was removed. ${error.message}` : error.message);
          setWanted(value);
          budgetEditing.current = false;
          setSaved(true);
          if (confirmed.current !== null) setLimit(confirmed.current);
        });
      writeQueue.current = work;
    }, confirmedRemoval ? 0 : 400);
  };
  const keepLimit = () => {
    budgetEditing.current = false;
    setPending(null);
    if (confirmed.current !== null) setLimit(confirmed.current);
  };

  const total = Math.max(1, storage.used_bytes + storage.free_bytes);
  return (
    <section className="panel stack">
      <h2>Storage</h2>
      {loadFailed && <Problem retry={refresh}>Storage information may be out of date.</Problem>}
      <p>{words.summary}</p>
      <div className="bar-meter" role="img" aria-label={words.summary}>
        <i className="kept" style={{ width: `${(100 * storage.kept_bytes) / total}%` }} />
        <i className="cache" style={{ width: `${(100 * storage.cache_bytes) / total}%` }} />
      </div>
      <p className="hint">{words.detail}</p>
      <dl className="song-facts">
        <div><dt>Made by Selecta, can be made again</dt><dd>{gb(storage.cache_bytes)} of {gb(storage.budget_bytes)} allowed</dd></div>
        <div><dt>Everything else Selecta keeps</dt><dd>{gb(storage.kept_bytes)}</dd></div>
        <div><dt>Free on this drive</dt><dd>{gb(storage.free_bytes)}</dd></div>
      </dl>
      <p className="hint">Your music files aren’t counted here, because Selecta doesn’t copy them, and nothing here ever touches them.</p>
      <label className="limit">
        <span>
          Keep up to <b>{limit.toFixed(1)} GB</b> of vocals and seams
        </span>
        <Slider
          label={`Keep up to ${limit.toFixed(1)} GB of vocals and seams`}
          valueText={`${limit.toFixed(1)} gigabytes`}
          min={smallest}
          max={largest}
          step={0.1}
          value={Math.min(limit, largest)}
          onChange={(event) => move(Number(event.target.value))}
        />
      </label>
      {pending !== null && (
        <div className="stack storage-preview" role="group" aria-label="Before anything is removed">
          <p>
            A limit of {pending.toFixed(1)} GB removes up to {gb(storage.cache_bytes - pending * GB)} of vocals and seams, oldest first.
            Priority songs’ stems stay. Anything removed is made again when it’s needed, and your music is never touched.
          </p>
          <div className="row wrap">
            <Action run={() => move(pending, true)}>Remove up to {gb(storage.cache_bytes - pending * GB)}</Action>
            <button type="button" onClick={keepLimit}>Keep {confirmed.current?.toFixed(1) ?? limit.toFixed(1)} GB</button>
          </div>
        </div>
      )}
      {!saved && !problem && <p className="hint" role="status">Saving…</p>}
      {saved && !problem && pending === null && <p className="hint" role="status">{reclaimed || `Saved: ${limit.toFixed(1)} GB.`}</p>}
      {problem && <p className="warn" role="alert">{problem} The limit is still {limit.toFixed(1)} GB.</p>}
      {wanted !== null && <Action run={() => move(wanted)}>Retry saving budget</Action>}
      <p className="hint">
        {overBudget
          ? 'Priority-song stem windows are protected, so they can temporarily put the cache over its limit. Lower a song’s priority to make its windows eligible for removal.'
          : 'When it’s full, Selecta removes the oldest cache items that are not protected by song priority. It makes them again if needed.'}{' '}
        It always leaves at least 2 GB free. Your music is never touched. The most it can use right now is {gb(storage.largest_budget_bytes)}.
      </p>
    </section>
  );
}

/** What needs someone, from what's actually there. An empty list means nothing's wrong, and it only
 * says so once it has actually looked. */
export function NeedsYou({ jobs, readySongs, folders }: { jobs: Jobs; readySongs: number; folders: Folders | null }) {
  const missing = folders?.folders.filter((folder) => !folder.available) ?? [];
  const items: { key: string; words: string; to: string; action: string }[] = [];
  if (jobs.storage_full) items.push({ key: 'storage', words: 'Rendering is waiting until there’s more room for it.', to: '/workshop/storage', action: 'Make more room' });
  if (readySongs < 6) items.push({ key: 'ready', words: `Selecta needs 6 mix-ready songs to build a mix, and has ${readySongs}.`, to: '/library?show=attention', action: 'See what’s holding them back' });
  if (jobs.failed_seams.length) items.push({ key: 'seams', words: `${jobs.failed_seams.length} transition${jobs.failed_seams.length === 1 ? '' : 's'} in your current mix couldn’t be made.`, to: '/mix/current/edit', action: 'Choose another move' });
  if (jobs.failed_songs.length) items.push({ key: 'songs', words: `${jobs.failed_songs.length} song${jobs.failed_songs.length === 1 ? '' : 's'} couldn’t be analysed.`, to: '/library?show=attention', action: 'Look at those songs' });
  if (jobs.analysis.paused && jobs.analysis.left) items.push({ key: 'paused', words: `Analysis is paused, with ${jobs.analysis.left} to go.`, to: '/workshop/analysis', action: 'Carry on' });
  if (missing.length) items.push({ key: 'folders', words: `${missing.length} music folder${missing.length === 1 ? '' : 's'} can’t be found right now. Songs are kept until ${missing.length === 1 ? 'it’s' : 'they’re'} back.`, to: '/workshop/sources', action: 'See your folders' });
  // CI-0180-01: one line on whether the library can be mixed at all, and the first item is the one
  // thing to do first; the rest stay listed below it (MP-0293-01)
  const health = flagOn('workspace.library_health');
  const blocked = readySongs < 6;
  return (
    <section className="panel stack needs-you">
      <h2>What needs you</h2>
      {health && (
        <p className="library-health">
          {blocked
            ? <Status kind="blocked">{`Mixing is blocked: ${readySongs} of the 6 mix-ready songs a mix needs`}</Status>
            : jobs.storage_full
              ? <Status kind="blocked">{`Your library can be mixed, with ${readySongs} songs ready, but rendering is blocked`}</Status>
              : <Status kind="ready">{`Your library can be mixed: ${readySongs} songs ready`}</Status>}
        </p>
      )}
      {items.length === 0
        ? <p><Status kind="ready">Nothing needs you right now</Status></p>
        : (
          <ul className="needs-you-list">
            {items.map((item, index) => (
              <li key={item.key} className={health && index === 0 && items.length > 1 ? 'needs-you-first' : undefined}>
                <Status kind="needs-action">{health && index === 0 && items.length > 1 ? <><b>Do this first. </b>{item.words}</> : item.words}</Status>
                <LinkIfThere to={item.to}>{item.action}</LinkIfThere>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/** What's actually going on in the background, from what's actually there. */
export function JobsPanel({ status, onJobs }: { status: ViewProps['status']; onJobs?: (jobs: Jobs) => void }) {
  const { jobs, stale: failed, unsupported } = useJobsStatus();
  useEffect(() => {
    if (jobs) onJobs?.(jobs);
  }, [jobs, onJobs]);
  if (unsupported) return <p className="hint">{words().jobsNeedRestart}</p>;
  if (!jobs) return failed ? <Problem retry={refreshJobs}>Couldn’t find out what’s running.</Problem> : <Skeleton variant="metrics" label="Finding out what’s running" />;
  const left = jobs.mix.queued + jobs.mix.rendering + jobs.mix.none;
  return (
    <section className="panel stack">
      <h2>What’s happening now</h2>
      {failed && <p className="warn" role="status">Can’t check right now, so this may be out of date.</p>}
      <ul className="job-list">
        <li>
          <b>Rendering</b>
          {!jobs.worker.running
            ? <Status kind="unavailable">Not started. It starts by itself when there’s something to do.</Status>
            : jobs.storage_full
              ? <Status kind="needs-action">Blocked: the storage limit has been reached</Status>
              : jobs.mix.rendering || jobs.worker.rendering_the_mix
                ? <Status kind="working">Working through your current mix</Status>
                : left
                  ? <Status kind="queued">{left} transition{left === 1 ? '' : 's'} in line</Status>
                  : <Status kind="ready">Your current mix is done</Status>}
        </li>
        {flagOn('render_line') && <li>
          <b>Drafts in the render line</b>
          {jobs.drafts_in_line ? <Status kind="queued">{jobs.drafts_in_line} waiting</Status> : <Status kind="planned">None</Status>}
          {jobs.drafts_in_line > 0 && <PageLink to="/mixes/mine">Change the order</PageLink>}
        </li>}
        <li>
          <b>Analysis</b>
          {jobs.analysis.left === 0
            ? <Status kind="ready">All done</Status>
            : jobs.analysis.running
              ? <Status kind={status.mix_rendering ? 'queued' : 'working'}>{status.mix_rendering ? 'Waiting while your mix renders' : `${jobs.analysis.left} to go`}</Status>
              : jobs.analysis.paused
                ? <Status kind="paused">Paused, {jobs.analysis.left} to go</Status>
                : <Status kind="planned">{jobs.analysis.left} waiting</Status>}
        </li>
        {flagOn('render.spare_time') && <li>
          <b>Spare time</b>
          <Status kind="planned">Trying out the best transitions across your library, once everything above is done{status.transitions_ready ? `. ${status.transitions_ready} clean so far` : ''}</Status>
        </li>}
      </ul>
      {jobs.storage_full && <p className="hint">Rendering waits until there’s room. <LinkIfThere to="/workshop/storage">Change the limit</LinkIfThere>.</p>}
      {!!jobs.failed_seams.length && (
        <>
          <h3>Transitions that couldn’t be made</h3>
          <ul className="job-failures">
            {jobs.failed_seams.map((seam) => <li key={`${seam.from}-${seam.to}`}><Status kind="failed">{seam.from} into {seam.to}</Status>{seam.why ? <small className="hint"> {seam.why}</small> : null}</li>)}
          </ul>
          <LinkIfThere to="/mix/current/edit">Choose another move for them</LinkIfThere>
        </>
      )}
      {!!jobs.failed_songs.length && (
        <>
          <h3>Songs that couldn’t be analysed</h3>
          <ul className="job-failures">
            {jobs.failed_songs.map((song) => <li key={song.id}><Status kind="failed">{song.title ?? 'Untitled'}</Status></li>)}
          </ul>
          <PageLink to="/library?show=attention">See them in your library</PageLink>
        </>
      )}
      {flagOn('analysis.time_estimates') && <p className="hint">{jobs.estimates}</p>}
    </section>
  );
}

/** Whether a folder would work, or null if this server can't say, which isn't a reason to stop. */
async function checkFolder(folder: string): Promise<FolderCheck | null> {
  try {
    return await get<FolderCheck>(`/folders/check?path=${encodeURIComponent(folder)}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) return null;
    throw error;
  }
}

type RelinkPreview = {
  from: string;
  to: string;
  total: number;
  verified: number;
  blocked: number;
  token: string | null;
  candidates: { id: number; title: string | null; artist: string | null; status: string }[];
};

export function FoldersPanel({ status, refreshStatus, notify }: Pick<ViewProps, 'status' | 'refreshStatus' | 'notify'>) {
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState('');
  const [list, setList] = useState<Folders | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmUnwatch, setConfirmUnwatch] = useState<string | null>(null);
  const [relocate, setRelocate] = useState<{ old: string; target: string } | null>(null);
  const [relocation, setRelocation] = useState<RelinkPreview | null>(null);
  const [relinkProblem, setRelinkProblem] = useState('');
  const [checkingRelink, setCheckingRelink] = useState(false);
  const previewRelink = async () => {
    if (!relocate?.target.trim()) return;
    setCheckingRelink(true);
    setRelinkProblem('');
    setRelocation(null);
    try {
      setRelocation(await post<RelinkPreview>('/folders/relink/preview', {
        old: relocate.old, new: relocate.target.trim(),
      }));
    } catch (error) {
      setRelinkProblem((error as Error).message);
    } finally {
      setCheckingRelink(false);
    }
  };
  const confirmRelink = async () => {
    if (!relocate || !relocation?.token) return;
    try {
      await post('/folders/relink', { old: relocate.old, new: relocate.target.trim(), token: relocation.token });
      setRelocate(null);
      setRelocation(null);
      void refresh();
      refreshStatus();
      notify('Verified folder re-linked. Your recordings and song IDs have not been changed.');
    } catch (error) {
      setRelocation(null);
      setRelinkProblem((error as Error).message);
    }
  };
  const scanPending = useRef(false);
  const scanning = status.scan.status === 'running';
  const reading = scanning || submitting;
  const refresh = useCallback(() => get<Folders>('/folders').then((value) => { setList(value); setLoadFailed(false); }).catch(() => setLoadFailed(true)), []);
  useEffect(() => {
    void refresh();
  }, [refresh, status.scan.status]);
  const checkNow = async () => {
    const { new: found } = await post<{ new: number }>('/library/check');
    refreshStatus();
    notify(found ? `Found ${found} new ${found === 1 ? 'song' : 'songs'}. Analysing them now.` : 'No new songs yet. Anything still copying in is checked again shortly.');
  };
  const scan = async (event: FormEvent) => {
    event.preventDefault();
    if (scanPending.current || reading || !folder.trim()) return;
    scanPending.current = true;
    setSubmitting(true);
    setProblem('');
    try {
      // File Explorer wraps some copied paths in matching quotes.
      const address = folder.trim().replace(/^(["'])(.*)\1$/u, '$2').trim();
      const check = await checkFolder(address);
      if (check && !check.ok) {
        setProblem(check.reason);
        return;
      }
      await post('/scan', { folder: address });
      setFolder('');
      refreshStatus();
    } catch (error) {
      setProblem((error as Error).message);
    } finally { scanPending.current = false; setSubmitting(false); }
  };
  const stopWatching = async (path: string) => {
    setList(await post<Folders>('/folders/stop-watching', { folder: path }));
    setConfirmUnwatch(null);
    notify('Stopped watching that folder. Nothing in it was touched, and its songs are still in your library.');
  };
  const stopReading = async () => {
    await post('/scan/cancel');
    refreshStatus();
  };
  return (
    <section className="panel stack">
      <h2>Your music folders</h2>
      {loadFailed && <Problem retry={refresh}>Couldn’t read your watched folders.</Problem>}
      {list === null && !loadFailed && <Skeleton variant="metrics" lines={1} label="Looking at your folders" />}
      {list?.folders.length === 0 && <p className="hint">No folders are being watched. Add one below and new songs in it will show up by themselves.</p>}
      {!!list?.folders.length && (
        <ul className="folder-list">
          {list.folders.map((item) => (
            <li key={item.path}>
              <div>
                <b>{item.path}</b>
                <small className="hint"> {item.songs} song{item.songs === 1 ? '' : 's'}</small>
              </div>
              {item.available ? <Status kind="ready">Watching</Status> : <Status kind="warning">Can’t find it right now. Its songs are kept until it’s back.</Status>}
              {!item.available && <button onClick={() => {
                setRelocate({ old: item.path, target: '' });
                setRelocation(null);
                setRelinkProblem('');
              }}>Find moved folder</button>}
              <button onClick={() => setConfirmUnwatch(item.path)}>Stop watching</button>
            </li>
          ))}
        </ul>
      )}
      {confirmUnwatch && (
        <Dialog title="Stop watching this folder?" onClose={() => setConfirmUnwatch(null)} footer={(
          <>
            <button onClick={() => setConfirmUnwatch(null)}>Keep watching</button>
            <Action className="primary" working="Stopping…" run={() => stopWatching(confirmUnwatch)}>Stop watching</Action>
          </>
        )}>
          <p>Stop automatically checking <b>{confirmUnwatch}</b> for new music?</p>
          <p className="hint">This never deletes, moves or changes files. Songs already in your Library stay there. You can add this folder again later.</p>
        </Dialog>
      )}
      {relocate && (
        <Dialog title="Re-link a moved music folder" onClose={() => { setRelocate(null); setRelocation(null); }}
          footer={<>
            <button onClick={() => { setRelocate(null); setRelocation(null); }}>Cancel - keep original paths</button>
            {relocation?.token && <Action className="primary" working="Re-linking…" run={confirmRelink}>Confirm {relocation.verified} verified songs</Action>}
          </>}>
          <p>This only changes the recorded locations of songs from <b>{relocate.old}</b>. It never moves or modifies audio files. All recordings must match their original relative path, size, duration, title and artist.</p>
          <Field label="New local folder address" error={relinkProblem}>
            {(field) => <input {...field} value={relocate.target} onChange={(event) => {
              setRelocate({ ...relocate, target: event.target.value });
              setRelocation(null);
              setRelinkProblem('');
            }} placeholder="Absolute path of the moved folder" />}
          </Field>
          <Action working="Checking recordings…" disabled={checkingRelink || !relocate.target.trim()} run={previewRelink}>Preview without changing anything</Action>
          {relocation && <>
            <p role="status">{relocation.verified} of {relocation.total} songs verified; {relocation.blocked} blocked.</p>
            {!!relocation.blocked && <p className="warn">No paths will change. Every song must pass verification. Check that the correct folder is selected.</p>}
            {!!relocation.blocked && <ul>{relocation.candidates.filter((item) => item.status !== 'verified').slice(0, 12).map((item) =>
              <li key={item.id}>{item.title ?? 'Untitled'} (ID {item.id}): {item.status.replaceAll('_', ' ')}</li>
            )}</ul>}
            {relocation.token && <p className="hint">Confirm only if this is the same recording collection. Exact song identities, ratings, drafts and analysis will be retained.</p>}
          </>}
        </Dialog>
      )}
      <div className="row wrap">
        <span className="hint">New songs added to these show up by themselves within a minute or so. Selecta never changes or deletes your files.</span>
        <Action working="Checking…" run={checkNow}>Check now</Action>
      </div>
      <h3>Add another folder</h3>
      <p className="hint">{words().sourcesHelp}</p>
      <p className="hint">Example folder paths: Windows <code>C:\\Users\\you\\Music</code>; macOS <code>/Users/you/Music</code>; Linux <code>/home/you/Music</code>. Use a path on the computer running Selecta, not a website address.</p>
      <form className="row wrap sources-add" onSubmit={(event) => void scan(event)}>
        <Field label="Music folder" error={problem}>
          {(field) => (
            <input
              {...field}
              value={folder}
              onChange={(event) => { setFolder(event.target.value); setProblem(''); }}
              placeholder="C:\\Users\\you\\Music"
            />
          )}
        </Field>
        {/* MP-0297-04: both labels share one cell, so Reading… never changes the button's width */}
        <button disabled={!folder.trim() || reading} data-working={reading || undefined} aria-busy={reading || undefined}>
          <span className="action-labels">
            <span aria-hidden={reading || undefined} style={{ visibility: reading ? 'hidden' : undefined }}>Read folder</span>
            <span aria-hidden={!reading || undefined} style={{ visibility: reading ? undefined : 'hidden' }}>Reading…</span>
          </span>
        </button>
        {scanning && <Action working="Stopping…" run={stopReading}>Stop reading</Action>}
      </form>
      {scanning && <p className="hint" role="status">Reading {status.scan.folder}. You can stop this and nothing already in your library changes.</p>}
      {status.scan.status === 'done' && (
        <p className="hint">Read {status.scan.folder}: {status.scan.music} songs, {status.scan.set_aside} set aside. Analysing them now.</p>
      )}
      {status.scan.status === 'cancelled' && <p className="hint" role="status">Stopped reading {status.scan.folder}. Nothing in your library changed. Read it again whenever you like.</p>}
      {status.scan.status === 'failed' && <p className="warn" role="alert">{status.scan.error}</p>}
    </section>
  );
}

/** Each one in a sentence, before the raw details, and only the things that have an answer. */
function diagnosticFacts(info: Record<string, unknown>): { key: string; words: string; kind: 'ready' | 'warning' | 'planned' }[] {
  const facts: { key: string; words: string; kind: 'ready' | 'warning' | 'planned' }[] = [];
  if (typeof info.worker_running === 'boolean') {
    facts.push(info.worker_running
      ? { key: 'worker', words: 'The rendering worker is running.', kind: 'ready' }
      : { key: 'worker', words: 'The rendering worker isn’t running. It starts by itself when there’s something to do.', kind: 'planned' });
  }
  if (typeof info.analysis_failures === 'number') {
    facts.push(info.analysis_failures
      ? { key: 'failures', words: `${info.analysis_failures} song${info.analysis_failures === 1 ? '' : 's'} couldn’t be analysed.`, kind: 'warning' }
      : { key: 'failures', words: 'No songs have failed analysis.', kind: 'ready' });
  }
  if (typeof info.mix_songs === 'number') facts.push({ key: 'mix', words: `Your current mix has ${info.mix_songs} song${info.mix_songs === 1 ? '' : 's'}.`, kind: 'planned' });
  if (typeof info.drafts_in_line === 'number') facts.push({ key: 'line', words: `${info.drafts_in_line} draft${info.drafts_in_line === 1 ? ' is' : 's are'} in the render line.`, kind: 'planned' });
  return facts;
}

/** The diagnostics endpoint promises no song names or paths. Older/newer
 * servers can add fields, so copying an unchecked response would silently
 * break that promise. Keep an explicit privacy-safe client contract too. */
export function safeDiagnostics(info: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    'api_version', 'analysis_version', 'python', 'platform',
    'worker_running', 'analysis_failures', 'mix_songs',
    'drafts_in_line', 'seam_records', 'typical_estimate_miss',
  ] as const;
  const safe: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = info[key];
    if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
      || typeof value === 'string' && /^[a-zA-Z0-9_.+-]{1,40}$/.test(value)) {
      safe[key] = value;
    }
  }
  if (info.songs && typeof info.songs === 'object' && !Array.isArray(info.songs)) {
    const counts = info.songs as Record<string, unknown>;
    const selected: Record<string, number> = {};
    for (const key of ['total', 'music', 'analysed', 'lyrics', 'ready', 'set_aside']) {
      const count = counts[key];
      if (typeof count === 'number' && Number.isFinite(count)) selected[key] = count;
    }
    safe.songs = selected;
  }
  if (Array.isArray(info.recent_operations)) {
    safe.recent_operations = info.recent_operations.slice(-20).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const operation = item as Record<string, unknown>;
      return [{
        kind: typeof operation.kind === 'string' && /^[a-z]{1,32}$/.test(operation.kind) ? operation.kind : 'other',
        ...(typeof operation.status === 'number' && Number.isInteger(operation.status) ? { status: operation.status } : {}),
        repeat: operation.repeat === true,
        // T0244: the page's random operation id, so a failed request can be matched to its outcome
        ...(typeof operation.operation === 'string' && /^[a-z]{1,32}-[A-Za-z0-9-]{1,96}$/.test(operation.operation) ? { operation: operation.operation } : {}),
      }];
    });
  }
  return safe;
}

/** What's useful for working out a problem, with no paths or song names. It stays here unless you
 * copy it somewhere yourself. */
export function Diagnostics() {
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => get<Record<string, unknown>>('/diagnostics').then((next) => {
    setInfo(next);
    setFailed(false);
  }).catch(() => setFailed(true)), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed) return <Problem retry={load}>The server isn’t answering, which is the first thing to look at. Is Selecta still running?</Problem>;
  if (!info) return <Skeleton variant="metrics" label="Gathering details" />;
  const text = JSON.stringify(safeDiagnostics(info), null, 2);
  const canCopy = typeof navigator.clipboard?.writeText === 'function';
  return (
    <section className="panel stack">
      <h2>Diagnostics</h2>
      <ul className="diagnostic-facts">
        {diagnosticFacts(info).map((fact) => <li key={fact.key}><Status kind={fact.kind}>{fact.words}</Status></li>)}
      </ul>
      <p className="hint">{words().diagnosticsStaysHere}</p>
      <details className="diagnostic-raw">
        <summary>The raw details</summary>
        <pre className="diagnostics" tabIndex={0}>{text}</pre>
      </details>
      <div className="row wrap">
        {canCopy && (
          <Action run={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}>
            {copied ? 'Copied' : 'Copy'}
          </Action>
        )}
        <Action run={load}>Check again</Action>
      </div>
    </section>
  );
}
