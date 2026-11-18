import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccountFeatures } from '../../flags';
import type { ImportEvent, ImportSummary } from '../../media';
import { cancelImportSession, clearImportMarker, clearImportSession, importSnapshot } from '../importSession';
import type { AudioSession, SpineDeps } from './deps';
import { OnboardingSpine } from './OnboardingSpine';
import { FRESH, ImportTally, loadState, recordImportOutcome, settleVerifyLater, SpineState, storageKey } from './state';

const WS = 'ws-1';
const NOW = 1_800_000_000;
const request = vi.fn(async () => ({})) as unknown as <T>(path: string, init?: RequestInit) => Promise<T>;

function setup(options: { saved?: Partial<SpineState>; probe?: { ok: boolean; reason?: string }; openAudio?: string; importMusic?: SpineDeps['importMusic']; pickers?: SpineDeps['pickers'] } = {}) {
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
    pickers: options.pickers ?? { directoryInput: () => ({ supported: false }), dirPicker: () => ({ supported: false, reason: 'This browser has no folder picker, so SelectaDJ will ask you to choose files.' }) },
    importMusic: options.importMusic ?? vi.fn(async (_source, onProgress) => {
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

afterEach(async () => {
  // the import session is module-wide: settle and dismiss whatever a test left
  cancelImportSession();
  await act(async () => { await new Promise((settled) => setTimeout(settled, 0)); });
  act(() => clearImportSession());
  clearImportMarker(WS);
  setAccountFeatures(null);
});

const TALLY = (over: Partial<ImportTally> = {}): ImportTally => ({ imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false, ...over });

/** An import the test drives by hand. */
function heldImport() {
  let emit: (event: ImportEvent) => void = () => {};
  let finish: (summary: ImportSummary) => void = () => {};
  let signal: AbortSignal | null = null;
  const importMusic = vi.fn((_source: unknown, onProgress: (event: ImportEvent) => void, abort: AbortSignal) => {
    emit = onProgress;
    signal = abort;
    return new Promise<ImportSummary>((resolve) => {
      finish = resolve;
      abort.addEventListener('abort', () => resolve(TALLY({ cancelled: true })));
    });
  }) as unknown as SpineDeps['importMusic'];
  return { importMusic, emit: (event: ImportEvent) => act(() => emit(event)), finish: (summary: ImportSummary) => act(async () => finish(summary)), signal: () => signal };
}

const pickOne = (user: ReturnType<typeof userEvent.setup>) => user.upload(screen.getByLabelText('Choose music files'), new File(['x'], 'one.mp3', { type: 'audio/mpeg' }));

describe('verify never blocks (progressive import)', () => {
  it('counts against the total once it is known, and names the file being read', async () => {
    const user = userEvent.setup();
    const held = heldImport();
    setup({ importMusic: held.importMusic });
    await heading('Connect your music');
    await pickOne(user);
    await heading('Check your music');
    expect(screen.getByRole('status')).toHaveTextContent('0 checked so far. SelectaDJ is still counting the files in that folder.');
    expect(screen.getByRole('progressbar', { name: 'Checking your music' })).not.toHaveAttribute('value');
    held.emit({ kind: 'collected', total: 3, skipped: 0 });
    held.emit({ kind: 'file', name: 'one.mp3', stage: 'hashing' });
    held.emit({ kind: 'file', name: 'one.mp3', stage: 'done', songId: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 checked so far. You can keep going; checking continues in the background.');
    expect(screen.getByRole('progressbar', { name: 'Checking your music' })).toHaveAttribute('value', '1');
    expect(screen.getByText('Now: one.mp3')).toBeVisible();
    noForbiddenWords();
  });

  it('continues while it finishes, leaving verify unsettled until the import lands', async () => {
    const user = userEvent.setup();
    const held = heldImport();
    const { saved } = setup({ importMusic: held.importMusic });
    await pickOne(user);
    await heading('Check your music');
    await user.click(screen.getByRole('button', { name: 'Continue while it finishes' }));
    await heading('Check this device');
    expect(saved().outcomes).toEqual({ connect: 'done' });
    expect(held.signal()?.aborted).toBe(false);
    await held.finish(TALLY({ imported: 2, duplicates: 1 }));
    await waitFor(() => expect(saved().outcomes.verify).toBe('done'));
    expect(saved().imported).toMatchObject({ imported: 2, duplicates: 1 });
    expect(saved().step).toBe('capability');
  });

  it('marks verify skipped when an import the member moved past added nothing', async () => {
    const user = userEvent.setup();
    const held = heldImport();
    const { saved } = setup({ importMusic: held.importMusic });
    await pickOne(user);
    await user.click(await screen.findByRole('button', { name: 'Continue while it finishes' }));
    await heading('Check this device');
    await held.finish(TALLY({ failed: 1 }));
    await waitFor(() => expect(saved().outcomes.verify).toBe('skipped'));
  });

  it('has no early continue with cloud.progressive_import off', async () => {
    setAccountFeatures({ 'cloud.progressive_import': false });
    const user = userEvent.setup();
    const held = heldImport();
    setup({ importMusic: held.importMusic });
    await pickOne(user);
    await heading('Check your music');
    expect(screen.queryByRole('button', { name: 'Continue while it finishes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop here' })).toBeVisible();
  });

  it('stops the import from Stop here', async () => {
    const user = userEvent.setup();
    const held = heldImport();
    setup({ importMusic: held.importMusic });
    await pickOne(user);
    await user.click(await screen.findByRole('button', { name: 'Stop here' }));
    expect(held.signal()?.aborted).toBe(true);
    expect(await screen.findByText(/You stopped part way/)).toBeVisible();
  });

  it('keeps importing when the spine unmounts with cloud.progressive_import on', async () => {
    const user = userEvent.setup();
    const held = heldImport();
    const { view } = setup({ importMusic: held.importMusic });
    await pickOne(user);
    await heading('Check your music');
    view.unmount();
    expect(held.signal()?.aborted).toBe(false);
    expect(importSnapshot().phase).toBe('running');
  });

  it('stops the import when the spine unmounts with cloud.progressive_import off', async () => {
    setAccountFeatures({ 'cloud.progressive_import': false });
    const user = userEvent.setup();
    const held = heldImport();
    const { view } = setup({ importMusic: held.importMusic });
    await pickOne(user);
    await heading('Check your music');
    view.unmount();
    expect(held.signal()?.aborted).toBe(true);
  });

  it('starts a folder import over the picked folder, named by the folder', async () => {
    const user = userEvent.setup();
    const held = heldImport();
    const folder = { kind: 'directory' as const, name: 'Crates', values: async function* () {} };
    setup({ importMusic: held.importMusic, pickers: { directoryInput: () => ({ supported: false }), dirPicker: () => ({ supported: true }), pickDirectory: async () => folder } });
    await user.click(await screen.findByRole('button', { name: /Choose a folder/ }));
    await heading('Check your music');
    expect(held.importMusic).toHaveBeenCalledWith(folder, expect.any(Function), expect.any(AbortSignal));
    expect(importSnapshot().folder).toBe('Crates');
  });
});

describe('settling verify after the fact', () => {
  const past: SpineState = { ...FRESH, step: 'output', outcomes: { connect: 'done', capability: 'done' } };

  it('marks verify done for a member past it when songs landed, new or already there', () => {
    expect(settleVerifyLater(past, TALLY({ imported: 1 })).outcomes.verify).toBe('done');
    expect(settleVerifyLater(past, TALLY({ duplicates: 2 })).outcomes.verify).toBe('done');
  });

  it('marks verify skipped for a member past it when nothing landed', () => {
    expect(settleVerifyLater(past, TALLY({ failed: 3, cancelled: true })).outcomes.verify).toBe('skipped');
  });

  it('only records the tally for a member still on verify, and never moves the step', () => {
    const on: SpineState = { ...FRESH, step: 'verify', outcomes: { connect: 'done' } };
    const next = settleVerifyLater(on, TALLY({ imported: 4 }));
    expect(next.outcomes.verify).toBeUndefined();
    expect(next.step).toBe('verify');
    expect(next.imported).toEqual(TALLY({ imported: 4 }));
    expect(settleVerifyLater(past, TALLY({ imported: 1 })).step).toBe('output');
  });

  it('never overwrites an outcome the member already gave', () => {
    const settled: SpineState = { ...past, outcomes: { ...past.outcomes, verify: 'skipped' } };
    expect(settleVerifyLater(settled, TALLY({ imported: 5 })).outcomes.verify).toBe('skipped');
  });

  it('counts a finished spine as past verify', () => {
    expect(settleVerifyLater({ ...FRESH, step: 'remote', finished: true, outcomes: {} }, TALLY({ imported: 1 })).outcomes.verify).toBe('done');
  });

  it('records an outcome in storage once, and writes nothing the second time', () => {
    const memory = new Map([[storageKey(WS), JSON.stringify(past)]]);
    const setItem = vi.fn((key: string, value: string) => { memory.set(key, value); });
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem };
    recordImportOutcome(storage, WS, TALLY({ imported: 2 }));
    recordImportOutcome(storage, WS, TALLY({ imported: 2 }));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(loadState(storage, WS).outcomes.verify).toBe('done');
  });
});
