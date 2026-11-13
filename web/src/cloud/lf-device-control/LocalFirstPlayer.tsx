import { useEffect, useState, type KeyboardEvent } from 'react';
import type { Api } from '../api';
import { useLocalFirstControl } from './useLocalFirstControl';
import type { LocalControlAdapter } from './adapter';
import {
  audibleTruth, isFresh, TELEMETRY_FRESH_MS, verifiedCount, type CommandKind,
} from './contracts';
import './localFirstPlayer.css';

export function LocalFirstPlayer({ api, workspaceId, actorId, adapter }: { api: Api; workspaceId: string; actorId: string; adapter?: LocalControlAdapter }) {
  const control = useLocalFirstControl({ api, workspaceId, actorId, adapter });
  const { here, speaker, session, readiness, blocked, pending, error, notice } = control;
  const [controlling, setControlling] = useState(false);
  const [showTakeover, setShowTakeover] = useState(false);
  const [selectedOutput, setSelectedOutput] = useState('');
  const currentOutput = session?.output_id ?? '';
  const speakerOnline = Boolean(speaker?.connectivity === 'online' &&
    isFresh(speaker.last_confirmed_server_at, TELEMETRY_FRESH_MS));
  const freshSpeaker = Boolean(session && isFresh(session.observed_at, TELEMETRY_FRESH_MS) && speakerOnline);
  const isAnotherSpeaker = Boolean(session?.speaker_device_id && session.speaker_device_id !== here?.device_id);
  const active = control.checkingDestination || Boolean(pending && ['requested', 'prepared', 'queued', 'uncertain'].includes(pending.stage));
  const canRemote = Boolean(session?.speaker_device_id && freshSpeaker && session.original_can_be_fenced);
  const cannotTakeover = blocked ?? (active ? 'Another operation needs reconciliation first.' : null);

  useEffect(() => {
    setSelectedOutput(currentOutput);
  }, [currentOutput, session?.speaker_device_id]);

  // Browser MediaSession actions are remote metadata commands only. No Audio element or
  // autoplay is ever created in the local-first branch. Clean handlers on unmount.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !canRemote) return;
    const actions: Array<[MediaSessionAction, CommandKind]> = [
      ['play', 'play'], ['pause', 'pause'], ['nexttrack', 'skip'],
    ];
    for (const [action, command] of actions) {
      try { navigator.mediaSession.setActionHandler(action, () => void control.sendTransport(command as 'play' | 'pause' | 'skip')); }
      catch { /* unsupported action on this browser */ }
    }
    return () => {
      for (const [action] of actions) {
        try { navigator.mediaSession.setActionHandler(action, null); }
        catch { /* unsupported */ }
      }
    };
  }, [canRemote, control.sendTransport]);

  const onKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (!controlling || !canRemote || active ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLButtonElement) return;
    if (event.code === 'Space') {
      event.preventDefault();
      void control.sendTransport(session?.state === 'playing' ? 'pause' : 'play');
    } else if (event.code === 'ArrowRight') {
      event.preventDefault();
      void control.sendTransport('skip');
    }
  };

  return (
    <section className="lf-player cloud-card" aria-label="Local-first player and remote" tabIndex={0} data-testid="lf12-player" onKeyDown={onKeys}>
      <div className="lf-player-heading">
        <div>
          <p className="cloud-eyebrow">DEVICE-OWNED PLAYBACK</p>
          <h2>Player and remote</h2>
        </div>
        <button type="button" onClick={() => void control.refresh()}>Refresh device status</button>
      </div>
      <p className="lf-player-where" data-testid="lf12-actual-speaker" role="status" aria-live="polite" aria-atomic="true">
        {audibleTruth(session)}
      </p>
      <dl className="lf-player-details">
        <div><dt>Actual speaker</dt><dd>{session?.speaker_name ?? 'None verified'}</dd></div>
        <div><dt>Selected output</dt><dd>{session?.output_name ?? session?.output_id ?? 'Not selected'}</dd></div>
        <div><dt>Ownership generation</dt><dd>{session?.generation ?? 'Unknown'}</dd></div>
        <div><dt>Last engine observation</dt><dd>{session?.observed_at ?
          new Date(session.observed_at).toLocaleString() : 'Never verified'}{!freshSpeaker && ' · stale/unknown'}</dd></div>
      </dl>
      {!here || here.role === 'controller_only' ? (
        <p className="lf-player-note" role="note" data-testid="lf12-controller-only">
          This browser is controller-only. It cannot play recordings stored on another device.
          Control the authorised speaker instead, or pair and verify a local engine.
        </p>
      ) : (
        <div className="lf-player-readiness" aria-label="Local playback readiness">
          <strong>{here.name} · {verifiedCount(readiness)}</strong>
          <p>{readiness?.last_verified_at ? `Checked ${new Date(readiness.last_verified_at).toLocaleString()}` : 'No verified report'}
            {readiness && !isFresh(readiness.last_verified_at, 30_000) && ' · stale verification'}</p>
          {blocked && <p className="lf-player-note" role="note">{blocked}</p>}
          {here && session?.recipe_revision && control.outputId && (
            <button type="button" onClick={() => void control.verify(here.device_id, session.recipe_revision!, control.outputId!)}>
              Verify local recordings
            </button>
          )}
        </div>
      )}

      <div className="lf-player-actions" aria-label="Playback destination actions">
        <button type="button" className="primary" data-testid="lf12-play-here"
          onClick={() => setShowTakeover(true)} disabled={Boolean(cannotTakeover)}
          title={cannotTakeover ?? 'Prepare this engine and safely transfer the speaker'}>
          Play Here
        </button>
        <button type="button" onClick={() => setControlling((v) => !v)}
          disabled={!canRemote} aria-expanded={controlling}>
          {controlling ? 'Hide remote controls' : 'Control Existing Speaker'}
        </button>
      </div>
      {isAnotherSpeaker && session?.original_can_be_fenced === false && (
        <p role="alert" className="lf-player-danger">
          Unsafe takeover blocked: the previous speaker cannot be fenced and may still produce sound.
          Reconnect or physically isolate that speaker before changing ownership.
        </p>
      )}
      {showTakeover && (
        <div role="alertdialog" aria-label="Confirm safe playback takeover" className="lf-player-confirm">
          <p>{isAnotherSpeaker
            ? `Move playback from ${session?.speaker_name ?? 'the current speaker'} to ${here?.name ?? 'this device'}? The original must confirm release before the destination starts.`
            : 'Start playback on this engine after local media and output preflight?'}</p>
          <button type="button" className="primary" onClick={() => { setShowTakeover(false); void control.takeOver(); }}>
            Confirm Play Here
          </button>
          <button type="button" onClick={() => setShowTakeover(false)}>Cancel</button>
        </div>
      )}
      {controlling && canRemote && (
        <div className="lf-player-remote" role="group" aria-label="Control existing local speaker">
          <span>Controlling {session?.speaker_name ?? 'the existing speaker'} remotely — no audio is streamed here.</span>
          <button type="button" disabled={active} onClick={() => void control.sendTransport(session?.state === 'playing' ? 'pause' : 'play')}>
            {session?.state === 'playing' ? 'Pause speaker' : 'Play speaker'}
          </button>
          <button type="button" disabled={active} onClick={() => void control.sendTransport('skip')}>Skip</button>
          <small>Keyboard: Space toggles play/pause; Right Arrow skips when this panel has focus.</small>
        </div>
      )}
      {speaker?.role === 'local_engine' && speaker.outputs.length > 0 && (
        <div className="lf-player-output" role="group" aria-label="Change actual speaker output">
          <label htmlFor="lf12-output">Change Output</label>
          <select id="lf12-output" value={selectedOutput} onChange={(event) => setSelectedOutput(event.target.value)}>
            {speaker.outputs.map((item) => (
              <option key={item.id} value={item.id} disabled={item.health !== 'ready'}>
                {item.name}{item.health !== 'ready' ? ` (${item.health})` : ''}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void control.changeOutput(selectedOutput)}
            disabled={active || !freshSpeaker || !selectedOutput || selectedOutput === currentOutput ||
              !session?.original_can_be_fenced}>
            Apply output change
          </button>
          <small>New output must pass local preflight. Failure leaves the existing output active.</small>
        </div>
      )}
      {control.checkingDestination && !pending && (
        <p className="lf-player-command" role="status" aria-live="polite">requested — Checking destination recordings, output and speaker safety…</p>
      )}
      {pending && (
        <p className="lf-player-command" data-testid="lf12-command" role="status" aria-live="polite" aria-atomic="true">
          {pending.kind.replace('_', ' ')} · <strong>{pending.stage}</strong> — {pending.message}
        </p>
      )}
      {notice && <p className="lf-player-note" role="status" aria-live="polite">{notice}</p>}
      {error && <p role="alert" className="lf-player-danger">
        Device control unavailable: {error}. Existing local playback may continue; do not assume it stopped.
      </p>}
    </section>
  );
}
