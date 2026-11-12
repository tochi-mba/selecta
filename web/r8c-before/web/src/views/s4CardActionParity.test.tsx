import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, songs, status } from '../test/backend';
import { Mixes } from './Mixes';

/*
 * S4-0097-02: Play, Shape first and Save draft on a mix card ask the server for the same mix. Play and
 * Shape first send the identical build request (only where the listener lands differs), and Save draft
 * sends that same request with as_draft=true, from the card and from the Replace dialog alike. The
 * backend half (same planner call, same order and seams whether current or draft) is
 * tests/test_s4_card_action_parity.py.
 */

const card = (key: string, name: string): VibeCard => ({
  key, name, group: 'The moment', family: null, blurb: `${name} words`, songs: 40, ready: true, needs: 0,
  artists: ['Someone'], tempo: [100, 124], moves: 'Long blends', seconds: 3900,
});

const built = { mix: songs(undefined), name: 'Peak time', count: 2 };

function shown(playing: boolean) {
  const calls = fakeBackend({
    'GET /vibes': [card('peak', 'Peak time')],
    'POST /vibes/peak/build': built,
  });
  const player = new SetPlayer(() => [], () => {});
  vi.spyOn(player, 'playFrom').mockResolvedValue(undefined as never);
  const setView = vi.fn();
  const setMixData = vi.fn();
  const mix = playing ? (built.mix as never) : [];
  const now = playing ? { ...player.state, phase: 'playing' } : player.state;
  render(
    <Mixes
      status={status()} mix={mix} mixName="Tonight" canUndo={false} refreshMix={() => {}}
      setMixData={setMixData} refreshStatus={() => {}} player={player} now={now as never}
      setView={setView} notify={() => {}} stage={false} toggleStage={() => {}}
    />,
  );
  return { calls, setView, setMixData };
}

const builds = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((call) => call.method === 'POST').map((call) => ({ path: call.path, body: call.body }));

async function press(label: string, playing = false) {
  const seen = shown(playing);
  const article = within((await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!);
  fireEvent.click(article.getByRole('button', { name: label }));
  return seen;
}

describe('S4-0097-02 every card entry point asks for the same mix', () => {
  it('Play and Shape first send the identical build request and differ only in where they land', async () => {
    const play = await press('Play');
    await waitFor(() => expect(play.setView).toHaveBeenCalledWith('Now'));
    const playBuilds = builds(play.calls);
    document.body.innerHTML = '';

    const shape = await press('Shape first');
    await waitFor(() => expect(shape.setView).toHaveBeenCalledWith('Edit'));
    expect(builds(shape.calls)).toEqual(playBuilds);
    expect(playBuilds).toHaveLength(1);
    expect(play.setMixData).toHaveBeenCalledWith(built);
    expect(shape.setMixData).toHaveBeenCalledWith(built);
  });

  it('Save draft sends the same request, marked as a draft, and changes nothing that plays', async () => {
    const play = await press('Play');
    await waitFor(() => expect(play.setView).toHaveBeenCalled());
    const [playBuild] = builds(play.calls);
    document.body.innerHTML = '';

    const draft = await press('Save draft for Peak time');
    await waitFor(() => expect(builds(draft.calls)).toHaveLength(1));
    const [draftBuild] = builds(draft.calls);
    expect(draftBuild.path).toBe(`${playBuild.path}&as_draft=true`);
    expect(draftBuild.body).toEqual(playBuild.body);
    expect(draft.setMixData).not.toHaveBeenCalled();
    expect(draft.setView).not.toHaveBeenCalled();
  });

  it('the Replace dialog’s choices send the same requests as the card’s own buttons', async () => {
    const replace = await press('Play', true);
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Replace and play' }));
    await waitFor(() => expect(replace.setView).toHaveBeenCalledWith('Now'));
    const [replaced] = builds(replace.calls);
    document.body.innerHTML = '';

    const instead = await press('Play', true);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save as draft instead' }));
    await waitFor(() => expect(builds(instead.calls)).toHaveLength(1));
    const [kept] = builds(instead.calls);
    expect(kept.path).toBe(`${replaced.path}&as_draft=true`);
    expect(instead.setMixData).not.toHaveBeenCalled();
  });
});
