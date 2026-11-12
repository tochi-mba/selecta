import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MixData, MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/** GP-0250: one logical edit target at a time, and every audition says what it plays. */

function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player} now={player.state}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />
  );
}

const ready = (key: string) => seam('ready', key, { label: 'Blend', style: 'bass_swap_blend', a_source_start: 60, b_source_end: 30, preview_seam: 20 });
const options = { moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }], exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };

const songButton = (title: string) => screen.getAllByRole('button').find((button) => button.classList.contains('song-select') && button.textContent === title)!;
const current = () => [...document.querySelectorAll('.song-select[aria-current="true"]')].map((button) => button.textContent);
const openSeams = () => [...document.querySelectorAll('.seam-name[aria-expanded="true"]')].length;
const highlighted = () => [...document.querySelectorAll('li.song.selected, li.seam.open')].length;

afterEach(() => vi.unstubAllGlobals());

describe('GP-0250 edit and inspector selection', () => {
  it('GP-0250-01/02 a selected song and a selected transition never share the highlight', async () => {
    fakeBackend({ 'GET /mix/1/options': options, 'GET /mix/2/options': options });
    render(<Harness start={songs(ready('a'), ready('b'))} />);
    await userEvent.click(songButton('Song 2'));
    expect(current()).toEqual(['Song 2']);
    expect(openSeams()).toBe(0);
    expect(highlighted()).toBe(1);
    expect(screen.getByRole('complementary', { name: 'This song' })).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Hear it' })[1]);
    expect(current()).toEqual([]);
    expect(openSeams()).toBe(1);
    expect(highlighted()).toBe(1);
    const side = screen.getByRole('complementary', { name: 'This transition' });
    expect(within(side).getByText('Song 2')).toBeInTheDocument();
    expect(within(side).getByText('Song 3')).toBeInTheDocument();
  });

  it('GP-0250-03 song, transition and whole-mix auditions each say what they play', async () => {
    fakeBackend({ 'GET /mix/1/options': options, 'GET /mix/2/options': options });
    render(<Harness start={songs(ready('a'), ready('b'))} />);
    const hears = screen.getAllByRole('button', { name: 'Hear it' });
    expect(hears.map((button) => button.getAttribute('aria-description'))).toEqual([
      'Plays only the transition from Song 1 into Song 2',
      'Plays only the transition from Song 2 into Song 3',
    ]);
    expect(screen.getByRole('button', { name: 'Play from Song 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play from the top' })).toBeInTheDocument();
    await userEvent.click(songButton('Song 2'));
    expect(within(screen.getByRole('complementary', { name: 'This song' })).getByRole('button', { name: /Play from here/ })).toBeInTheDocument();
    const names = new Set(screen.getAllByRole('button').map((button) => `${button.textContent}|${button.getAttribute('aria-label') ?? ''}|${button.getAttribute('aria-description') ?? ''}`).filter((name) => /Play|Hear/.test(name)));
    expect(names.size).toBe(screen.getAllByRole('button').filter((button) => /Play|Hear/.test(`${button.textContent}${button.getAttribute('aria-label') ?? ''}`)).length);
  });

  it('GP-0250-05 resizing the inspector brings the selected row back into view without moving focus', async () => {
    fakeBackend({ 'GET /mix/1/options': options, 'GET /mix/2/options': options });
    const scrolled = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrolled });
    render(<Harness start={songs(ready('a'), ready('b'))} />);
    await userEvent.click(songButton('Song 3'));
    const handle = await screen.findByRole('separator', { name: 'Resize inspector' });
    handle.focus();
    scrolled.mockClear();
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled.mock.contexts.some((element) => (element as HTMLElement).matches('[data-song-key]') && (element as HTMLElement).textContent?.includes('Song 3'))).toBe(true);
    expect(handle).toHaveFocus();
  });
});
