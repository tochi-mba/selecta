import { flagOn, useFlags } from '../flags';
import { listed } from '../shell/manifest';
import { memo, useEffect, useState } from 'react';
import { Folders, get, post } from '../api';
import { refreshJobs, useJobsStatus } from '../state/jobs';
import { analysisWords, estimateWords, etaRangeWords } from '../lib';
import { useRoute, type WorkshopTab } from '../router';
import { workspaceTabs } from '../shell/manifest';
import { PageLink } from '../shell/PageLink';
import { ThemeChoices } from '../ui/ThemeChoice';
import { setPrefs, usePrefs } from '../state/prefs';
import { ControlGallery } from '../ui/ControlGallery';
import { keepFullMotion, useLowPower } from '../ui/lowPower';
import { Action, Skeleton, Status } from '../ui/controls';
import { LinkTabs } from '../ui/primitives';
import { ExportJobs } from './ExportJobs';
import { Listening } from './Listening';
import { LocalBackup } from './LocalBackup';
import { sameApartFromClock } from './clockMemo';
import { ViewProps } from './shared';
import { Diagnostics, FoldersPanel, JobsPanel, MemoryPanel, NeedsYou, StoragePanel } from './WorkshopPanels';
import { words } from '../copy';

/** How this looks and behaves in this browser. Nothing here touches music, mixes or the server, so
 * any of it can be switched back, including the older navigation if the new one ever gets in the way. */
function InterfaceChoices() {
  const preferences = usePrefs();
  const lowPower = useLowPower();
  return (
    <section className="panel stack interface-choices">
      <h2>Interface</h2>
      <p className="hint">These are kept in this browser. None of them change your music or your mixes.</p>
      {flagOn('app.theme_choice') && <ThemeChoices />}
      {flagOn('app.motion_choice') && (
      <fieldset className="theme-choices">
        <legend>Motion</legend>
        <div className="chips" role="radiogroup" aria-label="Motion">
          {(['still', 'subtle', 'expressive'] as const).map((motion) => (
            <label className="choice" key={motion}>
              <input type="radio" name="selecta-motion" checked={preferences.motion === motion} onChange={() => setPrefs({ motion })} />
              {motion === 'still' ? 'Still' : motion === 'subtle' ? 'Subtle' : 'Expressive'}
            </label>
          ))}
        </div>
        <p className="hint">Still stops decorative movement. Your computer’s reduced-motion setting always takes priority.</p>
        {lowPower && (
          <p className="hint" role="status">
            Movement is resting because this device was struggling to keep up. Nothing is hidden.{' '}
            <button type="button" className="quiet" onClick={keepFullMotion}>Use full motion here</button>
          </p>
        )}
      </fieldset>
      )}
      <label className="choice">
        <input type="checkbox" checked={preferences.density === 'compact'} onChange={(event) => setPrefs({ density: event.target.checked ? 'compact' : 'comfortable' })} />
        Compact rows in the {listed(['Library', flagOn('editor') && 'the timeline', flagOn('drafts') && 'drafts'])}
      </label>
      {flagOn('app.command_palette') && <label className="choice">
        <input type="checkbox" checked={preferences.palette} onChange={(event) => setPrefs({ palette: event.target.checked })} />
        Use Ctrl K for search and commands
      </label>}
      {flagOn('app.shortcuts') && <label className="choice">
        <input type="checkbox" checked={preferences.singleKeys} onChange={(event) => setPrefs({ singleKeys: event.target.checked })} />
        Single-key shortcuts such as N and M
      </label>}
      {flagOn('app.classic_nav') && <label className="choice">
        <input type="checkbox" checked={preferences.classicNav} onChange={(event) => setPrefs({ classicNav: event.target.checked })} />
        Use the older navigation: {flagOn('discover.word_links') || flagOn('discover.harmonic') ? 'Mixes, Discover and Workshop' : 'Mixes and Workshop'}
      </label>}
    </section>
  );
}

/** How much is ready, what's running, what's stuck and what needs someone, in that order. */
function Overview({ status }: { status: ViewProps['status'] }) {
  const { counts } = status;
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const { jobs, stale, unsupported } = useJobsStatus();
  const [folders, setFolders] = useState<Folders | null>(null);
  useEffect(() => {
    let live = true;
    // a list it couldn't get just means nothing extra to report here, and Sources has its own warning
    get<Folders>('/folders').then((list) => { if (live) setFolders(list); }).catch(() => {});
    return () => { live = false; };
  }, [status.scan.status]);
  return (
    <>
      {/* MP-0293-01: what can be repaired comes before the passive counts. The placeholder holds its
          place until the jobs answer arrives, so the metrics don't jump down under the reader. */}
      {jobs
        ? <NeedsYou jobs={jobs} readySongs={counts.ready ?? 0} folders={folders} />
        : !stale && !unsupported && <section className="panel stack needs-you"><h2>What needs you</h2><Skeleton variant="rows" lines={2} label="Checking what needs you" retry={refreshJobs} /></section>}
      <div className="metrics">
        <div><strong>{counts.ready ?? 0}</strong><span>ready for mixes</span></div>
        <div><strong>{counts.analysed}</strong><span>audio analysed</span></div>
        <div><strong>{left}</strong><span>still to analyse</span></div>
        {flagOn('lyrics.lookup') && <div><strong>{counts.lyrics}</strong><span>with timed lyrics</span></div>}
        <div><strong>{counts.set_aside}</strong><span>set aside as not music</span></div>
      </div>
      <JobsPanel status={status} />
      {flagOn('export') && <ExportJobs always />}
      <InterfaceChoices />
    </>
  );
}

function WorkshopView({ status, refreshStatus, notify, tab = 'overview' }: ViewProps & { tab?: WorkshopTab }) {
  const { counts } = status;
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const route = useRoute();
  const inStudy = route.page === 'listening';
  const here = workspaceTabs().find((section) => section.tab === tab)?.path ?? '/workshop';
  useFlags();
  const estimates = flagOn('analysis.time_estimates');

  const toggle = async () => {
    await post(status.analysis_running ? '/analysis/stop' : '/analysis/start');
    refreshStatus();
    notify(status.analysis_running ? 'Paused. It’ll pick up where it left off.' : 'Analysing in the background.');
  };

  return (
    <main className="page browse workspace" id="main">
      <h1 className="display small">{inStudy ? 'Listening study' : 'Workspace'}</h1>
      <LinkTabs label="Workspace" items={workspaceTabs()} current={here} />

      {tab === 'overview' && <Overview status={status} />}

      {tab === 'analysis' && (
        <section className="panel stack">
          <h2>Analysis</h2>
          <p>
            {status.analysis_running
              ? status.mix_rendering
                ? `Waiting while ${status.mixes_in_line ? 'your mixes render' : 'your mix renders'}, then it carries on. ${left} to go${estimates ? `, done in ${etaRangeWords(status.eta?.analysis)}` : ''}.`
                : `Working through your songs at low priority, so you can keep using your PC. ${left} to go${estimates ? `, done in ${etaRangeWords(status.eta?.analysis)}` : ''}.`
              : left
                ? `${left} song${left === 1 ? '' : 's'} left. ${analysisWords(status.eta?.analysis)}`
                : `Audio analysis is complete. ${counts.ready ?? 0} songs currently have the cues Selecta needs to mix them.`}
          </p>
          {estimates && estimateWords(status.eta?.accuracy) && <p className="hint">{estimateWords(status.eta?.accuracy)}</p>}
          {estimates && <p className="hint">{words().workshopEstimates}</p>}
          {flagOn('render.spare_time') && (
            <p className="hint">
              With nothing else to do, Selecta tries out the best transitions across your library, so they’re ready when you want them.
              {status.transitions_ready ? ` ${status.transitions_ready} have come out clean so far.` : ''}
            </p>
          )}
          {!!status.analysing?.length && <p><Status kind="queued">{status.analysing.length} song{status.analysing.length === 1 ? '' : 's'} you asked for will go first</Status></p>}
          {left > 0 && (
            <div className="row wrap">
              <Action className={status.analysis_running ? '' : 'primary'} run={toggle}>
                {status.analysis_running ? 'Pause' : 'Analyse the rest'}
              </Action>
              <span className="hint">Safe to pause any time.</span>
            </div>
          )}
          <p className="hint">
            <PageLink to="/library?show=not_yet">See what’s waiting</PageLink>, or <PageLink to="/library?show=attention">see what needs attention</PageLink>. A song that couldn’t be analysed can be tried again from there.
          </p>
        </section>
      )}

      {tab === 'storage' && <>{flagOn('workspace.storage') && <StoragePanel />}{flagOn('workspace.backup') && <LocalBackup />}</>}
      {tab === 'sources' && <FoldersPanel status={status} refreshStatus={refreshStatus} notify={notify} />}
      {tab === 'learning' && (
        <>
          {!inStudy && flagOn('learning.memory') && <MemoryPanel />}
          {flagOn('listening_study') && <Listening />}
        </>
      )}
      {tab === 'diagnostics' && <Diagnostics />}
      {/* development builds, and test builds made with VITE_SELECTA_GALLERY=1 so the gallery can be measured (ADR-279) */}
      {(import.meta.env.DEV || import.meta.env.VITE_SELECTA_GALLERY === '1') && tab === 'diagnostics' && <ControlGallery />}
    </main>
  );
}

/** r8c: the Workspace never shows the music clock, so a tick of it doesn't redraw the page. */
export const Workshop = memo(WorkshopView, sameApartFromClock<ViewProps & { tab?: WorkshopTab }>());
