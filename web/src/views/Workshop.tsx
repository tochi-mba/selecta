import { flagOn, useFlags } from '../flags';
import { listed } from '../shell/manifest';
import { memo, useEffect, useState } from 'react';
import { Folders, Request } from '../api';
import { useApi } from '../requestContext';
import { refreshJobs, useJobsStatus } from '../state/jobs';
import { analysisWords, estimateWords, etaRangeWords } from '../lib';
import { useRoute, type WorkshopTab } from '../router';
import { workspaceTabs } from '../shell/manifest';
import { PageLink } from '../shell/PageLink';
import { ControlGallery } from '../ui/ControlGallery';
import { Action, Skeleton, Status } from '../ui/controls';
import { LinkTabs } from '../ui/primitives';
import { ExportJobs } from './ExportJobs';
import { Listening } from './Listening';
import { LocalBackup } from './LocalBackup';
import { sameApartFromClock } from './clockMemo';
import { ViewProps } from './shared';
import { InterfaceChoices } from './InterfaceChoices';
import { InterruptedWork } from './WorkshopInterrupted';
import { Diagnostics, FoldersPanel, JobsPanel, MemoryPanel, NeedsYou, StoragePanel } from './WorkshopPanels';
import { words } from '../copy';

/** How much is ready, what's running, what's stuck and what needs someone, in that order. */
function Overview({ status, request }: { status: ViewProps['status']; request?: Request }) {
  // ADR-0462: the folders read goes through the injected request.
  const { get } = useApi(request);
  const { counts } = status;
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const { jobs, stale, unsupported } = useJobsStatus();
  const unreachable = !jobs && stale && !unsupported;
  const [folders, setFolders] = useState<Folders | null>(null);
  useEffect(() => {
    let live = true;
    // a list it couldn't get just means nothing extra to report here, and Sources has its own warning
    get<Folders>('/folders').then((list) => { if (live) setFolders(list); }).catch(() => {});
    return () => { live = false; };
  }, [status.scan.status]);
  return (
    <>
      {/* library.scan_resume: what a restart cut off comes first, with its one next step */}
      <InterruptedWork status={status} request={request} />
      {/* MP-0293-01: what can be repaired comes before the passive counts. The placeholder holds its
          place until the jobs answer arrives, so the metrics don't jump down under the reader. */}
      {jobs
        ? <NeedsYou jobs={jobs} readySongs={counts.ready ?? 0} folders={folders} />
        : !stale && !unsupported && <section className="panel stack needs-you"><h2>What needs you</h2><Skeleton variant="rows" lines={2} label="Checking what needs you" retry={refreshJobs} /></section>}
      {/* S4 (2026-11-12): when the status can't be reached, saying so comes first, before the counts */}
      {unreachable && <JobsPanel status={status} />}
      <div className="metrics">
        <div><strong>{counts.ready ?? 0}</strong><span>ready for mixes</span></div>
        <div><strong>{counts.analysed}</strong><span>audio analysed</span></div>
        <div><strong>{left}</strong><span>still to analyse</span></div>
        {flagOn('lyrics.lookup') && <div><strong>{counts.lyrics}</strong><span>with timed lyrics</span></div>}
        <div><strong>{counts.set_aside}</strong><span>set aside as not music</span></div>
      </div>
      {!unreachable && <JobsPanel status={status} />}
      {flagOn('export') && <ExportJobs always />}
      <InterfaceChoices />
      <section className="panel stack about-app" aria-labelledby="about-app-title">
        <h2 id="about-app-title">About</h2>
        <p className="hint">SelectaDJ is a REX Technologies product.</p>
      </section>
    </>
  );
}

function WorkshopView({ status, refreshStatus, notify, request, tab = 'overview' }: ViewProps & { tab?: WorkshopTab }) {
  // ADR-0462: this page's own writes go through the injected request.
  const { post } = useApi(request);
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

      {tab === 'overview' && <Overview status={status} request={request} />}

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
                : `Audio analysis is complete. ${counts.ready ?? 0} songs currently have the cues SelectaDJ needs to mix them.`}
          </p>
          {estimates && estimateWords(status.eta?.accuracy) && <p className="hint">{estimateWords(status.eta?.accuracy)}</p>}
          {estimates && <p className="hint">{words().workshopEstimates}</p>}
          {flagOn('render.spare_time') && (
            <p className="hint">
              With nothing else to do, SelectaDJ tries out the best transitions across your library, so they’re ready when you want them.
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
