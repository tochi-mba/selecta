import { FormEvent, useEffect, useState } from 'react';
import { get, post } from '../api';
import { ViewProps } from './shared';

type Storage = { budget_bytes: number; used_bytes: number; free_bytes: number };
const gb = (bytes: number) => bytes / 1024 ** 3;

export function Workshop({ status, refreshStatus }: ViewProps) {
  const { counts } = status;
  const [storage, setStorage] = useState<Storage | null>(null);
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState('');
  const left = Math.max((counts.music ?? 0) - (counts.analysed ?? 0), 0);

  useEffect(() => {
    get<Storage>('/storage').then(setStorage).catch(() => {});
  }, []);

  const toggle = async () => {
    await post(status.analysis_running ? '/analysis/stop' : '/analysis/start');
    refreshStatus();
  };
  const budget = async (value: number) => {
    setStorage(await post<Storage>('/storage', { budget_gb: value }));
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
        <div><strong>{counts.analysed}</strong><span>ready to mix</span></div>
        <div><strong>{left}</strong><span>still to analyse</span></div>
        <div><strong>{counts.lyrics}</strong><span>with timed lyrics</span></div>
        <div><strong>{counts.set_aside}</strong><span>set aside as not music</span></div>
      </div>

      <section className="panel stack">
        <h2>Analysis</h2>
        <p>
          {status.analysis_running
            ? 'Running in the background, at low priority. You can keep using your PC.'
            : left
              ? `${left} songs left, at about 25 seconds each. More songs means better mixes and more word links.`
              : 'Every song is analysed.'}
        </p>
        {left > 0 && (
          <div className="row">
            <button className="primary" onClick={() => void toggle()}>
              {status.analysis_running ? 'Pause' : 'Analyse the rest'}
            </button>
            <span className="hint">Safe to pause any time. It picks up where it left off.</span>
          </div>
        )}
      </section>

      <section className="panel stack">
        <h2>Add another folder</h2>
        <form className="row" onSubmit={scan}>
          <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="C:\Users\you\Music" aria-label="Music folder" />
          <button disabled={!folder.trim() || status.scan.status === 'running'}>
            {status.scan.status === 'running' ? 'Reading…' : 'Read folder'}
          </button>
        </form>
        {problem && <p className="warn" role="alert">{problem}</p>}
        {status.scan.status === 'done' && (
          <p className="hint">
            Read {status.scan.folder}: {status.scan.music} songs, {status.scan.set_aside} set aside.
          </p>
        )}
      </section>

      {storage && (
        <section className="panel stack">
          <h2>Storage</h2>
          <p>
            Selecta is using {gb(storage.used_bytes).toFixed(1)} GB. Its limit for stems is {gb(storage.budget_bytes).toFixed(1)} GB, with{' '}
            {gb(storage.free_bytes).toFixed(1)} GB free on this drive.
          </p>
          <label>
            Limit
            <input
              type="range"
              min={0.5}
              max={Math.max(1, Math.floor(gb(storage.free_bytes) + gb(storage.budget_bytes)))}
              step={0.5}
              value={gb(storage.budget_bytes)}
              onChange={(event) => void budget(Number(event.target.value))}
            />
          </label>
        </section>
      )}
    </main>
  );
}
