import { FormEvent, useEffect, useState } from 'react';
import { post, Status } from '../api';

/** The very first screen: where's your music? Everything else waits on this one answer. */
export function Start({ status, onChange }: { status: Status; onChange: () => void }) {
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState('');
  const scanning = status.scan.status === 'running';

  useEffect(() => {
    if (!scanning) return;
    const timer = window.setInterval(onChange, 1000);
    return () => window.clearInterval(timer);
  }, [scanning, onChange]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setProblem('');
    try {
      await post('/scan', { folder });
      onChange();
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  return (
    <main className="page start">
      <h1 className="display">Where’s your music?</h1>
      <p className="lede">
        Selecta reads the folder, sets aside anything that isn’t music, and works out how your songs fit
        together. Nothing leaves this PC except song names, to look up lyrics.
      </p>
      <form onSubmit={start} className="stack">
        <label htmlFor="folder">Music folder</label>
        <div className="row">
          <input
            id="folder"
            autoFocus
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="C:\Users\you\Music"
          />
          <button className="primary" disabled={!folder.trim() || scanning}>
            {scanning ? 'Reading…' : 'Start'}
          </button>
        </div>
        {problem && <p className="warn" role="alert">{problem}</p>}
        {status.scan.status === 'failed' && <p className="warn" role="alert">{status.scan.error}</p>}
      </form>
    </main>
  );
}
