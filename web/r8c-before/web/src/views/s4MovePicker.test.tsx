import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/*
 * S4-0101-03: the redesigned move picker still offers every move the server lists (the list Selecta
 * offered before 4.0 is held in tests/test_s4_seam_settings.py), keeps a move it can't use visible but
 * disabled with its reason, and lets the keyboard alone reach and choose any usable move.
 */
const BEFORE_4: [string, string][] = [
  ['auto', 'Let Selecta pick'], ['bass_swap_blend', 'Blend'], ['vocal_ride', 'Vocal ride'],
  ['stem_arrange', 'Strip and land'], ['stem_intertwine', 'Intertwined stems'], ['filter_sweep', 'Filter sweep'],
  ['tempo_ramp', 'Tempo ramp'], ['word_blend', 'Word blend'], ['word_exchange', 'Call and response'],
  ['phrase_roll', 'Phrase roll'], ['word_cut', 'Word cut'], ['cut_on_one', 'Cut'], ['echo_out', 'Echo out'],
  ['delay_throw', 'Delay throw'], ['reverb_wash', 'Reverb wash'],
];
const NO_PHRASE = 'These two songs don’t share a phrase at a line end and a line start.';
const WORDS = new Set(['word_blend', 'word_exchange', 'phrase_roll', 'word_cut']);
const options = {
  moves: BEFORE_4.map(([name, label]) => ({
    name, label, description: `${label} words`, available: !WORDS.has(name), reason: WORDS.has(name) ? NO_PHRASE : null,
  })),
  exits: [], entries: [], lengths: [4, 8, 16, 32], links: [],
  studio: { available: false, reason: 'Turned off.' }, tempo_gap: 1, keys: ['8A', '8A'],
};

async function openPicker() {
  const calls = fakeBackend({ 'GET /mix/1/options': options, 'POST /mix/1/seam': { mix: [] }, 'POST /mix/1/render': {} });
  const player = new SetPlayer(() => [], () => {});
  render(
    <Mix status={status()} mix={songs(seam('ready', 'k'))} mixName="Test mix" canUndo={false} refreshMix={() => {}}
      setMixData={() => {}} refreshStatus={() => {}} player={player} now={player.state} setView={() => {}}
      notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Change' }));
  return { calls, group: within(await screen.findByRole('group', { name: 'How should this land?' })) };
}

describe('S4-0101-03 every move stays in the picker', () => {
  it('shows every move offered before 4.0, and the ones it can’t use are disabled with their reason', async () => {
    const { group } = await openPicker();
    for (const [name, label] of BEFORE_4) {
      const button = group.getByRole('button', { name: label });
      if (WORDS.has(name)) {
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', NO_PHRASE);
      } else {
        expect(button).toBeEnabled();
      }
    }
    const why = group.getAllByText(/moves are greyed out/).map((text) => text.closest<HTMLElement>('details.why-not')).find(Boolean)!;
    for (const [, label] of BEFORE_4.filter(([name]) => WORDS.has(name))) {
      expect(within(why).getByText(`${label}:`)).toBeInTheDocument();
    }
  });

  it('the keyboard alone reaches a move and chooses it, skipping the disabled ones', async () => {
    const { calls, group } = await openPicker();
    group.getByRole('button', { name: 'Let Selecta pick' }).focus();
    const order: string[] = [];
    for (let step = 0; step < 15; step += 1) {
      await userEvent.tab();
      const at = document.activeElement as HTMLButtonElement;
      if (!at.closest('.chips.moves')) break;
      order.push(at.textContent ?? '');
    }
    const usable = BEFORE_4.filter(([name]) => !WORDS.has(name)).map(([, label]) => label).slice(1);
    expect(order).toEqual(usable);
    // back to Echo out, then choose it with Enter
    while ((document.activeElement?.textContent ?? '') !== 'Echo out') await userEvent.tab({ shift: true });
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path === '/mix/1/seam')).toBe(true));
    expect(calls.find((call) => call.path === '/mix/1/seam')?.body).toMatchObject({ move: 'echo_out', soft: false });
  });
});
