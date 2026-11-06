import { FormEvent, useEffect, useRef, useState } from 'react';
import { post, Status } from '../api';

/** The very first screen: where's your music? Everything else waits on this one answer. */
export function Start({ status, onChange }: { status: Status; onChange: () => void }) {
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const scanning = status.scan.status === 'running';

  useEffect(() => {
    if (!scanning) return;
    const timer = window.setInterval(onChange, 1000);
    return () => window.clearInterval(timer);
  }, [scanning, onChange]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || scanning || !folder.trim()) return;
    pending.current = true;
    setSubmitting(true);
    setProblem('');
    try {
      await post('/scan', { folder: folder.trim().replace(/^"|"$/g, '') });
      onChange();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };

  return (
    <main className="page start" id="main">
      <h1 className="display">Where’s your music?</h1>
      <p className="lede">
        Selecta reads the folder, sets aside anything that isn’t music, and works out how your songs fit
        together. Your audio stays on this PC. Adding a folder starts lyric lookup: artist, title,
        album and duration are sent to LRCLIB to find lyrics.
      </p>
      <form onSubmit={start} className="stack">
        <label htmlFor="folder">Music folder</label>
        <div className="row">
          <input
            id="folder"
            aria-describedby="folder-help"
            aria-invalid={!!problem || undefined}
            autoFocus
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="C:\Users\you\Music"
          />
          <button className="primary" disabled={!folder.trim() || scanning || submitting} aria-busy={scanning || submitting}>
            {scanning || submitting ? 'Reading…' : 'Start'}
          </button>
        </div>
        <p className="field-help" id="folder-help">In File Explorer, open your music folder, copy its address, and paste it here. Subfolders are included. Your original files are never moved or changed.</p>
        {scanning && <p role="status">Finding music in your folder. You can keep using your PC.</p>}
        {status.scan.status === 'done' && status.scan.music === 0 && <p role="status">No new music was found in that folder. Check the address or choose another folder with audio files.</p>}
        {problem && <p className="warn" role="alert">{problem}</p>}
        {status.scan.status === 'failed' && <p className="warn" role="alert">{status.scan.error}</p>}
      </form>
    </main>
  );
}
