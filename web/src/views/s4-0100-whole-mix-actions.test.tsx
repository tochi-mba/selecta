import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';
import { MixScope } from './mixScope';

/**
 * S4-0100-07: the whole-mix actions (preview, save a copy, export, new, clear) sit in one group in
 * the editor header, in one order: play first, then keep and export, then leave or remove last.
 * Every one is a real button with its own name, and Tab reaches them in the order they are seen.
 * A draft keeps the same shape with its own actions.
 */
function Current({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={(data: MixData) => setMix(data.mix)}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />
  );
}

const group = () => document.querySelector('.editor-actions') as HTMLElement;
const names = () => [...group().querySelectorAll<HTMLElement>('button, a')].map((node) => node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '');

describe('S4-0100-07 whole-mix action grouping', () => {
  it('the current mix keeps preview, save a copy, export, new and clear together, in a fixed order', () => {
    render(<Current start={songs(seam('ready', 'a'))} />);
    const order = names();
    const at = (name: string) => order.findIndex((label) => label.includes(name));
    for (const name of ['Play from the top', 'Save a copy', 'Download audio', 'New mix', 'Clear']) expect(at(name), name).toBeGreaterThanOrEqual(0);
    expect(at('Play from the top')).toBe(0);
    expect(at('Play from the top')).toBeLessThan(at('Save a copy'));
    expect(at('Save a copy')).toBeLessThan(at('Download audio'));
    expect(at('Download audio')).toBeLessThan(at('New mix'));
    expect(at('New mix')).toBeLessThan(at('Clear'));
    // the one destructive action is last and looks it
    expect(order[order.length - 1]).toContain('Clear');
    expect(within(group()).getByRole('button', { name: 'Clear' })).toHaveClass('destructive');
    expect(within(group()).getByRole('button', { name: 'Play from the top' })).toHaveClass('primary');
  });

  it('Tab walks the group in the order it is shown, and every action has a name', async () => {
    render(<Current start={songs(seam('ready', 'a'))} />);
    const shown = [...group().querySelectorAll<HTMLElement>('button, a')];
    shown[0].focus();
    const walked = [document.activeElement];
    for (let step = 1; step < shown.length; step += 1) {
      await userEvent.tab();
      walked.push(document.activeElement);
    }
    expect(walked).toEqual(shown);
    for (const node of shown) expect((node.getAttribute('aria-label') ?? node.textContent ?? '').trim()).not.toBe('');
  });

  it('Save a copy says it opens a form and Clear asks before it clears', async () => {
    fakeBackend({});
    render(<Current start={songs(seam('ready', 'a'))} />);
    const copy = within(group()).getByRole('button', { name: 'Save a copy' });
    expect(copy).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(copy);
    expect(copy).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Name this mix' })).toHaveFocus();
    await userEvent.click(within(group()).getByRole('button', { name: 'Clear' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a draft keeps the same shape: play first, then copy and export, and delete last', () => {
    fakeBackend({ 'GET /drafts': { drafts: [], current: { name: 'Current', songs: 3, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false } });
    const player = new SetPlayer(() => [], () => {});
    render(
      <MixScope.Provider value={7}>
        <Mix status={status()} mix={songs(seam('ready', 'a'))} mixName="Friday" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
          refreshStatus={() => {}} player={player} now={player.state} stage={false} toggleStage={() => {}} draftPlace={null}
          playDraft={vi.fn(async () => {})} openDraft={vi.fn()} closeDraft={vi.fn()} setView={vi.fn()} notify={vi.fn()} renamedDraft={vi.fn()} />
      </MixScope.Provider>,
    );
    const order = names();
    const at = (name: string) => order.findIndex((label) => label.includes(name));
    expect(at('Play this mix')).toBe(0);
    for (const name of ['Copy', 'Download audio', 'Delete', 'Back to current mix']) expect(at(name), name).toBeGreaterThan(0);
    expect(at('Copy')).toBeLessThan(at('Download audio'));
    expect(at('Download audio')).toBeLessThan(at('Delete'));
  });
});
