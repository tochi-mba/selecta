import { useState } from 'react';
import type { ExportJob, ExportJobState } from '../api';
import { length } from '../lib';
import { LinkIfThere } from '../shell/PageLink';
import { Action, Skeleton, Status, StatusKind } from '../ui/controls';
import { cancelExport, isExportActive, refreshExports, useExports } from './exportStore';
import { words } from '../copy';

const STATES: Record<ExportJobState, { kind: StatusKind; words: string }> = {
  preparing: { kind: 'working', words: 'Preparing transitions' },
  encoding: { kind: 'working', words: 'Creating the FLAC file' },
  ready: { kind: 'ready', words: 'Ready to download' },
  failed: { kind: 'failed', words: 'Didn’t work' },
  cancelling: { kind: 'working', words: 'Cancelling' },
  cancelled: { kind: 'unavailable', words: 'Cancelled' },
  interrupted: { kind: 'failed', words: 'Interrupted' },
  expired: { kind: 'unavailable', words: 'The file has gone' },
};

const UNKNOWN = { kind: 'unavailable' as StatusKind, words: 'State unknown' };

export function exportStage(job: Pick<ExportJob, 'state'>) {
  return STATES[job.state] ?? UNKNOWN;
}

/** Which version this is: enough to tell two exports of the same mix apart. */
function snapshotWords(job: ExportJob): string {
  const scope = job.scope === 'draft' ? 'draft' : 'current mix';
  const first = job.songs[0]?.title;
  const last = job.songs[job.songs.length - 1]?.title;
  const when = new Date(job.created_at * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const identity = job.scope === 'draft' && job.draft !== null ? `, draft ${job.draft}` : '';
  return `${scope}${identity}, ${job.songs.length} songs${first && last ? `, ${first} to ${last}` : ''}${job.revision ? `, revision ${job.revision}` : ''}. Started ${when}.`;
}

function Row({ job }: { job: ExportJob }) {
  const stage = exportStage(job);
  const editor = job.scope === 'draft' && job.draft !== null ? `/mixes/drafts/${job.draft}/edit` : '/mix/current/edit';
  const needsAnother = ['failed', 'interrupted', 'expired', 'cancelled'].includes(job.state);
  return (
    <li className="export-job" data-state={job.state}>
      <div className="export-job-name">
        <b>{job.mix_name}</b>
        <small className="soft">{snapshotWords(job)}</small>
      </div>
      <Status kind={stage.kind}>
        {stage.words}
        {job.state === 'preparing' ? `, ${job.seams_ready} of ${job.seams_total} ready` : ''}
      </Status>
      {job.state === 'preparing' && job.quiet_seconds > 600 && <p><Status kind="blocked">Nothing has finished for a while. Rendering may be waiting on your current mix or on storage room.</Status></p>}
      {job.error && <p className="warn">{job.error}</p>}
      <details className="export-snapshot">
        <summary>View frozen export contents ({job.songs.length} songs, {job.seams.length} transitions)</summary>
        <p className="hint">
          {job.scope === 'draft' ? `Draft ${job.draft ?? 'unknown'}` : 'Current mix'} when saved.
          {job.revision ? ` Revision ${job.revision}.` : ' This older job has no revision identifier.'}
          {' '}Approximate source duration {length(job.seconds_estimate)}.
        </p>
        <ol className="export-snapshot-songs">
          {job.songs.map((song, index) => <li key={index}><b>{song.title || 'Untitled'}</b> - {song.artist || 'Unknown artist'} <small>(song {song.song_id})</small></li>)}
        </ol>
        {!!job.seams.length && (
          <ul className="export-snapshot-seams">
            {job.seams.map((seam, index) => <li key={index}>{seam.from} into {seam.to} - transition <code>{seam.key}</code></li>)}
          </ul>
        )}
      </details>
      {/* MP-0294-02/04: why the file has gone sits with its recovery, under the contents, so the
          contents summary holds the same place in every state */}
      {job.state === 'expired' && <p className="hint">The file isn’t in Selecta’s exports folder any more, so it can’t be downloaded.</p>}
      <div className="row wrap export-job-actions">
        {job.state === 'ready' && <a href={`/api/exports/${encodeURIComponent(job.name)}`} download>download {job.name}</a>}
        {job.state === 'ready' && job.seconds != null && <small className="soft">{length(job.seconds)} long</small>}
        {job.can_cancel && <Action working="Cancelling…" aria-label={`Cancel the export of ${job.mix_name}`} run={() => cancelExport(job.id)}>Cancel export</Action>}
        {/* a new file is always someone's own choice, from the mix as it is by then */}
        {needsAnother && <LinkIfThere to={editor}>Open this mix to export it again</LinkIfThere>}
      </div>
    </li>
  );
}

/** The exports Selecta knows about, wherever they were started. Shown in Activity and in Workspace,
 * and in Workspace it also says so when there are none. */
export function ExportJobs({ always = false }: { always?: boolean }) {
  const { jobs, stale, unsupported } = useExports();
  const [shown, setShown] = useState(12);
  if (unsupported) {
    return always ? <section className="panel stack"><h2>Exports</h2><p className="hint">{words().exportsNeedRestart}</p></section> : null;
  }
  if (!jobs) {
    if (!always) return null;
    if (stale) return <section className="panel stack"><h2>Exports</h2><p className="warn">Couldn’t check on your exports.</p><Action run={refreshExports}>Try again</Action></section>;
    return <section className="panel stack"><h2>Exports</h2><Skeleton variant="metrics" lines={1} label="Looking for your exports" /></section>;
  }
  if (!jobs.length && !always) return null;
  const going = jobs.filter(isExportActive).length;
  return (
    <section className="panel stack exports-list" aria-label="Exports">
      <h2>Exports</h2>
      {stale && <p className="warn" role="status">Can’t check on these right now, so what’s shown may be out of date.</p>}
      {!jobs.length && <p className="hint">Nothing yet. Choose Download audio while editing a mix to save it as a FLAC file.</p>}
      {going > 0 && <p className="hint">These keep going if you close this or reload. Your mix always renders first.</p>}
      {!!jobs.length && <ul className="export-jobs">{jobs.slice(0, shown).map((job) => <Row key={job.id} job={job} />)}</ul>}
      {jobs.length > shown && (
        <button onClick={() => setShown((count) => count + 12)}>
          Show older exports ({jobs.length - shown} more)
        </button>
      )}
    </section>
  );
}
