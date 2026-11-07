import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, FolderCheck, get, post, Status } from '../api';
import { Action } from '../ui/controls';
import { Field } from '../ui/primitives';
import { SetupSteps } from './Setup';

/** What to try next, for each reason a folder can't be read. */
const WHAT_TO_TRY: Record<FolderCheck['kind'], string> = {
  ok: '',
  missing: 'Check the address for typos. If it’s on an external drive, plug that in first.',
  not_a_folder: 'That’s a file. Use the address of the folder it’s in.',
  no_access: 'Windows won’t let Selecta read it. Choose a folder your account can open.',
  already_added: 'There’s nothing more to do for this one. Its songs are already in your library.',
  inside_added: 'Songs in this folder are already being picked up from the one it’s inside.',
  no_audio: 'Selecta looked and found no audio files, including in subfolders. Choose the folder your music is in.',
};

/** The very first screen: where's your music? Everything else waits on this one answer. A browser's
 * folder picker can't help here, because what it hands back isn't an address the Selecta server can
 * read, so the address is pasted in and checked by the server before anything happens. */
export function Start({ status, onChange }: { status: Status; onChange: () => void }) {
  const [folder, setFolder] = useState('');
  const [problem, setProblem] = useState('');
  const [advice, setAdvice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cannotStop, setCannotStop] = useState(false);
  const pending = useRef(false);
  const { scan } = status;
  const scanning = scan.status === 'running';

  useEffect(() => {
    if (!scanning) return;
    setCannotStop(false);
    const timer = window.setInterval(onChange, 1000);
    return () => window.clearInterval(timer);
  }, [scanning, onChange]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    const clean = folder.trim().replace(/^(["'])(.*)\1$/u, '$2').trim();
    if (pending.current || scanning || !clean) return;
    pending.current = true;
    setSubmitting(true);
    setProblem('');
    setAdvice('');
    try {
      let verdict: FolderCheck | null = null;
      try {
        verdict = await get<FolderCheck>(`/folders/check?path=${encodeURIComponent(clean)}`);
      } catch (error) {
        // Older servers may lack preflight. Offline errors and server failures
        // are not permission to skip validation and initiate a scan.
        if (!(error instanceof ApiError && (error.status === 404 || error.status === 405))) throw error;
      }
      if (verdict && !verdict.ok) {
        setProblem(verdict.reason);
        setAdvice(WHAT_TO_TRY[verdict.kind] ?? '');
        return;
      }
      await post('/scan', { folder: clean });
      onChange();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };

  const stop = async () => {
    try {
      await post('/scan/cancel');
      onChange();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setCannotStop(true);
      else throw error;
    }
  };

  const busy = scanning || submitting;
  return (
    <main className="page start setup" id="main">
      <SetupSteps stage="connect" />
      <h1 className="display">Where’s your music?</h1>
      <p className="lede">
        Selecta reads the folder, sets aside anything that isn’t music, and works out how your songs fit
        together. Your audio stays on this PC. Adding a folder starts lyric lookup: artist, title,
        album and duration are sent to LRCLIB to find lyrics.
      </p>
      <form onSubmit={(event) => void start(event)} className="stack">
        <Field
          label="Music folder"
          help="In File Explorer, open your music folder, copy its address, and paste it here. Subfolders are included. Your original files are never moved or changed."
          error={problem || undefined}
        >
          {(field) => (
            <div className="row">
              <input
                {...field}
                autoComplete="off"
                spellCheck={false}
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                placeholder="C:\Users\you\Music"
              />
              <button className="primary" disabled={!folder.trim() || busy} aria-busy={busy}>
                {busy ? 'Reading…' : 'Start'}
              </button>
            </div>
          )}
        </Field>
        {advice && <p className="hint">{advice}</p>}
        {scanning && (
          <div className="setup-scan">
            <p role="status">Finding music in your folder{scan.folder ? `, ${scan.folder}` : ''}. You can keep using your PC.</p>
            {cannotStop
              ? <p className="hint">This version of Selecta can’t stop partway. It’s safe to leave it running.</p>
              : <Action working="Stopping…" run={stop}>Stop reading this folder</Action>}
          </div>
        )}
        {scan.status === 'done' && scan.music === 0 && <p role="status">No new music was found in that folder. Check the address or choose another folder with audio files.</p>}
        {scan.status === 'cancelled' && <p role="status">Stopped reading that folder. Nothing was moved or changed, and you can start again whenever you like.</p>}
        {scan.status === 'failed' && <p className="warn" role="alert">{scan.error}</p>}
      </form>
    </main>
  );
}
