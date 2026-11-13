import { useContext, useRef, useState } from 'react';
import { ApiError, ExportJob, get, MixData, MixItem } from '../api';
import { length, runningTime } from '../lib';
import { PageLink } from '../shell/PageLink';
import { Action, Dialog, Status } from '../ui/controls';
import { seamFacts } from '../ui/seam';
import { mixReadiness } from '../state/readiness';
import { cancelExport, isExportActive, startExport, useExports } from './exportStore';
import { exportStage } from './ExportJobs';
import { MixScope, useMixPath } from './mixScope';
import { words } from '../copy';

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
  const starting = useRef(false);
  const operation = useRef<string | null>(null);
  const seams = mix.slice(1);
  const readiness = mixReadiness(mix);
  const ready = readiness.ready;
  const left = seams.filter((item) => item.seam?.state.status !== 'ready' || item.seam?.too_soon);
  const blocked = readiness.blocked > 0;
  const scope = inDraft ? 'draft' : 'current';

  // what this opened to: the export just started here, or one of this very version from earlier
  const mine = jobs?.find((job) => job.id === started && job.scope === scope && job.draft === draftId)
    ?? jobs?.find((job) => job.scope === scope && job.draft === draftId && sameVersion(job, mix) && (isExportActive(job) || job.state === 'ready'));
  const going = !!mine && isExportActive(mine);
  const file = mine?.state === 'ready' ? mine : null;
  const changedSince = !!mine && !sameVersion(mine, mix);
  const stage = mine ? mine.state : null;

  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setProblem('');
    // Keep the same operation on a lost-response retry. A second submission
    // cannot silently create a second export of the same frozen mix.
    operation.current ??= `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const job = await startExport(at('/exports/jobs'), { ...guard, 'x-operation-id': operation.current });
      operation.current = null;
      setStarted(job.id);
      // the songs on the page show what's now in line
      get<MixData>(at('/mix')).then(setMixData).catch(() => {});
    } catch (error) {
      // The server answered a definitive client error. A future corrected
      // request is a new operation; only uncertain connection errors reuse it.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) operation.current = null;
      if (error instanceof ApiError && error.status === 404 && error.code === '') {
        setProblem(error.message === 'Not Found' ? words().exportNeedsRestart : error.message);
      } else {
        setProblem((error as Error).message);
      }
    } finally {
      starting.current = false;
    }
  };

  return (
    <Dialog title="Save as an audio file" onClose={onClose}>
      <p><b>{mixName}</b> <span className="soft">{inDraft ? 'draft' : 'current mix'}, {mix.length} songs, about {length(runningTime(mix))}. FLAC.</span></p>
      <p className="hint export-ends">
        {mix.length ? <>From <b dir="auto">{mix[0].title}</b> to <b dir="auto">{mix[mix.length - 1].title}</b>. </> : ''}
        Save captures exactly the songs and transitions shown for this {inDraft ? 'draft' : 'current mix'} at the moment you start. Later edits will not change the exported file.
      </p>
      {mine?.revision && <p className="hint">Frozen revision <code>{mine.revision}</code>. Use this ID to distinguish this file from later exports of the same mix.</p>}
      {/* once a job exists its frozen order opens by itself, so a reopened dialog shows what is being made (EX-0127-02) */}
      <details className="export-snapshot" open={mine ? true : undefined}>
        <summary>Review {mine ? 'frozen' : 'proposed'} order ({mine ? mine.songs.length : mix.length} songs)</summary>
        <p className="hint">{mine ? 'The original order below cannot be changed by editing the mix now.' : 'This order will be captured when Save it succeeds. It is not a finished file yet.'}</p>
        <ol className="export-snapshot-songs">
          {mine ? mine.songs.map((song, index) => (
            <li key={index}><b>{song.title || 'Untitled'}</b> - {song.artist || 'Unknown artist'} <small>(song {song.song_id})</small></li>
          )) : mix.map((song, index) => (
            <li key={index}><b>{song.title}</b> - {song.artist} <small>(song {song.song_id})</small></li>
          ))}
        </ol>
        {mine && !!mine.seams.length && (
          <ul className="export-snapshot-seams">
            {mine.seams.map((seam, index) => (
              <li key={index}>{seam.from} into {seam.to}: <code>{seam.key}</code></li>
            ))}
          </ul>
        )}
      </details>
      <ol className="export-stages" aria-label="Export progress">
        <li aria-current={!stage || stage === 'preparing' ? 'step' : undefined}>
          Prepare transitions{mine ? ` - ${mine.seams_ready} of ${mine.seams_total} ready` : ''}
        </li>
        <li aria-current={stage === 'encoding' ? 'step' : undefined}>Create the FLAC file</li>
        <li aria-current={file ? 'step' : undefined}>Download your mix</li>
      </ol>
      {mine && !file && <p role="status"><Status kind={exportStage(mine).kind}>{exportStage(mine).words}</Status></p>}
      {!mine && <p className="hint">{ready} of {seams.length} transitions ready. {left.length ? 'The rest get rendered first.' : 'Everything’s ready.'}</p>}
      {!mine && !!left.length && (
        // a list that can scroll must be reachable by keyboard to scroll it (axe scrollable-region-focusable)
        <ul className="export-left" tabIndex={0} aria-label="Transitions still to render">
          {left.slice(0, 8).map((item) => {
            const facts = seamFacts(item.seam, names);
            return <li key={item.position}><Status kind={facts.kind}>Into {item.title}: {facts.words}</Status></li>;
          })}
          {left.length > 8 && <li className="hint">and {left.length - 8} more</li>}
        </ul>
      )}
      {blocked && <p className="warn" role="alert">A transition would cut off the previous song before its handoff finishes. Adjust the transition timing in the editor before exporting this mix.</p>}
      {problem && <p className="warn" role="alert">{problem}</p>}
      {unsupported && !problem && <p className="warn">{words().exportNeedsRestart}</p>}
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
        <Action className="primary" disabled={going || mix.length < 2 || blocked} working="Starting export…" run={start}>
          {mine?.state === 'encoding' ? 'Saving the file…' : going ? `Rendering ${mine?.seams_ready} of ${mine?.seams_total}…` : 'Save it'}
        </Action>
      )}
      {mine?.can_cancel && <Action working="Cancelling…" run={() => cancelExport(mine.id)}>Cancel export</Action>}
      <p className="hint">Your original songs aren’t touched.</p>
      <p className="hint">You can close this and it keeps going. Find it again under Activity, or in <PageLink to="/workshop" onClick={onClose}>Workspace</PageLink>.</p>
    </Dialog>
  );
}
