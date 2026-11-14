import { useEffect, useState } from 'react';
import { estimatedOutputBytes, renderMixLocally, type Codec, type RenderRequest } from '../render/export';
import type { RenderProgress } from '../render/contracts';
import { saveArtifactFromUserGesture } from '../local-artifacts/save';

/** Mountable by Agent 07 without editing Studio or importing an audio/server API. */
export interface RenderExportPanelProps {
  request: Omit<RenderRequest, 'codec' | 'signal' | 'onProgress'>;
  filename: string;
}
const displayMiB = (bytes: number) => (bytes / 1048576).toFixed(1) + ' MiB';
export function RenderExportPanel({ request, filename }: RenderExportPanelProps) {
  const [codec, setCodec] = useState<Codec>('wav');
  const [state, setState] = useState<RenderProgress | null>(null);
  const [artifact, setArtifact] = useState<File | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [controller, setController] = useState<AbortController | null>(null);
  const working = controller !== null;
  useEffect(() => {
    if (navigator.storage?.estimate) {
      void navigator.storage.estimate().then(q => {
        if (q.quota !== undefined && q.usage !== undefined) setAvailable(Math.max(0, q.quota - q.usage));
      }).catch(() => setAvailable(null));
    }
  }, []);
  const estimate = estimatedOutputBytes(request.recipe, codec);
  const begin = async () => {
    const abort = new AbortController();
    setController(abort); setArtifact(null); setError('');
    try {
      const result = await renderMixLocally({ ...request, codec, signal: abort.signal, onProgress: setState });
      setArtifact(result.file);
    } catch (e) { setError(e instanceof Error ? e.message : 'Render failed'); }
    finally { setController(null); }
  };
  const save = async () => {
    if (!artifact) return;
    try { await saveArtifactFromUserGesture(artifact, filename.replace(/\.(wav|flac)$/i, '') + '.' + codec); }
    catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
  };
  const progress = state && state.totalFrames > 0 ? Math.min(100, Math.round(state.framesDone / state.totalFrames * 100)) : 0;
  return (
    <section aria-label="Local mix export" style={{ display: 'grid', gap: 12, width: '100%', minWidth: 0, maxWidth: 500 }}>
      <strong>Export on this device</strong>
      <p>Music and rendered audio stay on this browser. Keep this page open and awake until validation completes.</p>
      <label>Format
        <select value={codec} onChange={e => setCodec(e.target.value as Codec)} disabled={working}>
          <option value="wav">WAV (PCM 16-bit)</option>
          <option value="flac">FLAC (lossless, uncompressed frames)</option>
        </select>
      </label>
      <div>Estimated file size: {displayMiB(estimate)}</div>
      <div>Browser storage available: {available === null ? 'Unknown — check quota before starting' : displayMiB(available)}</div>
      <div>Temporary reserve: approximately {displayMiB(Math.ceil(estimate * 2.2 + 4 * 1048576))}</div>
      {state && <>
        <div role="status" aria-live="polite">{state.state}: {progress}% {state.message ?? ''}</div>
        <progress max={100} value={progress} aria-label="Render progress" style={{ width: '100%' }} />
      </>}
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" onClick={() => void begin()} disabled={working || request.livePlaybackActive()}>Render locally</button>
        {working && <button type="button" onClick={() => controller?.abort()}>Cancel render</button>}
        {artifact && !working && <button type="button" onClick={() => void save()}>Save or share verified file</button>}
      </div>
      <small>iPhone, iPad, Android and laptops are checked by actual browser capabilities, never excluded just for being mobile. Browser tab suspension may interrupt work.</small>
    </section>
  );
}
