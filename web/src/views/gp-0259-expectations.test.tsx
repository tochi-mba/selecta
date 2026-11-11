import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, songs, status } from '../test/backend';
import { Mixes } from './Mixes';

/** GP-0259: Explore choices are comparable, honest about evidence, and say what really happened. */

const card = (key: string, name: string, group: string, more: Partial<VibeCard> = {}): VibeCard => ({
  key, name, group, family: null, blurb: `${name} words`, songs: 40, ready: true, needs: 0,
  artists: ['Someone'], tempo: [100, 124], moves: 'Vocal rides and long blends', seconds: 3900, ...more,
});

function show({ mix = [] as ReturnType<typeof songs>, playing = false, notify = vi.fn(), setMixData = vi.fn() } = {}) {
  const player = new SetPlayer(() => [], () => {});
  vi.spyOn(player, 'playFrom').mockResolvedValue(undefined);
  const now = playing ? { ...player.state, phase: 'playing' as const } : player.state;
  render(<Mixes status={status()} mix={mix} mixName={mix.length ? 'Current' : ''} canUndo={false} refreshMix={() => {}}
    setMixData={setMixData} refreshStatus={() => {}} player={player} now={now} setView={() => {}} notify={notify}
    stage={false} toggleStage={() => {}} />);
  return { notify, setMixData, player };
}

const article = async (name: string) => within((await screen.findByRole('heading', { name })).closest('article')!);

describe('GP-0259 Explore expectations', () => {
  it('GP-0259-02 every available card shows the same brief comparable facts', async () => {
    fakeBackend({ 'GET /vibes': [
      card('peak', 'Peak time', 'The moment', { songs: 31, tempo: [118, 132], seconds: 1800 }),
      card('feelings', 'In your feelings', 'The mood', { songs: 9, tempo: [70, 96], seconds: 600 }),
    ] });
    show();
    const peak = await article('Peak time');
    const feelings = await article('In your feelings');
    expect(peak.getByText('31 matching songs')).toBeVisible();
    expect(feelings.getByText('9 matching songs')).toBeVisible();
    expect(peak.getByText('118–132 BPM')).toBeVisible();
    expect(feelings.getByText('70–96 BPM')).toBeVisible();
    expect(peak.getByText('About 30 min of matching source songs')).toBeVisible();
    expect(feelings.getByText('About 10 min of matching source songs')).toBeVisible();
  });

  it('GP-0259-03 a sparse library says which ideas are unavailable, why, and what to do instead', async () => {
    fakeBackend({ 'GET /vibes': [
      card('pick', 'Selecta’s pick', ''),
      card('afro_heat', 'Afro heat', 'The sound', { songs: 6 }),
      card('rap_run', 'Rap run', 'The sound', { ready: false, needs: 6, songs: 0 }),
    ] });
    show();
    expect(await screen.findByText('needs 6 more')).toBeInTheDocument();
    const waiting = screen.getByRole('heading', { name: 'Needs more mix-ready songs' }).closest('section')!;
    expect(within(waiting).getByText(/try another available idea, or analyse more local songs/)).toBeInTheDocument();
    expect(within(waiting).getByText(/No new mix will be made from an unavailable idea/)).toBeInTheDocument();
    // the unavailable idea has no Play button anywhere
    expect(screen.queryByRole('heading', { name: 'Rap run' })).toBeNull();
    expect((await article('Afro heat')).getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('GP-0259-04 Play, Shape first and Save draft each say their own consequence', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time', 'The moment')] });
    show();
    const peak = await article('Peak time');
    fireEvent.click(peak.getByText('Why Peak time? More details'));
    const consequence = peak.getByText(/Planning preference, not a promised song order/).textContent!;
    expect(consequence).toContain('Play replaces the current mix after confirmation');
    expect(consequence).toContain('Shape first opens the new mix for editing');
    expect(consequence).toContain('Save draft leaves playback unchanged');
  });

  it('GP-0259-05 says what was actually generated next to what was asked for', async () => {
    const short = songs().slice(0, 1);
    fakeBackend({
      'GET /vibes': [card('peak', 'Peak time', 'The moment')],
      'POST /vibes/peak/build': { mix: short, name: 'Peak time', can_undo: true },
    });
    const { notify } = show();
    fireEvent.click((await article('Peak time')).getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls[0][0]).toMatch(/^Peak time: generated 1 of 12 requested songs, about .+ of source audio before transitions\. Review the actual order in Edit\.$/);
    expect(notify.mock.calls[0][1]).toBe(true); // offered with Undo
  });

  it('GP-0259-06 trying another idea keeps what is playing: Cancel builds nothing, Save draft never touches playback', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('peak', 'Peak time', 'The moment')],
      'POST /vibes/peak/build': { id: 9, name: 'Peak time', count: 12 },
    });
    const { setMixData, player, notify } = show({ mix: songs(), playing: true });
    const peak = await article('Peak time');
    fireEvent.click(peak.getByRole('button', { name: 'Play' }));
    const dialog = screen.getByRole('dialog', { name: 'Replace Current?' });
    expect(within(dialog).getByText(/You can undo this straight afterwards/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await waitFor(() => expect(peak.getByRole('button', { name: 'Save draft for Peak time' })).toBeEnabled());
    fireEvent.click(peak.getByRole('button', { name: 'Save draft for Peak time' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'POST')!.path).toContain('as_draft=true');
    expect(setMixData).not.toHaveBeenCalled();
    expect(player.playFrom).not.toHaveBeenCalled();
  });

  it('GP-0259-07 names only the measured evidence a card was chosen by, and says nothing when the server does not', async () => {
    fakeBackend({ 'GET /vibes': [
      card('slow_burn', 'Slow burn', 'The journey', { basis: ['energy'] }),
      card('rap_run', 'Rap run', 'The sound', { basis: ['genre tags', 'energy', 'lyric themes'] }),
      card('peak', 'Peak time', 'The moment'),
    ] });
    show();
    const rap = await article('Rap run');
    fireEvent.click(rap.getByText('Why Rap run? More details'));
    expect(rap.getByText(/^Chosen by genre tags, energy and lyric themes, measured from your songs\./)).toBeVisible();
    expect(rap.getByText(/not a label on every song/)).toBeVisible();
    const journey = await article('Slow burn');
    expect(journey.getByText(/^Chosen by energy, measured/)).toBeInTheDocument();
    expect((await article('Peak time')).queryByText(/^Chosen by/)).toBeNull();
  });
});
