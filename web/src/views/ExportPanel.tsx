import { useContext, useState } from 'react';
import { ApiError, ExportJob, get, MixData, MixItem } from '../api';
import { length, runningTime } from '../lib';
import { PageLink } from '../shell/PageLink';
import { Action, Dialog, Status } from '../ui/controls';
import { seamFacts } from '../ui/seam';
import { cancelExport, isExportActive, startExport, useExports } from './exportStore';
import { exportStage } from './ExportJobs';
import { MixScope, useMixPath } from './mixScope';

/** Is this job a file of the mix exactly as it is now? */
function sameVersion(job: ExportJob, mix: MixItem[]): boolean {
  const songs = job.songs.map((song) => song.song_id).join(',');
  const keys = job.seams.map((seam) => seam.key).join(',');
  return songs === mix.map((item) => item.song_id).join(',') && keys === mix.slice(1).map((item) => item.seam?.state.key).join(',');
}

/** Exactly which mix is being saved, what it's still waiting on, and the file once it really exists.
 * The server keeps working whether this stays open or not, and it saves the mix as it was when this
 * started, so changing the mix afterwards can't change what ends up in the file. */
export function ExportPanel(props: {
  mix: MixItem[];
  mixName: string;
  inDraft: boolean;
  guard: Record<string, string>;
  setMixData: (data: MixData) => void;
  names: Record<string, string>;
  onClose: () => void;
}) {
  const { mix, mixName, inDraft, guard, setMixData, names, onClose } = props;
  const at = useMixPath();
  const draftId = useContext(MixScope);
  const { jobs, unsupported } = useExports();
  const [started, setStarted] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const seams = mix.slice(1);
  const ready = seams.filter((item) => item.seam?.state.status === 'ready').length;
  const left = seams.filter((item) => item.seam?.state.status !== 'ready');
  const scope = inDraft ? 'draft' : 'current';

  // what this opened to: the export just started here, or one of this very version from earlier
  const mine = jobs?.find((job) => job.id === started && job.scope === scope && job.draft === draftId)
    ?? jobs?.find((job) => job.scope === scope && job.draft === draftId && sameVersion(job, mix) && (isExportActive(job) || job.state === 'ready'));
  const going = !!mine && isExportActive(mine);
  const file = mine?.state === 'ready' ? mine : null;
  const changedSince = !!mine && !sameVersion(mine, mix);
  const stage = mine ? mine.state : null;

  const start = async () => {
    setProblem('');
    try {
      const job = await startExport(at('/exports/jobs'), guard);
      setStarted(job.id);
      // the songs on the page show what's now in line
      get<MixData>(at('/mix')).then(setMixData).catch(() => {});
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && error.code === '') {
        setProblem(error.message === 'Not Found' ? 'This running copy of Selecta can’t do this yet. Restart Selecta, then try again.' : error.message);
      } else {
        setProblem((error as Error).message);
      }
    }
  };

  return (
    <Dialog title="Save as an audio file" onClose={onClose}>
      <p><b>{mixName}</b> <span className="soft">{inDraft ? 'draft' : 'current mix'}, {mix.length} songs, about {length(runningTime(mix))}. FLAC.</span></p>
      <p className="hint">
        {mix.length ? <>From <b>{mix[0].title}</b> to <b>{mix[mix.length - 1].title}</b>. </> : ''}
        Save captures exactly the songs and transitions shown for this {inDraft ? 'draft' : 'current mix'} at the moment you start. Later edits will not change the exported file.
      </p>
      <ol className="export-stages" aria-label="Export progress">
        <li aria-current={!stage || stage === 'preparing' ? 'step' : undefined}>
          Prepare transitions{mine ? ` — ${mine.seams_ready} of ${mine.seams_total} ready` : ''}
        </li>
        <li aria-current={stage === 'encoding' ? 'step' : undefined}>Create the FLAC file</li>
        <li aria-current={file ? 'step' : undefined}>Download your mix</li>
      </ol>
      {mine && !file && <p role="status"><Status kind={exportStage(mine).kind}>{exportStage(mine).words}</Status></p>}
      {!mine && <p className="hint">{ready} of {seams.length} transitions ready. {left.length ? 'The rest get rendered first.' : 'Everything’s ready.'}</p>}
      {!mine && !!left.length && (
        <ul className="export-left">
          {left.slice(0, 8).map((item) => {
            const facts = seamFacts(item.seam, names);
            return <li key={item.position}><Status kind={facts.kind}>Into {item.title}: {facts.words}</Status></li>;
          })}
          {left.length > 8 && <li className="hint">and {left.length - 8} more</li>}
        </ul>
      )}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {unsupported && !problem && <p className="warn">This running copy of Selecta can’t do this yet. Restart Selecta, then try again.</p>}
      {mine?.error && <p className="warn" role="alert">{mine.error}</p>}
      {changedSince && (
        <p className="hint" role="status">
          You’ve changed this mix since this started. This file keeps the mix as it was when you pressed Save it. Save it again for the new version.
        </p>
      )}
      {file && (
        <p className="notice" role="status">Ready{file.seconds != null ? `, ${length(file.seconds)} long` : ''}: <a href={`/api/exports/${encodeURIComponent(file.name)}`} download>download {file.name}</a></p>
      )}
      {(!file || changedSince) && (
        <button className="primary" disabled={going || mix.length < 2} data-working={going || undefined} onClick={() => void start()}>
          {mine?.state === 'encoding' ? 'Saving the file…' : going ? `Rendering ${mine?.seams_ready} of ${mine?.seams_total}…` : 'Save it'}
        </button>
      )}
      {mine?.can_cancel && <Action working="Cancelling…" run={() => cancelExport(mine.id)}>Cancel export</Action>}
      <p className="hint">Your original songs aren’t touched.</p>
      <p className="hint">You can close this and it keeps going. Find it again under Activity, or in <PageLink to="/workshop" onClick={onClose}>Workspace</PageLink>.</p>
    </Dialog>
  );
}
