import { FormEvent, useEffect, useRef, useState } from 'react';
import { get, post, Storage } from '../api';
import { gb, storageWords } from '../lib';
import { ViewProps } from './shared';

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

  if (!storage || limit === null) return null;
  const words = storageWords(storage);
  const overBudget = storage.cache_bytes > storage.budget_bytes;
  const largest = Math.max(storage.largest_budget_bytes / GB, 0.5);
  const smallest = storage.smallest_budget_bytes / GB;

  const move = (value: number) => {
    setLimit(value);
    window.clearTimeout(wait.current);
    wait.current = window.setTimeout(() => {
      void post<Storage>('/storage', { budget_gb: value }).then(setStorage);
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
      <p className="hint">
        {overBudget
          ? 'Priority-song stem windows are protected, so they can temporarily put the cache over its limit. Lower a song’s priority to make its windows eligible for removal.'
          : 'When it’s full, Selecta removes the oldest cache items that are not protected by song priority. It makes them again if needed.'}{' '}
        It always leaves at least 2 GB free. Your music is never touched. The most it can use right now is {gb(storage.largest_budget_bytes)}.
      </p>
    </section>
  );
}

export function Workshop({ status, refreshStatus, notify }: ViewProps) {
  const { counts } = status;
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState('');
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);
  const hours = (left * 25) / 3600;
  const reading = status.scan.status === 'running';

  const toggle = async () => {
    await post(status.analysis_running ? '/analysis/stop' : '/analysis/start');
    refreshStatus();
    notify(status.analysis_running ? 'Paused. It’ll pick up where it left off.' : 'Analysing in the background.');
  };
  const scan = async (event: FormEvent) => {
    event.preventDefault();
    setProblem('');
    try {
      await post('/scan', { folder });
      refreshStatus();
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  return (
    <main className="page">
      <h1 className="display small">Workshop</h1>
      <div className="metrics">
        <div><strong>{counts.ready ?? 0}</strong><span>ready for mixes</span></div>
        <div><strong>{counts.analysed}</strong><span>audio analysed</span></div>
        <div><strong>{left}</strong><span>still to analyse</span></div>
        <div><strong>{counts.lyrics}</strong><span>with timed lyrics</span></div>
        <div><strong>{counts.set_aside}</strong><span>set aside as not music</span></div>
      </div>

      <section className="panel stack">
        <h2>Analysis</h2>
        <p>
          {status.analysis_running
            ? status.mix_rendering
              ? `Waiting while your mix renders, then it carries on. ${left} to go.`
              : `Working through your songs at low priority, so you can keep using your PC. ${left} to go.`
            : left
              ? `${left} song${left === 1 ? '' : 's'} left, about ${hours < 1 ? `${Math.ceil(hours * 60)} minutes` : `${Math.ceil(hours)} hours`} in the background. More songs means better mixes and more word links.`
              : `Audio analysis is complete. ${counts.ready ?? 0} songs currently have the cues Selecta needs to mix them.`}
        </p>
        {left > 0 && (
          <div className="row wrap">
            <button className={status.analysis_running ? '' : 'primary'} onClick={() => void toggle()}>
              {status.analysis_running ? 'Pause' : 'Analyse the rest'}
            </button>
            <span className="hint">Safe to pause any time.</span>
          </div>
        )}
      </section>

      <StoragePanel />
      <MemoryPanel />

      <section className="panel stack">
        <h2>Add another folder</h2>
        <form className="row" onSubmit={scan}>
          <input
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="C:\Users\you\Music"
            aria-label="Music folder"
          />
          <button disabled={!folder.trim() || reading}>{reading ? 'Reading…' : 'Read folder'}</button>
        </form>
        {problem && <p className="warn" role="alert">{problem}</p>}
        {status.scan.status === 'done' && (
          <p className="hint">
            Read {status.scan.folder}: {status.scan.music} songs, {status.scan.set_aside} set aside. Analysing them now.
          </p>
        )}
        {status.scan.status === 'failed' && <p className="warn" role="alert">{status.scan.error}</p>}
      </section>
    </main>
  );
}
