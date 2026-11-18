import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioSession } from '../onboarding/deps';
import type { CapabilityRecord } from './capabilityRecord';
import type { VenueDeps } from './deps';
import type { FallbackContext } from './fallback';
import { VenuePosture } from './VenuePosture';

const WS = 'ws-venue';
const NOW = 1_800_000_000;
const PLACES: FallbackContext = { localFirst: true, devices: true, rooms: true, library: true };

class Target {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listen: () => void) { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(listen); }
  removeEventListener(type: string, listen: () => void) { this.listeners.get(type)?.delete(listen); }
  fire(type: string) { for (const listen of [...(this.listeners.get(type) ?? [])]) listen(); }
}

function recordFor(ok: boolean): CapabilityRecord {
  return {
    schema: 'selectadj/capability-record/1', key: 'k', identity_source: 'unknown', measured_at: NOW,
    tuple: { device_model: 'unknown', os_version: 'unknown', browser_engine: 'unknown', browser_version: 'unknown', engine_version: 'e', codec: 'mp3', media_source: 'local_file', output_type: 'unknown' },
    probes: {
      worklet: ok ? { ok: true, sampleRate: 48000, schedulingMisses: 0, blocks: 64 } : { ok: false, reason: 'The audio worklet loaded but never processed audio, so SelectaDJ cannot trust playback here.' },
      storage: { opfs: { supported: true }, space: { supported: false } },
      pickers: { directoryInput: { supported: true }, dirPicker: { supported: true } },
      codecs: { mp3: 'probably' }, benchmark: { ran: false, reason: 'test' }, outputSelection: false, wakeLockApi: true,
    },
  };
}

function setup(options: { probeOk?: boolean; battery?: boolean | null; openAudio?: string } = {}) {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  const doc = Object.assign(new Target(), { visibilityState: 'visible' });
  const devices = new Target();
  const battery = options.battery === null ? null : Object.assign(new Target(), { charging: options.battery ?? true });
  const sentinel = Object.assign(new Target(), { release: vi.fn(async () => {}) });
  let interrupt: () => void = () => {};
  const session: AudioSession = {
    probe: vi.fn(async () => ({ ok: true })),
    probeDetail: vi.fn(async () => (options.probeOk === false
      ? { ok: false as const, state: 'unsupported_here' as const, reason: 'no' }
      : { ok: true as const, sampleRate: 48000, schedulingMisses: 0, blocks: 64 })),
    wake: vi.fn(async () => true),
    playTone: vi.fn(async () => {}),
    confirmHeard: vi.fn(),
    markUnverified: vi.fn(),
    watchWakeLock: vi.fn(),
    onInterrupted: (listen) => { interrupt = listen; return () => {}; },
    dispose: vi.fn(),
  };
  const requestWakeLock = vi.fn(async () => ({ result: 'held' as const, sentinel }));
  const runSuite = vi.fn(async () => recordFor(options.probeOk !== false));
  const deps: Partial<VenueDeps> = {
    storage,
    openAudio: vi.fn(() => options.openAudio ?? session),
    requestWakeLock,
    battery: async () => battery,
    runSuite,
    watchDocument: doc,
    watchDevices: devices,
    now: () => NOW,
  };
  render(<VenuePosture workspaceId={WS} places={PLACES} deps={deps} />);
  return { session, doc, devices, battery, sentinel, requestWakeLock, runSuite, memory, interrupt: () => interrupt() };
}

const status = () => document.querySelector('[data-venue-status]')?.getAttribute('data-venue-status');

async function walkToReady(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Check this tablet' }));
  await user.click(await screen.findByRole('button', { name: 'It’s plugged in' }));
  await user.click(screen.getByRole('button', { name: 'Keep the screen on' }));
  await screen.findByText(/browser agreed to keep the screen on/);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('radio', { name: /A Bluetooth speaker/ }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('button', { name: /Start sound/ }));
  await user.click(await screen.findByRole('button', { name: /Play the check tone/ }));
  await user.click(await screen.findByRole('button', { name: /I heard it/ }));
  await waitFor(() => expect(status()).toBe('verified'));
}

afterEach(() => { window.location.hash = ''; });

describe('venue posture flow UI (BF-0460-02, BF-0460-03)', () => {
  it('walks every step and only a person’s “I heard it” confirms the sound', async () => {
    const user = userEvent.setup();
    const { session, runSuite, memory } = setup();
    await user.click(screen.getByRole('button', { name: 'Check this tablet' }));
    await screen.findByRole('button', { name: 'It’s plugged in' });
    expect(runSuite).toHaveBeenCalledOnce();
    expect(memory.get(`selecta.venue.record.${WS}`)).toContain('selectadj/capability-record/1');
    expect(status()).toBe('output_unverified');
    await user.click(screen.getByRole('button', { name: 'It’s plugged in' }));
    await user.click(screen.getByRole('button', { name: 'Keep the screen on' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /A Bluetooth speaker/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: /Start sound/ }));
    await user.click(await screen.findByRole('button', { name: /Play the check tone/ }));
    // The tone played, and the graph ran: still not confirmed until a person says so.
    await screen.findByRole('button', { name: /I heard it/ });
    expect(status()).toBe('output_unverified');
    expect(session.confirmHeard).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /I heard it/ }));
    await waitFor(() => expect(status()).toBe('verified'));
    expect(session.confirmHeard).toHaveBeenCalledWith(NOW);
  });

  it('a hidden tab, a released wake lock, a route change and a call each downgrade with the fix', async () => {
    const user = userEvent.setup();
    const { doc, devices, sentinel, requestWakeLock, interrupt } = setup();
    await walkToReady(user);

    act(() => { doc.visibilityState = 'hidden'; doc.fire('visibilitychange'); });
    expect(status()).toBe('uncertain');
    expect(screen.getByText(/Bring SelectaDJ back to the front/)).toBeInTheDocument();
    await act(async () => { doc.visibilityState = 'visible'; doc.fire('visibilitychange'); });
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
    expect(status()).toBe('output_unverified');
    expect(screen.getByText(/Something interrupted this tablet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Play the check tone again/ }));
    await user.click(await screen.findByRole('button', { name: /Play the check tone/ }));
    await user.click(await screen.findByRole('button', { name: /I heard it/ }));
    await waitFor(() => expect(status()).toBe('verified'));

    act(() => sentinel.fire('release'));
    expect(status()).toBe('uncertain');
    expect(screen.getByText(/Press Keep the screen on again/)).toBeInTheDocument();

    act(() => devices.fire('devicechange'));
    expect(screen.getByText(/The audio output changed. Play the check tone/)).toBeInTheDocument();

    act(() => interrupt());
    expect(status()).toBe('interrupted');
    expect(screen.getByRole('button', { name: 'Start sound again' })).toBeInTheDocument();
  });

  it('a tablet on battery is uncertain and says to plug in', async () => {
    const user = userEvent.setup();
    const { battery } = setup();
    await walkToReady(user);
    act(() => { battery!.charging = false; battery!.fire('chargingchange'); });
    expect(status()).toBe('uncertain');
    expect(screen.getByText(/Plug it into power/)).toBeInTheDocument();
  });

  it('a check remembered from an earlier visit is shown as history, never as confirmed', async () => {
    const user = userEvent.setup();
    const memory = new Map([[`selecta.venue.last-heard.${WS}`, String(NOW - 3600)]]);
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: vi.fn() };
    render(<VenuePosture workspaceId={WS} places={PLACES} deps={{ storage, battery: async () => null, runSuite: async () => recordFor(true), openAudio: () => ({ probe: async () => ({ ok: true }), wake: async () => true, playTone: async () => {}, confirmHeard: vi.fn(), markUnverified: vi.fn(), dispose: vi.fn() }), watchDocument: null, watchDevices: null, now: () => NOW }} />);
    await user.click(screen.getByRole('button', { name: 'Check this tablet' }));
    await waitFor(() => expect(status()).toBe('output_unverified'));
    expect(screen.getByText(/Last confirmed by a person at/)).toBeInTheDocument();
  });
});

describe('controller fallbacks (BF-0460-07)', () => {
  it('a device failing the probes gets controller, guest and library places with the reason', async () => {
    const user = userEvent.setup();
    setup({ probeOk: false });
    await user.click(screen.getByRole('button', { name: 'Check this tablet' }));
    expect(await screen.findByText(/never processed audio/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Control a player on another device' })).toHaveAttribute('href', '/account/devices');
    expect(screen.getByRole('link', { name: 'Show the request room' })).toHaveAttribute('href', '/rooms');
    expect(screen.getByRole('link', { name: 'Browse your library' })).toHaveAttribute('href', '/library');
    expect(screen.queryByRole('button', { name: 'Check this tablet' })).toBeNull();
  });

  it('a device whose browser cannot open audio falls back the same way', async () => {
    const user = userEvent.setup();
    setup({ openAudio: 'This browser has no Web Audio, so SelectaDJ cannot play here.' });
    await user.click(screen.getByRole('button', { name: 'Check this tablet' }));
    expect(await screen.findByText(/no Web Audio/)).toBeInTheDocument();
  });

  it('a deep link to the venue flow on a device without a worklet explains and offers the fallback at once', () => {
    window.location.hash = '#venue';
    const saved = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
    const savedContext = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = function AudioContext() {};
    delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
    try {
      setup();
      expect(screen.getByText(/The link you followed opens the venue player set-up/)).toBeInTheDocument();
      expect(screen.getByText(/no AudioWorklet/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Browse your library' })).toBeInTheDocument();
    } finally {
      (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = saved;
      (globalThis as { AudioContext?: unknown }).AudioContext = savedContext;
    }
  });
});
