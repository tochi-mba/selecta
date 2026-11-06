import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Folders, get, Jobs, post, Storage } from '../api';
import { analysisWords, estimateWords, etaRangeWords, gb, storageWords } from '../lib';
import type { WorkshopTab } from '../router';
import { PageLink } from '../shell/Shell';
import { Action, Problem, Skeleton, Status, StatusKind } from '../ui/controls';
import { ViewProps } from './shared';
import { Listening } from './Listening';

const GB = 1024 ** 3;

/** The limit moves the moment the slider does. Saving waits until the slider stops. */
type Memory = { tried: number; clean: number; warned: number; failed: number; liked: number; disliked: number };

/** What Selecta has learned from rendering, so it's clear why mixes get better as it goes. */
function MemoryPanel() {
  const [memory, setMemory] = useState<Memory | null>(null);
  useEffect(() => {
    get<Memory>('/memory').then(setMemory).catch(() => {});
  }, []);
  if (!memory?.tried) return null;
  const rated = memory.liked + memory.disliked;
  return (
    <section className="panel stack">
      <h2>What it’s learned</h2>
      <p>
        Selecta remembers {memory.tried} hand-over{memory.tried === 1 ? '' : 's'} it has tried: {memory.clean} came out clean,{' '}
        {memory.warned} with a warning, and {memory.failed} that can’t work.
        {rated > 0 && ` You’ve rated ${rated}.`} Mixes and suggestions use all of this, and it stays even when old seams are cleared to save space.
      </p>
    </section>
  );
}

function StoragePanel() {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const wait = useRef<number | undefined>(undefined);
  const saves = useRef(0);
  const [saved, setSaved] = useState(true);
  const [problem, setProblem] = useState('');

  const refresh = () =>
    get<Storage>('/storage').then((data) => {
      setStorage(data);
      setLimit((current) => current ?? data.budget_bytes / GB);
    });
  useEffect(() => {
    void refresh().catch(() => {});
    const timer = window.setInterval(() => void refresh().catch(() => {}), 15000);
    return () => window.clearInterval(timer);
  }, []);

  if (!storage || limit === null) return <Skeleton label="Working out how much room there is" />;
  const words = storageWords(storage);
  const overBudget = storage.cache_bytes > storage.budget_bytes;
  const largest = Math.max(storage.largest_budget_bytes / GB, 0.5);
  const smallest = storage.smallest_budget_bytes / GB;

  const move = (value: number) => {
    setLimit(value);
    setSaved(false);
    window.clearTimeout(wait.current);
    wait.current = window.setTimeout(() => {
      saves.current += 1;
      const mine = saves.current;
      void post<Storage>('/storage', { budget_gb: value })
        .then((confirmed) => {
          // only the last one moved counts, and it shows what was really saved
          if (mine !== saves.current) return;
          setStorage(confirmed);
          setLimit(confirmed.budget_bytes / GB);
          setSaved(true);
        })
        .catch((error: Error) => { if (mine === saves.current) setProblem(error.message); });
    }, 400);
  };

  const total = storage.used_bytes + storage.free_bytes;
  return (
    <section className="panel stack">
      <h2>Storage</h2>
      <p>{words.summary}</p>
      <div className="bar-meter" role="img" aria-label={words.summary}>
        <i className="kept" style={{ width: `${(100 * storage.kept_bytes) / total}%` }} />
        <i className="cache" style={{ width: `${(100 * storage.cache_bytes) / total}%` }} />
      </div>
      <p className="hint">{words.detail}</p>
      <dl className="song-facts">
        <div><dt>Kept for mixes</dt><dd>{gb(storage.cache_bytes)} of {gb(storage.budget_bytes)} allowed</dd></div>
        <div><dt>Everything else Selecta keeps</dt><dd>{gb(storage.kept_bytes)}</dd></div>
        <div><dt>Free on this drive</dt><dd>{gb(storage.free_bytes)}</dd></div>
      </dl>
      <label className="limit">
        <span>
          Keep up to <b>{limit.toFixed(1)} GB</b> of vocals and seams
        </span>
        <input
          type="range"
          min={smallest}
          max={largest}
          step={0.1}
          value={Math.min(limit, largest)}
          onChange={(event) => move(Number(event.target.value))}
        />
      </label>
      {!saved && <p className="hint" role="status">Saving…</p>}
      {problem && <p className="warn" role="alert">{problem}</p>}
      <p className="hint">
        {overBudget
          ? 'Priority-song stem windows are protected, so they can temporarily put the cache over its limit. Lower a song’s priority to make its windows eligible for removal.'
          : 'When it’s full, Selecta removes the oldest cache items that are not protected by song priority. It makes them again if needed.'}{' '}
        It always leaves at least 2 GB free. Your music is never touched. The most it can use right now is {gb(storage.largest_budget_bytes)}.
      </p>
    </section>
  );
}

/** What's actually going on in the background, from what's actually there. */
function JobsPanel({ status }: { status: ViewProps['status'] }) {
  const [jobs, setJobs] = useState<Jobs | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => get<Jobs>('/jobs').then((next) => {
    setJobs(next);
    setFailed(false);
  }).catch(() => setFailed(true)), []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  if (!jobs) return failed ? <Problem retry={refresh}>Couldn’t find out what’s running.</Problem> : <Skeleton label="Finding out what’s running" />;
  const left = jobs.mix.queued + jobs.mix.rendering + jobs.mix.none;
  return (
    <section className="panel stack">
      <h2>What’s happening now</h2>
      <ul className="job-list">
        <li>
          <b>Rendering</b>
          {!jobs.worker.running
            ? <Status kind="unavailable">Not started. It starts by itself when there’s something to do.</Status>
            : jobs.storage_full
              ? <Status kind="needs-action">Paused: the storage limit has been reached</Status>
              : jobs.mix.rendering || jobs.worker.rendering_the_mix
                ? <Status kind="working">Working through your current mix</Status>
                : left
                  ? <Status kind="queued">{left} transition{left === 1 ? '' : 's'} in line</Status>
                  : <Status kind="ready">Your current mix is done</Status>}
        </li>
        <li>
          <b>Drafts in the render line</b>
          {jobs.drafts_in_line ? <Status kind="queued">{jobs.drafts_in_line} waiting</Status> : <Status kind="planned">None</Status>}
          {jobs.drafts_in_line > 0 && <PageLink to="/mixes/mine">Change the order</PageLink>}
        </li>
        <li>
          <b>Analysis</b>
          {jobs.analysis.left === 0
            ? <Status kind="ready">All done</Status>
            : jobs.analysis.running
              ? <Status kind={status.mix_rendering ? 'queued' : 'working'}>{status.mix_rendering ? 'Waiting while your mix renders' : `${jobs.analysis.left} to go`}</Status>
              : jobs.analysis.paused
                ? <Status kind="planned">Paused, {jobs.analysis.left} to go</Status>
                : <Status kind="planned">{jobs.analysis.left} waiting</Status>}
        </li>
        <li>
          <b>Spare time</b>
          <Status kind="planned">Trying out the best transitions across your library, once everything above is done{status.transitions_ready ? `. ${status.transitions_ready} clean so far` : ''}</Status>
        </li>
      </ul>
      {jobs.storage_full && <p className="hint">Rendering waits until there’s room. <PageLink to="/workshop/storage">Change the limit</PageLink>.</p>}
      {!!jobs.failed_seams.length && (
        <>
          <h3>Transitions that couldn’t be made</h3>
          <ul className="job-failures">
            {jobs.failed_seams.map((seam) => <li key={`${seam.from}-${seam.to}`}><Status kind="failed">{seam.from} into {seam.to}</Status>{seam.why ? <small className="hint"> {seam.why}</small> : null}</li>)}
          </ul>
          <PageLink to="/mix/current/edit">Choose another move for them</PageLink>
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
      <p className="hint">{jobs.estimates}</p>
    </section>
  );
}

function FoldersPanel({ status, refreshStatus, notify }: Pick<ViewProps, 'status' | 'refreshStatus' | 'notify'>) {
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState('');
  const [list, setList] = useState<Folders | null>(null);
  const reading = status.scan.status === 'running';
  const refresh = useCallback(() => get<Folders>('/folders').then(setList).catch(() => {}), []);
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
    setProblem('');
    try {
      await post('/scan', { folder });
      setFolder('');
      refreshStatus();
    } catch (error) {
      setProblem((error as Error).message);
    }
  };
  const stopWatching = async (path: string) => {
    setList(await post<Folders>('/folders/stop-watching', { folder: path }));
    notify('Stopped watching that folder. Nothing in it was touched, and its songs are still in your library.');
  };
  return (
    <section className="panel stack">
      <h2>Your music folders</h2>
      {list === null && <Skeleton lines={1} label="Looking at your folders" />}
      {!!list?.folders.length && (
        <ul className="folder-list">
          {list.folders.map((item) => (
            <li key={item.path}>
              <div>
                <b>{item.path}</b>
                <small className="hint"> {item.songs} song{item.songs === 1 ? '' : 's'}</small>
              </div>
              {item.available ? <Status kind="ready">Watching</Status> : <Status kind="warning">Can’t find it right now. Its songs are kept until it’s back.</Status>}
              <Action run={() => stopWatching(item.path)}>Stop watching</Action>
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        <span className="hint">New songs added to these show up by themselves within a minute or so. Selecta never changes or deletes your files.</span>
        <Action working="Checking…" run={checkNow}>Check now</Action>
      </div>
      <h3>Add another folder</h3>
      <form className="row" onSubmit={(event) => void scan(event)}>
        <input
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          placeholder="C:\\Users\\you\\Music"
          aria-label="Music folder"
        />
        <button disabled={!folder.trim() || reading} data-working={reading || undefined}>{reading ? 'Reading…' : 'Read folder'}</button>
      </form>
      {problem && <p className="warn" role="alert">{problem}</p>}
      {status.scan.status === 'done' && (
        <p className="hint">Read {status.scan.folder}: {status.scan.music} songs, {status.scan.set_aside} set aside. Analysing them now.</p>
      )}
      {status.scan.status === 'failed' && <p className="warn" role="alert">{status.scan.error}</p>}
    </section>
  );
}

/** What's useful for working out a problem, with no paths or song names. It stays here unless you
 * copy it somewhere yourself. */
function Diagnostics() {
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
  if (!info) return <Skeleton label="Gathering details" />;
  const text = JSON.stringify(info, null, 2);
  const canCopy = typeof navigator.clipboard?.writeText === 'function';
  return (
    <section className="panel stack">
      <h2>Diagnostics</h2>
      <p className="hint">No paths or song names, and nothing is sent anywhere. It only leaves this PC if you copy it somewhere yourself.</p>
      <pre className="diagnostics">{text}</pre>
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

/** Every state a control can be in, in whichever theme this is, for checking the look in one place. */
function ControlStates() {
  const kinds: StatusKind[] = ['planned', 'queued', 'working', 'ready', 'warning', 'failed', 'needs-action', 'unavailable'];
  return (
    <details className="panel">
      <summary>Control states, for checking how things look</summary>
      <div className="row wrap gallery">
        <button>Default</button>
        <button className="primary">Primary</button>
        <button disabled>Disabled</button>
        <button aria-pressed="true">Pressed</button>
        <button data-working aria-busy="true">Working</button>
        <PageLink to="/workshop/diagnostics" className="button">Link as a button</PageLink>
      </div>
      <div className="row wrap gallery">
        {kinds.map((kind) => <Status key={kind} kind={kind} />)}
      </div>
      <Skeleton lines={2} label="Example of loading" />
      <Problem retry={() => {}}>An example of something that couldn’t be loaded.</Problem>
    </details>
  );
}

const SECTIONS: { tab: WorkshopTab; label: string; path: string }[] = [
  { tab: 'overview', label: 'Overview', path: '/workshop' },
  { tab: 'analysis', label: 'Analysis', path: '/workshop/analysis' },
  { tab: 'storage', label: 'Storage', path: '/workshop/storage' },
  { tab: 'sources', label: 'Sources', path: '/workshop/sources' },
  { tab: 'learning', label: 'Learning', path: '/workshop/learning' },
  { tab: 'diagnostics', label: 'Diagnostics', path: '/workshop/diagnostics' },
];

export function Workshop({ status, refreshStatus, notify, tab = 'overview' }: ViewProps & { tab?: WorkshopTab }) {
  const { counts } = status;
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);

  const toggle = async () => {
    await post(status.analysis_running ? '/analysis/stop' : '/analysis/start');
    refreshStatus();
    notify(status.analysis_running ? 'Paused. It’ll pick up where it left off.' : 'Analysing in the background.');
  };

  return (
    <main className="page" id="main">
      <h1 className="display small">Workshop</h1>
      <nav className="tabs" aria-label="Workshop">
        {SECTIONS.map((section) => (
          <PageLink key={section.tab} to={section.path} aria-current={tab === section.tab ? 'page' : undefined}>{section.label}</PageLink>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <div className="metrics">
            <div><strong>{counts.ready ?? 0}</strong><span>ready for mixes</span></div>
            <div><strong>{counts.analysed}</strong><span>audio analysed</span></div>
            <div><strong>{left}</strong><span>still to analyse</span></div>
            <div><strong>{counts.lyrics}</strong><span>with timed lyrics</span></div>
            <div><strong>{counts.set_aside}</strong><span>set aside as not music</span></div>
          </div>
          <JobsPanel status={status} />
        </>
      )}

      {tab === 'analysis' && (
        <section className="panel stack">
          <h2>Analysis</h2>
          <p>
            {status.analysis_running
              ? status.mix_rendering
                ? `Waiting while ${status.mixes_in_line ? 'your mixes render' : 'your mix renders'}, then it carries on. ${left} to go, done in ${etaRangeWords(status.eta?.analysis)}.`
                : `Working through your songs at low priority, so you can keep using your PC. ${left} to go, done in ${etaRangeWords(status.eta?.analysis)}.`
              : left
                ? `${left} song${left === 1 ? '' : 's'} left. ${analysisWords(status.eta?.analysis)}`
                : `Audio analysis is complete. ${counts.ready ?? 0} songs currently have the cues Selecta needs to mix them.`}
          </p>
          {estimateWords(status.eta?.accuracy) && <p className="hint">{estimateWords(status.eta?.accuracy)}</p>}
          <p className="hint">
            With nothing else to do, Selecta tries out the best transitions across your library, so they’re ready when you want them.
            {status.transitions_ready ? ` ${status.transitions_ready} have come out clean so far.` : ''}
          </p>
          {left > 0 && (
            <div className="row wrap">
              <Action className={status.analysis_running ? '' : 'primary'} run={toggle}>
                {status.analysis_running ? 'Pause' : 'Analyse the rest'}
              </Action>
              <span className="hint">Safe to pause any time.</span>
            </div>
          )}
        </section>
      )}

      {tab === 'storage' && <StoragePanel />}
      {tab === 'sources' && <FoldersPanel status={status} refreshStatus={refreshStatus} notify={notify} />}
      {tab === 'learning' && (
        <>
          <MemoryPanel />
          <Listening />
        </>
      )}
      {tab === 'diagnostics' && <Diagnostics />}
      {tab === 'diagnostics' && <ControlStates />}
    </main>
  );
}
