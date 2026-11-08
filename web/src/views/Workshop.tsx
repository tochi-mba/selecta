import { useCallback, useEffect, useState } from 'react';
import { Folders, get, Jobs, post } from '../api';
import { analysisWords, estimateWords, etaRangeWords } from '../lib';
import { useRoute, type WorkshopTab } from '../router';
import { WORKSPACE_TABS } from '../shell/manifest';
import { PageLink } from '../shell/PageLink';
import { ThemeChoices } from '../ui/ThemeChoice';
import { setPrefs, usePrefs } from '../state/prefs';
import { ControlGallery } from '../ui/ControlGallery';
import { Action, Status } from '../ui/controls';
import { LinkTabs } from '../ui/primitives';
import { ExportJobs } from './ExportJobs';
import { Listening } from './Listening';
import { ViewProps } from './shared';
import { Diagnostics, FoldersPanel, JobsPanel, MemoryPanel, NeedsYou, StoragePanel } from './WorkshopPanels';

/** How this looks and behaves in this browser. Nothing here touches music, mixes or the server, so
 * any of it can be switched back, including the older navigation if the new one ever gets in the way. */
function InterfaceChoices() {
  const preferences = usePrefs();
  return (
    <section className="panel stack interface-choices">
      <h2>Interface</h2>
      <p className="hint">These are kept in this browser. None of them change your music or your mixes.</p>
      <ThemeChoices />
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
      </fieldset>
      <label className="choice">
        <input type="checkbox" checked={preferences.density === 'compact'} onChange={(event) => setPrefs({ density: event.target.checked ? 'compact' : 'comfortable' })} />
        Compact rows in the Library, the timeline and drafts
      </label>
      <label className="choice">
        <input type="checkbox" checked={preferences.palette} onChange={(event) => setPrefs({ palette: event.target.checked })} />
        Use Ctrl K for search and commands
      </label>
      <label className="choice">
        <input type="checkbox" checked={preferences.singleKeys} onChange={(event) => setPrefs({ singleKeys: event.target.checked })} />
        Single-key shortcuts such as N and M
      </label>
      <label className="choice">
        <input type="checkbox" checked={preferences.classicNav} onChange={(event) => setPrefs({ classicNav: event.target.checked })} />
        Use the older navigation: Mixes, Discover and Workshop
      </label>
    </section>
  );
}

/** How much is ready, what's running, what's stuck and what needs someone, in that order. */
function Overview({ status }: { status: ViewProps['status'] }) {
  const { counts } = status;
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const [jobs, setJobs] = useState<Jobs | null>(null);
  const [folders, setFolders] = useState<Folders | null>(null);
  const onJobs = useCallback((next: Jobs) => setJobs(next), []);
  useEffect(() => {
    let live = true;
    // a list it couldn't get just means nothing extra to report here, and Sources has its own warning
    get<Folders>('/folders').then((list) => { if (live) setFolders(list); }).catch(() => {});
    return () => { live = false; };
  }, [status.scan.status]);
  return (
    <>
      <div className="metrics">
        <div><strong>{counts.ready ?? 0}</strong><span>ready for mixes</span></div>
        <div><strong>{counts.analysed}</strong><span>audio analysed</span></div>
        <div><strong>{left}</strong><span>still to analyse</span></div>
        <div><strong>{counts.lyrics}</strong><span>with timed lyrics</span></div>
        <div><strong>{counts.set_aside}</strong><span>set aside as not music</span></div>
      </div>
      {jobs && <NeedsYou jobs={jobs} readySongs={counts.ready ?? 0} folders={folders} />}
      <JobsPanel status={status} onJobs={onJobs} />
      <ExportJobs always />
      <InterfaceChoices />
    </>
  );
}

export function Workshop({ status, refreshStatus, notify, tab = 'overview' }: ViewProps & { tab?: WorkshopTab }) {
  const { counts } = status;
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const route = useRoute();
  const inStudy = route.page === 'listening';
  const here = WORKSPACE_TABS.find((section) => section.tab === tab)?.path ?? '/workshop';

  const toggle = async () => {
    await post(status.analysis_running ? '/analysis/stop' : '/analysis/start');
    refreshStatus();
    notify(status.analysis_running ? 'Paused. It’ll pick up where it left off.' : 'Analysing in the background.');
  };

  return (
    <main className="page browse workspace" id="main">
      <h1 className="display small">{inStudy ? 'Listening study' : 'Workspace'}</h1>
      <LinkTabs label="Workspace" items={WORKSPACE_TABS} current={here} />

      {tab === 'overview' && <Overview status={status} />}

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
          <p className="hint">Times are estimates, from how long this PC has been taking. They’re never a promise.</p>
          <p className="hint">
            With nothing else to do, Selecta tries out the best transitions across your library, so they’re ready when you want them.
            {status.transitions_ready ? ` ${status.transitions_ready} have come out clean so far.` : ''}
          </p>
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

      {tab === 'storage' && <StoragePanel />}
      {tab === 'sources' && <FoldersPanel status={status} refreshStatus={refreshStatus} notify={notify} />}
      {tab === 'learning' && (
        <>
          <MemoryPanel />
          <Listening />
        </>
      )}
      {tab === 'diagnostics' && <Diagnostics />}
      {import.meta.env.DEV && tab === 'diagnostics' && <ControlGallery />}
    </main>
  );
}
