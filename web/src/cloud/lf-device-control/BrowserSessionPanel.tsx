import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserEngine } from '../../engine/registry';
import { probeBrowserAudio } from '../../engine/capabilities';
import {
  BrowserSessionClient,
  type Action, type BrowserEnvelope, type CommandReceipt, type DeviceSummary, type Speaker,
} from '../lf-session/client';

/** Cloud remote controls and browser executor. Never share source files, handles, or PCM.
 * A remote queued receipt is NOT proof a speaker executed anything. */
export function BrowserSessionPanel({ workspaceId, accessToken }: {
  workspaceId: string;
  accessToken: () => Promise<string>;
}) {
  const engine = useMemo(() => browserEngine(workspaceId), [workspaceId]);
  // The authenticated caller can change identity after token refresh without
  // discarding an active in-memory device session on routine React rerenders.
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const client = useMemo(() =>
    new BrowserSessionClient(() => tokenRef.current(), fetch, workspaceId), [workspaceId]);
  const [zone, setZone] = useState('personal');
  const [registered, setRegistered] = useState(false);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [speaker, setSpeaker] = useState<Speaker | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<BrowserEnvelope | null>(null);
  const [receipt, setReceipt] = useState<CommandReceipt | null>(null);
  const [targetSession, setTargetSession] = useState('');
  const [operation, setOperation] = useState<string | null>(null);
  const fence = useRef(0);
  const processing = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void client.revoke().catch(() => {});
    };
  }, [client]);

  const refresh = useCallback(async () => {
    const [remote, selected] = await Promise.all([client.devices(zone), client.speaker(zone)]);
    if (!alive.current) return;
    setDevices(remote);
    setSpeaker(selected);
    if (!remote.some((device) => device.session_id === targetSession)) setTargetSession('');
  }, [client, zone, targetSession]);

  const register = async () => {
    if (busy || registered) return;
    setBusy(true); setProblem(''); setNotice('');
    try {
      const capabilities = probeBrowserAudio();
      if (!capabilities.eligible) throw new Error(capabilities.reason ?? 'AudioWorklet unavailable');
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$/.test(zone)) throw new Error('Choose a valid, authorised zone ID');
      const device_id = 'browser_' + crypto.randomUUID().replaceAll('-', '');
      await client.register({
        device_id, zone_id: zone,
        label: 'Selecta browser (' + new Date().toLocaleDateString() + ')',
        browser_version: 'br64-browser-1', dsp_version: 'br64-dsp-core-1',
        capabilities: { audio_worklet: true, wasm: typeof WebAssembly !== 'undefined',
          webgpu: Boolean((navigator as Navigator & { gpu?: unknown }).gpu),
          can_play: engine.snapshot().tracks > 0,
          can_render: Boolean(navigator.storage?.getDirectory),
          mobile: false },
      });
      // Never reset a durable local speaker fence just because this tab reopened.
      try {
        const previous = Number(localStorage.getItem('selecta:browser-fence:' + workspaceId + ':' + zone) ?? '0');
        fence.current = Number.isSafeInteger(previous) && previous >= 0 ? previous : 0;
      } catch {
        // Cannot safely restore stale-owner protection across restarts.
        fence.current = 0;
        setNotice('Durable local fencing is unavailable. Remote takeovers must be refused until fixed.');
      }
      setRegistered(true);
      setNotice('Browser registered for this zone. Keep it foregrounded and confirm real sound on-site; no music was uploaded.');
      await refresh();
    } catch (error) {
      setProblem('Registration refused: ' + (error as Error).message);
    } finally { setBusy(false); }
  };

  async function acknowledge(cmd: BrowserEnvelope, status: 'rejected' | 'conflicted' | 'accepted' | 'applied',
    options?: { outputConfirmed?: boolean; outputSilent?: boolean; executed?: boolean }) {
    return client.ack(cmd.operation_id, { status, fenced_generation: cmd.expected_generation,
      output_confirmed: options?.outputConfirmed ?? false,
      output_silent: options?.outputSilent ?? false,
      execution_verified: options?.executed ?? false });
  }
  const processCommand = useCallback(async (cmd: BrowserEnvelope) => {
    // Signed identity, expiry and replay checks happened in BrowserSessionClient.next().
    // Never execute a portable-recipe command against an unassociated local queue.
    if (cmd.zone_id !== zone || cmd.workspace_id !== workspaceId ||
        (cmd.expected_recipe_revision !== null && cmd.action !== 'release_output')) {
      await acknowledge(cmd, 'rejected'); return;
    }
    if (cmd.expected_generation < fence.current) {
      await acknowledge(cmd, 'conflicted'); return;
    }
    const before = engine.snapshot();
    const playing = before.phase === 'playing' && before.ownership !== 'none';
    if (cmd.action === 'pause' || cmd.action === 'skip' ||
        cmd.action === 'seek' || cmd.action === 'set_volume') {
      if (!playing) { await acknowledge(cmd, 'rejected'); return; }
      await acknowledge(cmd, 'accepted');
      if (cmd.action === 'pause') await engine.pause();
      else if (cmd.action === 'skip') await engine.next();
      else if (cmd.action === 'seek') await engine.seek(Number(cmd.arguments.offset_ms) / 1000);
      else engine.setVolume(Number(cmd.arguments.volume) / 100);
      await acknowledge(cmd, 'applied', { executed: true });
      setNotice(cmd.action + ' applied locally. Physical output is not independently measured.');
      return;
    }
    if (cmd.action === 'play' && playing && before.soundCheck === 'user_confirmed') {
      await acknowledge(cmd, 'accepted');
      await acknowledge(cmd, 'applied', { executed: true, outputConfirmed: true });
      return;
    }
    // Takeover requires operator confirmation and active physical sound/silence evidence.
    // Do not fabricate unattended WebKit wake, physical silence, or a missing recipe.
    if (['play', 'prepare_output', 'release_output', 'activate_output'].includes(cmd.action)) {
      await acknowledge(cmd, 'accepted');
      setPending(cmd);
      setNotice(cmd.action + ' is pending confirmation at the actual browser speaker.');
      return;
    }
    await acknowledge(cmd, 'rejected');
  }, [client, engine, zone, workspaceId]);

  const observe = useCallback(async () => {
    if (!client.registered || processing.current || !alive.current) return;
    processing.current = true;
    try {
      const now = engine.snapshot();
      const current = Date.now() / 1000;
      await client.presence({
        foreground: document.visibilityState === 'visible',
        runtime_state: document.visibilityState === 'hidden' ? 'hidden' :
          now.phase === 'interrupted' || now.phase === 'error' ? 'interrupted' :
          now.tracks > 0 ? 'active' : 'suspended',
        capabilities: { audio_worklet: probeBrowserAudio().eligible,
          wasm: typeof WebAssembly !== 'undefined',
          webgpu: Boolean((navigator as Navigator & { gpu?: unknown }).gpu),
          can_play: now.tracks > 0,
          can_render: Boolean(navigator.storage?.getDirectory), mobile: false },
        source_ready: now.tracks > 0 && (now.phase === 'playing' || now.phase === 'paused'),
        source_count: now.tracks,
        source_checked_at: current,
        output_state: now.phase === 'playing' && now.soundCheck === 'user_confirmed'
          ? 'operator_confirmed' : 'unknown',
        output_checked_at: current,
        generation: fence.current, policy_version: 0, recipe_revision: null,
      });
      if (document.visibilityState !== 'visible' || pending) return;
      const next = await client.next();
      if (next) await processCommand(next);
      if (operation) {
        const currentReceipt = await client.operation(zone, operation);
        if (alive.current) {
          setReceipt(currentReceipt);
          if (['acknowledged', 'rejected', 'conflicted', 'superseded', 'expired'].includes(currentReceipt.state))
            setOperation(null);
        }
      }
    } catch (error) {
      if (alive.current) setProblem('Browser session needs attention: ' + (error as Error).message);
    } finally { processing.current = false; }
  }, [client, engine, pending, operation, processCommand, zone]);

  useEffect(() => {
    if (!registered) return;
    void observe();
    const timer = window.setInterval(() => void observe(), 2500);
    return () => window.clearInterval(timer);
  }, [registered, observe]);

  const confirmPending = async () => {
    const cmd = pending;
    if (!cmd || busy) return;
    setBusy(true); setProblem('');
    try {
      if (cmd.action === 'prepare_output') {
        if (engine.snapshot().tracks < 1 || engine.snapshot().phase === 'playing')
          throw new Error('Local recordings must be loaded and output must be silent before preparing.');
        await acknowledge(cmd, 'applied', { outputSilent: true });
      } else if (cmd.action === 'release_output') {
        await engine.stop();
        try { localStorage.setItem('selecta:browser-fence:' + workspaceId + ':' + zone,
          String(cmd.expected_generation)); } catch {
          throw new Error('Durable local fencing unavailable; cannot attest safe speaker release.');
        }
        fence.current = Math.max(fence.current, cmd.expected_generation);
        await acknowledge(cmd, 'applied', { outputSilent: true });
      } else if (cmd.action === 'activate_output' || cmd.action === 'play') {
        // User click is an explicit AudioContext activation gesture.
        if (engine.snapshot().phase !== 'playing') await engine.play();
        if (engine.snapshot().phase !== 'playing')
          throw new Error(engine.snapshot().error ?? 'Browser refused playback activation.');
        setNotice('Audio started; confirm physically hearing the intended speaker, then complete the pending command.');
        return;
      }
      setPending(null);
      setNotice(cmd.action + ' acknowledged after local operator confirmation.');
    } catch (error) {
      setProblem((error as Error).message);
    } finally { setBusy(false); }
  };
  const confirmSound = async () => {
    const cmd = pending;
    if (!cmd || (cmd.action !== 'activate_output' && cmd.action !== 'play')) return;
    if (engine.snapshot().phase !== 'playing') {
      setProblem('The local browser is not playing; physical sound cannot be confirmed.'); return;
    }
    setBusy(true);
    try {
      engine.confirmSound(true);
      await acknowledge(cmd, 'applied', { outputConfirmed: true, executed: true });
      fence.current = Math.max(fence.current, cmd.expected_generation);
      setPending(null);
      setNotice('Operator-confirmed sound; command acknowledged by Cloud.');
    } catch (error) {
      setProblem((error as Error).message);
    } finally { setBusy(false); }
  };
  const rejectPending = async () => {
    const cmd = pending;
    if (!cmd) return;
    try { await acknowledge(cmd, 'rejected'); }
    catch (error) { setProblem((error as Error).message); }
    setPending(null);
  };

  const send = async (action: 'pause' | 'skip' | 'play') => {
    if (!speaker?.speaker_session_id || !speaker.online || speaker.state !== 'audible' ||
        speaker.pending_transfer || busy) {
      setProblem('An online, operator-confirmed active speaker with no pending transfer is required.');
      return;
    }
    setBusy(true); setProblem(''); setNotice('');
    try {
      const operation_id = crypto.randomUUID().replaceAll('-', '');
      const result = await client.command(zone, {
        target_session_id: speaker.speaker_session_id,
        operation_id, idempotency_key: operation_id, action, arguments: {},
        expected_generation: speaker.generation,
        recipe_revision: null, policy_version: 0,
      });
      setReceipt(result); setOperation(operation_id);
      setNotice(action + ' requested. This is only queued; wait for the speaker acknowledgement.');
    } catch (error) { setProblem((error as Error).message); }
    finally { setBusy(false); }
  };

  return <section className="cloud-card" aria-label="Authenticated browser speaker control">
    <h3>Browser speaker session and remote</h3>
    <p>Cloud carries signed metadata-only commands. Only this device has its recordings.
      A queued command never proves that another speaker produced sound.</p>
    <label>Authorised zone ID
      <input aria-label="Speaker zone ID" value={zone} onChange={(event) => setZone(event.target.value)}
        disabled={registered || busy} maxLength={128} />
    </label>
    <div className="browser-player-controls">
      <button type="button" disabled={registered || busy} onClick={() => void register()}>Register this browser as a player</button>
      <button type="button" disabled={busy} onClick={() => void refresh().catch((error: Error) => setProblem(error.message))}>Refresh speakers</button>
      {registered && <button type="button" onClick={() => {
        void client.revoke().then(() => { setRegistered(false); setPending(null); })
          .catch((error: Error) => setProblem(error.message));
      }}>Revoke this browser session</button>}
    </div>
    <p role="status">This device: {registered ? 'registered, foreground activity required' : 'not registered'}.
      Actual speaker: {speaker?.speaker_session_id ?? 'none'} · {speaker?.state ?? 'unverified'} · generation {speaker?.generation ?? 0}.</p>
    {devices.length > 0 && <p>Known browser sessions in this zone: {devices.length}. Remote music is never downloaded here.</p>}
    {speaker?.state === 'audible' && speaker.online &&
      <div className="browser-player-controls">
        <button type="button" disabled={busy || !!operation} onClick={() => void send('pause')}>Request pause</button>
        <button type="button" disabled={busy || !!operation} onClick={() => void send('skip')}>Request skip</button>
        <button type="button" disabled={busy || !!operation} onClick={() => void send('play')}>Request play (on-site confirmation may be required)</button>
      </div>}
    {pending && <div role="alertdialog" aria-label="On-site speaker command confirmation">
      <p>Pending signed {pending.action} for this browser. A physical operator must verify the actual device output.
        Do not confirm silence if an older/offline speaker may still be sounding.</p>
      <button type="button" disabled={busy} onClick={() => void confirmPending()}>
        {pending.action === 'release_output' || pending.action === 'prepare_output'
          ? 'Confirm local speaker is silent' : 'Tap to activate sound here'}
      </button>
      {(pending.action === 'play' || pending.action === 'activate_output') &&
        <button type="button" disabled={busy || engine.snapshot().phase !== 'playing'}
          onClick={() => void confirmSound()}>I hear the intended speaker</button>}
      <button type="button" disabled={busy} onClick={() => void rejectPending()}>Reject command</button>
    </div>}
    {receipt && <p role="status">Command {receipt.operation_id}: <strong>{receipt.state}</strong> (not automatically verified audible)</p>}
    {notice && <p role="status">{notice}</p>}
    {problem && <p role="alert">{problem}</p>}
  </section>;
}
