import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { claimFocus, releaseFocus } from '../cloud/cloudTransport';
import { sayThisTabIsPlaying, whenAnotherTabPlays } from '../state/tabs';
import { browserEngine, retainBrowserEngine } from './registry';
import { probeBrowserAudio } from './capabilities';
import { localCatalogue } from '../media/localCatalogue';
import type { EngineSnapshot } from './contracts';
import './localBrowserPlayer.css';

function formatTime(seconds: number) {
  const total = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}
const isOutputReady = (state: EngineSnapshot) => state.phase === 'playing' || state.phase === 'paused';

export function LocalBrowserPlayer({ workspaceId }: { workspaceId: string }) {
  const engine = useMemo(() => browserEngine(workspaceId), [workspaceId]);
  const catalogue = useMemo(() => localCatalogue(workspaceId), [workspaceId]);
  const [libraryRevision, setLibraryRevision] = useState(0);
  useEffect(() => catalogue.subscribe(() => setLibraryRevision((old) => old + 1)), [catalogue]);
  const now = useSyncExternalStore(engine.subscribe, engine.snapshot, engine.snapshot);
  const compatibility = useMemo(() => probeBrowserAudio(), []);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState('');
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const connected = useMemo(() => catalogue.recordings.filter((entry) => entry.readiness === 'ready'), [catalogue, libraryRevision]);

  useEffect(() => retainBrowserEngine(workspaceId, engine), [workspaceId, engine]);
  useEffect(() => whenAnotherTabPlays(() => {
    void engine.stop();
    setStatus('Audio stopped because another Selecta tab claimed playback.');
  }), [engine]);
  useEffect(() => {
    if (now.phase === 'playing') {
      claimFocus({ id: 'device', pause: () => { void engine.pause(); } });
      sayThisTabIsPlaying();
    } else if (now.phase !== 'starting') releaseFocus('device');
    return () => releaseFocus('device');
  }, [engine, now.phase]);
  const choose = async (files: FileList | null) => {
    if (!files?.length) return;
    const chosen = Array.from(files);
    await engine.setQueue(chosen.map((file, index) => ({
      id: String(index) + ':' + file.name + ':' + file.size + ':' + file.lastModified,
      title: file.name.replace(/\.[^.]+$/, ''),
      file,
    })));
    setStatus(String(chosen.length) + ' local file(s) selected. They stay in this browser; no music is uploaded.');
    // Keep the Connect Music and player surfaces on one local catalogue.
    void catalogue.scan(chosen, { origin: 'file_input', label: 'Player selection' })
      .catch(() => setStatus('Music plays locally; indexing needs another permission check.'));
  };
  const loadConnected = async () => {
    if (!connected.length) return;
    try {
      const queue = [];
      for (const row of connected) {
        const file = await catalogue.openRecording(row.id);
        queue.push({ id: row.id, title: row.title, file });
      }
      await engine.setQueue(queue);
      setStatus(queue.length + ' verified local recording(s) loaded from Connect Music.');
    } catch {
      setStatus('A connected recording has changed or lost permission. Reconnect local music before playback.');
    }
  };
  const play = async () => {
    if (now.phase === 'playing') { await engine.pause(); return; }
    if (now.phase === 'starting') return;
    if (now.error?.includes('another tab') || now.error?.includes('coordinate tabs')) {
      setConfirmTakeover(true); return;
    }
    await engine.play();
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey ||
      event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLSelectElement) return;
    if (event.code === 'Space') {
      event.preventDefault(); void play();
    } else if (event.code === 'ArrowRight') {
      event.preventDefault(); void engine.next();
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault(); void engine.previous();
    }
  };

  return (
    <section className="browser-player cloud-card" aria-label="Browser-local music player" data-testid="br64-01-browser-player"
      onKeyDown={keys} tabIndex={0}>
      <div className="browser-player-header">
        <div>
          <p className="cloud-eyebrow">PLAY ON THIS BROWSER — NO INSTALLATION</p>
          <h2>Local music player</h2>
        </div>
        <strong role="status" aria-live="polite" data-testid="br64-01-phase">{now.pending ?? now.phase}</strong>
      </div>
      {compatibility.reason && <p role="alert" className="cloud-feedback error">This browser cannot safely play here: {compatibility.reason} You can still control an authorised speaker remotely.</p>}
      <label className="browser-player-import">
        Select music from this device
        <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus"
          multiple onChange={(event) => { void choose(event.target.files); event.target.value = ''; }}
          data-testid="br64-01-files" />
      </label>
      <button type="button" onClick={() => void loadConnected()} disabled={!connected.length}
        data-testid="br64-connected-music">
        Load connected music ({connected.length} ready here)
      </button>
      <p className="browser-player-help">Files stay local. Chrome, Firefox, Safari, Android and iPad may decode different formats. A file selection is required again after a page reload.</p>
      <div className="browser-player-now">
        <strong data-testid="br64-01-track">{now.title ?? 'No music selected'}</strong>
        <span>{now.tracks ? String(now.index + 1) + ' of ' + now.tracks : 'Add local music to begin'}</span>
        <span>{formatTime(now.position)} / {formatTime(now.duration)}</span>
      </div>
      <input aria-label="Seek within track" data-testid="br64-01-seek" type="range" min={0}
        max={Math.max(0.01, now.duration)} step={0.1} value={Math.min(now.position, Math.max(0.01, now.duration))}
        disabled={!isOutputReady(now) || !now.duration}
        onChange={(event) => void engine.seek(Number(event.target.value))} />
      <div className="browser-player-controls" role="group" aria-label="Local playback controls">
        <button type="button" onClick={() => void engine.previous()} disabled={!now.tracks || now.index < 0}>Previous</button>
        <button className="primary" type="button" onClick={() => void play()} data-testid="br64-01-play"
          disabled={!compatibility.eligible || !now.tracks || now.phase === 'starting'}>
          {now.phase === 'playing' ? 'Pause' : now.phase === 'paused' || now.phase === 'interrupted' ? 'Tap to resume' : 'Tap to start audio'}
        </button>
        <button type="button" onClick={() => void engine.next()} data-testid="br64-01-next"
          disabled={!now.tracks || now.index < 0}>Next</button>
        <button type="button" onClick={() => void engine.stop()} disabled={!now.tracks}>Stop</button>
      </div>
      <div className="browser-player-slider">
        <label htmlFor="br64-volume">Volume: {Math.round(now.volume * 100)}%</label>
        <input id="br64-volume" type="range" min="0" max="1" step="0.01" value={now.volume}
          onChange={(event) => engine.setVolume(Number(event.target.value))} />
      </div>
      <button type="button" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>
        {showSettings ? 'Hide mixing controls' : 'Mixing controls (fade and EQ)'}
      </button>
      {showSettings && <div className="browser-player-settings">
        <label>Crossfade: {now.fadeSeconds.toFixed(1)}s
          <input type="range" min="0" max="12" step="0.5" value={now.fadeSeconds}
            onChange={(event) => engine.setFade(Number(event.target.value))} />
        </label>
        <label>Low EQ: {now.lowDb} dB
          <input type="range" min="-12" max="12" step="1" value={now.lowDb}
            onChange={(event) => engine.setEq(Number(event.target.value), now.highDb)} />
        </label>
        <label>High EQ: {now.highDb} dB
          <input type="range" min="-12" max="12" step="1" value={now.highDb}
            onChange={(event) => engine.setEq(now.lowDb, Number(event.target.value))} />
        </label>
      </div>}
      <dl className="browser-player-truth">
        <div><dt>Playing device</dt><dd>{now.ownership === 'none' ? 'No active browser speaker' : 'This browser / this device'}</dd></div>
        <div><dt>Selected output</dt><dd>{now.output}</dd></div>
        <div><dt>Audio context</dt><dd>{now.context}</dd></div>
        <div><dt>Ownership</dt><dd>{now.ownership === 'cooperative' ? 'Cooperative tab safety (not atomic)' : now.ownership}</dd></div>
        <div><dt>Applied state</dt><dd>{now.phase} · generation {now.generation}</dd></div>
        <div><dt>Physical speaker</dt><dd data-testid="br64-01-sound">{now.soundCheck === 'user_confirmed'
          ? 'Heard by operator at ' + new Date(now.confirmationTime!).toLocaleTimeString()
          : 'Unverified — signal and AudioContext do not prove sound'}</dd></div>
      </dl>
      {now.phase === 'playing' && <div className="browser-player-check" role="group" aria-label="Physical sound check">
        <span>Can you hear music from the intended speaker?</span>
        <button type="button" onClick={() => engine.confirmSound(true)}>Yes, I hear it</button>
        <button type="button" onClick={() => engine.confirmSound(false)}>No sound</button>
      </div>}
      {confirmTakeover && <div role="alertdialog" aria-label="Confirm tab audio takeover" className="browser-player-dialog">
        <p>Only one tab can play on this browser profile. This action will request ownership; do not assume a remote or offline speaker has stopped.</p>
        <button type="button" onClick={() => { setConfirmTakeover(false); sayThisTabIsPlaying(); window.setTimeout(() => { void engine.play(); }, 130); }}>Request safe local handoff</button>
        <button type="button" onClick={() => setConfirmTakeover(false)}>Cancel</button>
      </div>}
      {now.error && <p role="alert" className="cloud-feedback error" data-testid="br64-01-error">{now.error}</p>}
      {status && <p className="cloud-feedback" role="status">{status}</p>}
      <small className="browser-player-help">
        No Cloud audio proxy is used. Keep the browser awake and foregrounded on phones/tablets;
        Bluetooth output and physical audibility require an operator check. Space: play/pause; arrows: skip/previous when this panel has focus.
      </small>
    </section>
  );
}
