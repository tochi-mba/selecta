import { flagOn } from '../flags';
import { LinkIfThere } from '../shell/PageLink';
import { post, Status } from '../api';
import { analysisWords } from '../lib';
import { PageLink } from '../shell/PageLink';
import { Action, Status as StatusMark } from '../ui/controls';
import { words } from '../copy';

/** Getting from nothing to a first mix takes three steps. Which one you're on comes from what the
 * server says is true, so it can't claim more than has happened. */

export type SetupStage = 'connect' | 'prepare' | 'listen';

const STAGES: { id: SetupStage; label: string }[] = [
  { id: 'connect', label: 'Connect music' },
  { id: 'prepare', label: 'Prepare library' },
  { id: 'listen', label: 'Start listening' },
];

export function SetupSteps({ stage }: { stage: SetupStage }) {
  const at = STAGES.findIndex((item) => item.id === stage);
  return (
    <ol className="setup-steps" aria-label="Getting started">
      {STAGES.map((item, index) => (
        <li key={item.id} className={index < at ? 'done' : undefined} aria-current={index === at ? 'step' : undefined}>
          {item.label}
          {index < at && <span className="visually-hidden"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}

const STARTED_KEY = 'selecta.startedAMix';

/** Once someone has played a mix they're past setup, so the steps don't come back after clearing one. */
export function hasStartedAMix(): boolean {
  try {
    return window.localStorage.getItem(STARTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberStartedAMix() {
  try {
    window.localStorage.setItem(STARTED_KEY, '1');
  } catch {
    // the steps may show once more than they need to
  }
}

export const READY_NEEDED = 6;

/** The second step. Songs found, songs analysed and songs that can really be mixed are three different
 * numbers, and only the last one counts towards a first mix. Every other page stays open meanwhile. */
export function Preparing({ status, onAnalyse }: { status: Status; onAnalyse: () => Promise<void> | void }) {
  const { counts, scan } = status;
  const ready = counts.ready ?? 0;
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const reading = scan.status === 'running';
  return (
    <main className="page setup" id="main">
      <SetupSteps stage="prepare" />
      <h1 className="display">Getting your songs ready.</h1>
      <p className="lede">
        {ready} of {counts.music} songs have the vocal or instrumental cues needed for mixes. Audio analysis is complete for {counts.analysed};
        {left > 0 ? ` ${left} still to analyse.` : ' there are no more songs waiting for audio analysis.'} You can use your PC as normal while this happens.
      </p>
      <ol className="readiness-steps" aria-label="Library preparation">
        <li><span>Music found</span><strong>{counts.music}</strong></li>
        <li><span>Audio analysed</span><strong>{counts.analysed}</strong></li>
        {flagOn('lyrics.lookup') && counts.lyrics !== undefined && <li><span>With timed lyrics</span><strong>{counts.lyrics}</strong></li>}
        <li><span>Ready for mixes</span><strong>{ready} / {READY_NEEDED} needed</strong></li>
      </ol>
      {reading && <p role="status"><StatusMark kind="working">Still reading your folder{scan.folder ? `: ${scan.folder}` : ''}</StatusMark></p>}
      {scan.status === 'failed' && <p className="warn" role="alert">{scan.error ?? 'Reading that folder didn’t finish.'} What was already found is kept.</p>}
      {scan.status === 'cancelled' && <p role="status" className="hint">Reading that folder was stopped. What was already found is kept, and you can read it again from Sources.</p>}
      {!left && ready < READY_NEEDED && (
        <p className="hint">Audio analysis is finished. More songs need {flagOn('lyrics.lookup') ? 'timed lyrics or instrumental cues' : 'clear beats and cues'} before they can mix. Open Library → Needs attention to see each song’s reason.</p>
      )}
      <details className="setup-explain">
        <summary>What’s happening to my songs?</summary>
        <dl>
          <div><dt>Audio analysis</dt><dd>{words().setupAnalysis} {left > 0 ? analysisWords(status.eta?.analysis) : ''}</dd></div>
          {flagOn('lyrics.lookup') && <div><dt>Lyrics</dt><dd>Artist, title, album and duration are sent to LRCLIB to find timed lyrics. Your audio stays here.</dd></div>}
          {flagOn('stems') && <div><dt>Stems</dt><dd>Separating voice, drums, bass and melody only happens later, for the transitions that need it.</dd></div>}
        </dl>
      </details>
      {flagOn('lucy') && <p className="hint">You can discuss an idea with Lucy while your library is being prepared. It won’t bypass song-readiness checks, send a request on its own, or start playback.</p>}
      <div className="row wrap">
        {ready >= READY_NEEDED && <PageLink to="/mixes" className="button primary">Make my first mix</PageLink>}
        <PageLink to="/library" className="button">Open Library</PageLink>
        <LinkIfThere to="/mixes/lucy" className="button">Plan with Lucy (optional)</LinkIfThere>
        {!status.analysis_running && <Action className="primary" run={onAnalyse}>Analyse my songs</Action>}
        {status.analysis_running && <span className="pill rendering">Analysing now</span>}
        <PageLink to="/workshop" className="button">See progress</PageLink>
        <LinkIfThere to="/workshop/sources" className="button">Add another folder</LinkIfThere>
      </div>
    </main>
  );
}

export const askToAnalyse = () => post('/analysis/start');
