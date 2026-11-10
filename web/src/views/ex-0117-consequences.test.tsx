import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, songs, status } from '../test/backend';
import { Mixes } from './Mixes';

// EX-0117-04: whether the listener is playing, paused or idle, Play, Shape first and
// Save draft each say, before anything happens, whether current music is replaced.

const card: VibeCard = {
  key: 'peak', name: 'Peak time', group: 'The moment', family: null, blurb: 'Peak words', songs: 40, ready: true,
  needs: 0, artists: ['Someone'], tempo: [100, 124], moves: 'Long blends', seconds: 3900,
};

function show(phase: 'playing' | 'paused' | 'idle') {
  const calls = fakeBackend({
    'GET /vibes': [card],
    'POST /vibes/peak/build': { mix: songs(), name: 'Peak time', can_undo: true, count: 12 },
  });
  const player = new SetPlayer(() => [], () => {});
  vi.spyOn(player, 'playFrom').mockResolvedValue(undefined);
  const setMixData = vi.fn();
  render(
    <Mixes status={status()} mix={phase === 'idle' ? [] : songs()} mixName="Current" canUndo={false} refreshMix={() => {}}
      setMixData={setMixData} refreshStatus={() => {}} player={player} now={{ ...player.state, phase }} setView={() => {}}
      notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
  return { calls, setMixData };
}

const builds = (calls: { method: string; path: string }[]) => calls.filter((call) => call.method === 'POST' && call.path.includes('/vibes/peak/build'));

describe('EX-0117-04 Play, Edit and Save consequences', () => {
  for (const phase of ['playing', 'paused'] as const) {
    it(`${phase}: Play asks before replacing, names what it replaces, and offers the draft instead`, async () => {
      const { calls, setMixData } = show(phase);
      const choice = within((await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!);
      fireEvent.click(choice.getByRole('button', { name: 'Play' }));
      const dialog = within(screen.getByRole('dialog', { name: 'Replace Current?' }));
      expect(dialog.getByRole('button', { name: 'Replace and play' })).toBeInTheDocument();
      expect(dialog.getByRole('button', { name: 'Save as draft instead' })).toBeInTheDocument();
      expect(dialog.getByText(/leaves what’s playing exactly as it is/)).toBeInTheDocument();
      expect(builds(calls)).toHaveLength(0);
      fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
      expect(setMixData).not.toHaveBeenCalled();
    });

    it(`${phase}: Save draft never asks and never replaces the current mix`, async () => {
      const { calls, setMixData } = show(phase);
      const choice = within((await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!);
      fireEvent.click(choice.getByRole('button', { name: 'Save Peak time as a draft' }));
      expect(screen.queryByRole('dialog', { name: 'Replace Current?' })).toBeNull();
      await waitFor(() => expect(builds(calls)).toHaveLength(1));
      expect(builds(calls)[0].path).toContain('as_draft=true');
      expect(setMixData).not.toHaveBeenCalled();
    });
  }

  it('idle: nothing is playing, so Play builds straight away with no replacement question', async () => {
    const { calls, setMixData } = show('idle');
    const choice = within((await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!);
    fireEvent.click(choice.getByRole('button', { name: 'Play' }));
    expect(screen.queryByRole('dialog', { name: 'Replace Current?' })).toBeNull();
    await waitFor(() => expect(builds(calls)).toHaveLength(1));
    expect(builds(calls)[0].path).not.toContain('as_draft');
    await waitFor(() => expect(setMixData).toHaveBeenCalledOnce());
  });
});

// EX-0117-02: length joins feel, stems, energy and destination as a remembered choice.
describe('EX-0117-02 the chosen length is remembered', () => {
  const pick: VibeCard = { ...card, key: 'pick', name: 'Selecta’s pick', group: '' };
  function open() {
    fakeBackend({ 'GET /vibes': [pick] });
    const player = new SetPlayer(() => [], () => {});
    return render(
      <Mixes status={status()} mix={[]} mixName="" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
        refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}}
        stage={false} toggleStage={() => {}} />,
    );
  }
  const lengths = () => within(screen.getByRole('group', { name: 'How long, roughly' }));

  afterEach(() => { setFlags(null); window.localStorage.clear(); });

  it('a new visit starts on the length chosen last time', () => {
    window.localStorage.clear();
    const first = open();
    fireEvent.click(lengths().getByRole('button', { name: 'About 1 hour' }));
    first.unmount();
    open();
    expect(lengths().getByRole('button', { name: 'About 1 hour' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a nonsense saved value falls back to 30 minutes', () => {
    window.localStorage.setItem('selecta.mixLength', '999');
    open();
    expect(lengths().getByRole('button', { name: 'About 30 min' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('with the flag off nothing is kept and each visit starts at 30 minutes', () => {
    setFlags({ 'mixes.shaping.remember_length': false });
    window.localStorage.clear();
    const first = open();
    fireEvent.click(lengths().getByRole('button', { name: 'About 2 hours' }));
    expect(window.localStorage.getItem('selecta.mixLength')).toBeNull();
    first.unmount();
    open();
    expect(lengths().getByRole('button', { name: 'About 30 min' })).toHaveAttribute('aria-pressed', 'true');
  });
});
