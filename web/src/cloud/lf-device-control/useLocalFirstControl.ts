import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Api } from '../api';
import { httpLocalControl, type LocalControlAdapter } from './adapter';
import {
  COMMAND_TTL_MS, READINESS_FRESH_MS, TELEMETRY_FRESH_MS, isFresh,
  readinessReason, stageFor, type CommandKind, type CommandReceipt,
  type DeviceReadiness, type LocalCommand, type LocalDevice, type LocalSession, type TransportStage,
} from './contracts';

export interface PendingControl {
  id: string;
  kind: CommandKind;
  target: string;
  expectedGeneration: number;
  outputId: string | null;
  stage: TransportStage;
  message: string;
  submittedAt: number;
}

const operationId = () => crypto.randomUUID();

function confirmed(operation: PendingControl, session: LocalSession | null): boolean {
  if (!session || !isFresh(session.observed_at, TELEMETRY_FRESH_MS)) return false;
  if (operation.kind === 'takeover') {
    return session.speaker_device_id === operation.target &&
      session.generation > operation.expectedGeneration &&
      session.output_id === operation.outputId && session.output_state === 'audible' &&
      session.state === 'playing';
  }
  if (operation.kind === 'change_output') {
    return session.speaker_device_id === operation.target && session.output_id === operation.outputId &&
      session.output_state === 'audible';
  }
  if (session.speaker_device_id !== operation.target) return false;
  if (operation.kind === 'play') return session.state === 'playing' && session.output_state === 'audible';
  if (operation.kind === 'pause') return session.state === 'paused';
  // Skip is engine-applied, and fresh speaker telemetry means a delayed ACK isn't being
  // mistaken for an abandoned command. Track index is deliberately not guessed.
  return true;
}

/** A local engine owns all audio. This hook handles only bounded, authenticated metadata. */
export function useLocalFirstControl({
  api, workspaceId, adapter: injected,
}: { api: Api; workspaceId: string; adapter?: LocalControlAdapter }) {
  const adapter = useMemo(() => injected ?? httpLocalControl(api, workspaceId), [api, workspaceId, injected]);
  const [devices, setDevices] = useState<LocalDevice[]>([]);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [readiness, setReadiness] = useState<DeviceReadiness | null>(null);
  const [outputId, setOutputId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingControl | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refreshSeq = useRef(0);
  const activeOperation = useRef<string | null>(null);
  const sending = useRef(false);

  const here = devices.find((device) => device.this_device) ?? null;
  const speaker = devices.find((device) => device.device_id === session?.speaker_device_id) ?? null;
  const localOutput = here?.outputs.find((output) => output.id === outputId) ?? null;

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const [nextDevices, nextSession] = await Promise.all([adapter.listDevices(), adapter.session()]);
      if (seq !== refreshSeq.current) return;
      setDevices(nextDevices);
      setSession(nextSession);
      setError('');
    } catch (problem) {
      if (seq !== refreshSeq.current) return;
      setError((problem as Error).message || 'Local control is unavailable.');
      // Keep the last report and its original observation timestamp; never make it fresh.
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    const onNetwork = () => void refresh();
    window.addEventListener('online', onNetwork);
    return () => {
      ++refreshSeq.current;
      window.clearInterval(timer);
      window.removeEventListener('online', onNetwork);
    };
  }, [refresh]);

  useEffect(() => {
    if (!here) { setOutputId(null); return; }
    if (!here.outputs.some((output) => output.id === outputId)) {
      setOutputId(here.outputs.find((output) => output.health === 'ready')?.id ?? here.outputs[0]?.id ?? null);
    }
  }, [here, outputId]);

  const verify = useCallback(async (deviceId: string, revision: string, selectedOutput: string) => {
    setReadiness(null);
    try {
      const report = await adapter.availability(deviceId, revision, selectedOutput);
      if (report.target_device_id !== deviceId || report.recipe_revision !== revision || report.output_id !== selectedOutput) {
        throw new Error('The engine returned readiness for another device, output or recipe.');
      }
      setReadiness(report);
    } catch (problem) {
      setNotice((problem as Error).message || 'Could not verify local recordings.');
    }
  }, [adapter]);

  useEffect(() => {
    if (!here || !session?.recipe_revision || !outputId) { setReadiness(null); return; }
    let cancelled = false;
    setReadiness(null);
    adapter.availability(here.device_id, session.recipe_revision, outputId)
      .then((report) => {
        if (!cancelled && report.target_device_id === here.device_id &&
          report.recipe_revision === session.recipe_revision && report.output_id === outputId) setReadiness(report);
      })
      .catch(() => { if (!cancelled) setNotice('Local media readiness could not be verified.'); });
    return () => { cancelled = true; };
  }, [adapter, here?.device_id, session?.recipe_revision, outputId]);

  const run = useCallback(async (
    kind: CommandKind, target: string, current: LocalSession,
    args: Record<string, string | number | boolean | null> = {},
  ) => {
    if (sending.current) return;
    sending.current = true;
    const id = operationId();
    activeOperation.current = id;
    const request: LocalCommand = {
      schema_version: 1, operation_id: id, idempotency_key: id,
      workspace_id: workspaceId, target_device_id: target,
      expected_generation: current.generation,
      expected_recipe_revision: current.recipe_revision,
      expires_at: new Date(Date.now() + COMMAND_TTL_MS).toISOString(),
      command: kind, arguments: args,
    };
    const record: PendingControl = {
      id, kind, target, expectedGeneration: current.generation,
      outputId: kind === 'takeover' || kind === 'change_output' ? String(args.output_id ?? '') : current.output_id,
      stage: 'requested', message: 'Requesting local engine approval…', submittedAt: Date.now(),
    };
    setPending(record); setNotice(''); setError('');
    try {
      const result = await adapter.submit(request);
      if (activeOperation.current !== id) return;
      if (result.operation_id !== id) throw new Error('Mismatched operation acknowledgement.');
      const stage = stageFor(result, 'requested');
      setPending({ ...record, stage: stage === 'applied' ? 'queued' : stage,
        message: stage === 'failed' ? (result.reason ?? 'Local engine refused the request.') :
          stage === 'expired' ? 'Command expired before execution.' : 'Request queued; waiting for the local engine and output telemetry…' });
      await refresh();
    } catch (problem) {
      if (activeOperation.current === id) {
        // Transport failure may occur after a command was delivered: reconcile by ID.
        setPending({ ...record, stage: 'uncertain',
          message: `Request result unknown: ${(problem as Error).message}. Checking the local engine; do not repeat the action.` });
      }
    } finally {
      sending.current = false;
    }
  }, [adapter, refresh, workspaceId]);

  const takeOver = useCallback(async () => {
    if (!here || !outputId || !session?.recipe_revision || sending.current) return;
    setNotice('Checking current speaker, local music and physical output…');
    try {
      // Never act on an earlier card's cached readiness or a changed generation.
      const [current, latestDevices, latestReadiness] = await Promise.all([
        adapter.session(), adapter.listDevices(),
        adapter.availability(here.device_id, session.recipe_revision, outputId),
      ]);
      const freshHere = latestDevices.find((d) => d.this_device && d.device_id === here.device_id) ?? null;
      const refusal = readinessReason(freshHere, latestReadiness, current, outputId);
      if (refusal) { setNotice(refusal); return; }
      if (!current || !current.recipe_revision) return;
      const preflight = await adapter.preflight(here.device_id, current.recipe_revision, outputId, current.generation);
      if (!preflight.safe || !isFresh(preflight.expires_at, 0, Date.parse(preflight.expires_at)) ||
        preflight.target_device_id !== here.device_id || preflight.recipe_revision !== current.recipe_revision ||
        preflight.expected_generation !== current.generation || preflight.output_id !== outputId ||
        Date.parse(preflight.expires_at) <= Date.now()) {
        setNotice(preflight.reason ?? 'Destination preflight failed; the original speaker keeps playing.');
        return;
      }
      // The backend must fence and confirm release of the old engine before applying this.
      await run('takeover', here.device_id, current, { output_id: outputId, preflight_id: preflight.preflight_id });
    } catch (problem) {
      setNotice(`No takeover was requested: ${(problem as Error).message}. The original speaker is unchanged.`);
    }
  }, [adapter, here, outputId, run, session?.recipe_revision]);

  const sendTransport = useCallback(async (kind: 'play' | 'pause' | 'skip') => {
    try {
      const current = await adapter.session();
      if (!current?.speaker_device_id || !isFresh(current.observed_at, TELEMETRY_FRESH_MS)) {
        setNotice('The speaker report is stale. Reconnect and verify it before controlling playback.');
        return;
      }
      if (!current.original_can_be_fenced) {
        setNotice('The speaker is partitioned; remote controls are unsafe until it reconnects.');
        return;
      }
      await run(kind, current.speaker_device_id, current);
    } catch (problem) { setNotice((problem as Error).message); }
  }, [adapter, run]);

  const changeOutput = useCallback(async (nextOutput: string) => {
    if (!session?.speaker_device_id || !session.recipe_revision || sending.current) return;
    try {
      const current = await adapter.session();
      const target = devices.find((d) => d.device_id === current?.speaker_device_id);
      const output = target?.outputs.find((o) => o.id === nextOutput);
      if (!current || !target || output?.health !== 'ready' ||
        !current.recipe_revision || !isFresh(current.observed_at, TELEMETRY_FRESH_MS) ||
        !current.original_can_be_fenced) {
        setNotice('Output change blocked: engine, speaker generation or output is unverified.');
        return;
      }
      const status = await adapter.availability(target.device_id, current.recipe_revision, nextOutput);
      if (status.status !== 'ready' || !isFresh(status.last_verified_at, READINESS_FRESH_MS) ||
        status.tracks.some((t) => t.state !== 'ready') ||
        status.transition_states.some((t) => t.state !== 'ready')) {
        setNotice('Output change blocked: local media/transition readiness is not verified.');
        return;
      }
      const prepared = await adapter.preflight(target.device_id, current.recipe_revision, nextOutput, current.generation);
      if (!prepared.safe || Date.parse(prepared.expires_at) <= Date.now() ||
        prepared.target_device_id !== target.device_id || prepared.expected_generation !== current.generation ||
        prepared.recipe_revision !== current.recipe_revision || prepared.output_id !== nextOutput) {
        setNotice(prepared.reason ?? 'Output preflight failed. Existing output remains active.');
        return;
      }
      await run('change_output', target.device_id, current, { output_id: nextOutput, preflight_id: prepared.preflight_id });
    } catch (problem) { setNotice(`Output remains unchanged: ${(problem as Error).message}`); }
  }, [adapter, devices, run, session?.recipe_revision, session?.speaker_device_id]);

  // Poll operation and actual local telemetry separately: a queued/accepted/HTTP ACK is never
  // interpreted as sound. Lost/late ACKs remain uncertain, never retried with a new UUID.
  useEffect(() => {
    if (!pending || ['applied', 'failed', 'expired'].includes(pending.stage)) return;
    let cancelled = false;
    const check = async () => {
      try {
        const [receipt, observed] = await Promise.all([adapter.operation(pending.id), adapter.session()]);
        if (cancelled || activeOperation.current !== pending.id || receipt.operation_id !== pending.id) return;
        setSession(observed);
        const stage = stageFor(receipt, pending.stage);
        if (stage === 'failed' || stage === 'expired') {
          setPending({ ...pending, stage, message: receipt.reason ?? 'Operation rejected or expired; check the speaker.' });
          return;
        }
        if (stage === 'applied' && confirmed(pending, observed)) {
          setPending({ ...pending, stage: 'applied', message: 'Local engine applied the change; fresh output telemetry confirmed.' });
        } else if (Date.now() - pending.submittedAt > COMMAND_TTL_MS) {
          setPending({ ...pending, stage: 'uncertain',
            message: 'The result cannot be confirmed. The previous speaker may still be playing; refresh device status.' });
        } else {
          setPending({ ...pending, stage: stage === 'applied' ? 'queued' : stage,
            message: stage === 'applied' ? 'Engine applied the command, but actual output is not yet verified.' :
              'Command queued; waiting for engine execution.' });
        }
      } catch {
        if (!cancelled && Date.now() - pending.submittedAt > COMMAND_TTL_MS) {
          setPending({ ...pending, stage: 'uncertain',
            message: 'Acknowledgement delayed or lost; do not repeat the command without reconciling.' });
        }
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [adapter, pending?.id, pending?.stage, pending?.submittedAt]);

  const blocked = readinessReason(here, readiness, session, outputId);
  return {
    adapter, devices, here, speaker, session, readiness, outputId, localOutput, setOutputId,
    blocked, pending, error, notice, refresh, verify, takeOver, sendTransport, changeOutput,
  };
}
