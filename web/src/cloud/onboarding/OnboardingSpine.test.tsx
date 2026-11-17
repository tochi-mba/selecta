import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AudioSession, SpineDeps } from './deps';
import { OnboardingSpine } from './OnboardingSpine';
import { loadState, SpineState, storageKey } from './state';

const WS = 'ws-1';
const NOW = 1_800_000_000;
const request = vi.fn(async () => ({})) as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;

function setup(options: { saved?: Partial<SpineState>; probe?: { ok: boolean; reason?: string }; openAudio?: string } = {}) {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  if (options.saved) memory.set(storageKey(WS), JSON.stringify({ version: 1, outcomes: {}, ...options.saved }));
  const session: AudioSession = {
    probe: vi.fn(async () => options.probe ?? { ok: true }),
    wake: vi.fn(async () => true),
    playTone: vi.fn(async () => {}),
    confirmHeard: vi.fn(),
    markUnverified: vi.fn(),
    watchWakeLock: vi.fn(),
    dispose: vi.fn(),
  };
  const deps: Partial<SpineDeps> = {
    storage,
    pickers: { directoryInput: () => ({ supported: false }), dirPicker: () => ({ supported: false, reason: 'This browser has no folder picker, so SelectaDJ will ask you to choose files.' }) },
    importMusic: vi.fn(async (_source, onProgress) => {
      onProgress({ kind: 'file', name: 'one.mp3', stage: 'hashing' });
      onProgress({ kind: 'file', name: 'one.mp3', stage: 'done', songId: 1 });
      return { imported: 1, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false };
    }),
    openAudio: vi.fn(() => options.openAudio ?? session),
    requestWakeLock: vi.fn(async () => ({ result: 'unsupported' as const })),
    now: () => NOW,
  };
  const onDone = vi.fn();
  const view = render(<OnboardingSpine request={request} workspaceId={WS} onDone={onDone} deps={deps} />);
  const saved = () => loadState(storage, WS);
  return { session, deps, onDone, saved, storage, view };
}

const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
/** No step tells a default account to install, upload or wait for processing (ADR-0463). */
const noForbiddenWords = () => expect(document.body.textContent).not.toMatch(/install|upload|processing/i);

describe('onboarding spine progression (BF-0463-02)', () => {
  it('walks connect to remote, recording each step truthfully', async () => {
    const user = userEvent.setup();
    const { session, saved, onDone } = setup();
    await heading('Connect your music');
    noForbiddenWords();
    expect(screen.queryByText('Choose a folder')).toBeNull();
    expect(screen.getByText(/no folder picker/)).toBeInTheDocument();

    await user.upload(screen.getByLabelText('Choose music files'), new File(['x'], 'one.mp3', { type: 'audio/mpeg' }));
    await heading('Check your music');
    expect(await screen.findByText('1 song is in your library.')).toBeInTheDocument();
    noForbiddenWords();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await heading('Check this device');
    noForbiddenWords();
    await user.click(screen.getByRole('button', { name: 'Check this device' }));
    expect(session.probe).toHaveBeenCalled();

    await heading('Choose where the sound goes');
    await user.click(screen.getByRole('radio', { name: /A Bluetooth speaker/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await heading('Start sound');
    await user.click(screen.getByRole('button', { name: /Start sound/ }));
    expect(session.wake).toHaveBeenCalled();

    await heading('Sound check');
    await user.click(screen.getByRole('button', { name: /Play the check tone/ }));
    await user.click(await screen.findByRole('button', { name: /I heard it/ }));
    expect(session.confirmHeard).toHaveBeenCalledWith(NOW);

    await heading('Keep the screen awake');
    await user.click(screen.getByRole('button', { name: 'Ask to keep the screen on' }));
    expect(await screen.findByText(/can’t keep the screen on by itself/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await heading('Control from your phone');
    noForbiddenWords();
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    await heading('You’re set up');

    const state = saved();
    expect(state.finished).toBe(true);
    expect(state.outcomes).toEqual({ connect: 'done', verify: 'done', capability: 'done', output: 'done', start: 'done', soundcheck: 'done', keepawake: 'skipped', remote: 'skipped' });
    expect(state.heardAt).toBe(NOW);
    expect(state.output).toBe('bluetooth');
    await user.click(screen.getByRole('button', { name: 'Open SelectaDJ' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('lets a member look around first, skipping connect and verify honestly', async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(await screen.findByRole('button', { name: /connect music later/ }));
    await heading('Check this device');
    expect(saved().outcomes).toEqual({ connect: 'skipped', verify: 'skipped' });
  });
});

describe('onboarding resume', () => {
  it('opens at the saved step for this account', async () => {
    setup({ saved: { step: 'output', outcomes: { connect: 'done', verify: 'done', capability: 'done' } } });
    await heading('Choose where the sound goes');
    expect(screen.getByRole('list', { name: 'Steps' }).querySelector('[aria-current="step"]')).toHaveTextContent('Choose where the sound goes');
  });

  it('survives abandoning the tab part way', async () => {
    const user = userEvent.setup();
    const first = setup();
    await user.click(await screen.findByRole('button', { name: /connect music later/ }));
    await heading('Check this device');
    await user.click(screen.getByRole('button', { name: 'Finish later' }));
    expect(first.onDone).toHaveBeenCalled();
    const stored = first.storage.getItem(storageKey(WS));
    first.view.unmount();
    const second = setup({ saved: JSON.parse(stored!) as SpineState });
    await heading('Check this device');
    expect(second.saved().finished).toBeUndefined();
  });

  it('never trusts a saved sound check without the time a person confirmed it', () => {
    const memory = new Map([[storageKey(WS), JSON.stringify({ version: 1, step: 'keepawake', outcomes: { soundcheck: 'done' } })]]);
    const state = loadState({ getItem: (key) => memory.get(key) ?? null, setItem: () => {} }, WS);
    expect(state.outcomes.soundcheck).toBe('unverified');
  });

  it('starts fresh when storage is unreadable', () => {
    const state = loadState({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} }, WS);
    expect(state.step).toBe('connect');
  });
});

describe('sound check truth (BF-0460-03)', () => {
  const atSoundcheck = { step: 'soundcheck' as const, output: 'bluetooth' as const, outcomes: { connect: 'done' as const, verify: 'done' as const, capability: 'done' as const, output: 'done' as const, start: 'done' as const } };

  it('never passes by itself after the tone plays', async () => {
    const user = userEvent.setup();
    const { session, saved } = setup({ saved: atSoundcheck });
    await heading('Sound check');
    expect(screen.getByRole('status')).toHaveTextContent('Sound not confirmed');
    await user.click(screen.getByRole('button', { name: /Play the check tone/ }));
    await screen.findByRole('button', { name: /I heard it/ });
    await new Promise((settled) => setTimeout(settled, 50));
    expect(session.playTone).toHaveBeenCalled();
    expect(session.confirmHeard).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sound check');
    expect(saved().outcomes.soundcheck).toBeUndefined();
    expect(saved().heardAt).toBeUndefined();
  });

  it('walks the output routes when nothing was heard, and leaves the sound unconfirmed', async () => {
    const user = userEvent.setup();
    const { session, saved } = setup({ saved: atSoundcheck });
    await user.click(await screen.findByRole('button', { name: /Play the check tone/ }));
    await user.click(await screen.findByRole('button', { name: 'I heard nothing' }));
    expect(session.markUnverified).toHaveBeenCalled();
    const help = screen.getByRole('region', { name: 'Find the sound' });
    expect(help).toHaveTextContent('Bluetooth settings');
    expect(screen.queryByRole('button', { name: /I heard it/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sound check');
    await user.click(screen.getByRole('button', { name: 'Carry on without a confirmed sound' }));
    await heading('Keep the screen awake');
    expect(saved().outcomes.soundcheck).toBe('unverified');
    expect(saved().heardAt).toBeUndefined();
    expect(session.confirmHeard).not.toHaveBeenCalled();
  });

  it('lets the member replay the tone after hearing nothing and then confirm', async () => {
    const user = userEvent.setup();
    const { session, saved } = setup({ saved: atSoundcheck });
    await user.click(await screen.findByRole('button', { name: /Play the check tone/ }));
    await user.click(await screen.findByRole('button', { name: 'I heard nothing' }));
    await user.click(screen.getByRole('button', { name: /Play the tone again/ }));
    await user.click(await screen.findByRole('button', { name: /I heard it/ }));
    expect(session.confirmHeard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saved().outcomes.soundcheck).toBe('done'));
  });
});

describe('capability fork (ADR-0460 controller fallback)', () => {
  it('forks to the controller experience with the reason when the probe fails', async () => {
    const user = userEvent.setup();
    const { saved } = setup({ saved: { step: 'capability', outcomes: { connect: 'done', verify: 'done' } }, probe: { ok: false, reason: 'This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.' } });
    await user.click(await screen.findByRole('button', { name: 'Check this device' }));
    await heading('Control from your phone');
    expect(screen.getByRole('region', { name: 'This device can be your controller' })).toHaveTextContent('no AudioWorklet');
    expect(screen.queryByRole('button', { name: 'Check this device' })).toBeNull();
    expect(saved().outcomes).toMatchObject({ capability: 'not_here', output: 'not_here', start: 'not_here', soundcheck: 'not_here', keepawake: 'not_here' });
    expect(saved().capability).toEqual({ ok: false, reason: 'This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.' });
  });

  it('forks too when the device will not open audio at all', async () => {
    const user = userEvent.setup();
    setup({ saved: { step: 'capability', outcomes: {} }, openAudio: 'This browser has no Web Audio, so SelectaDJ cannot play here.' });
    await user.click(await screen.findByRole('button', { name: 'Check this device' }));
    await heading('Control from your phone');
    expect(screen.getByText('This browser has no Web Audio, so SelectaDJ cannot play here.')).toBeInTheDocument();
  });
});
