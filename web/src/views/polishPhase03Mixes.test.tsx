import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MixItem, VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, Reply, songs, status } from '../test/backend';
import { Mixes } from './Mixes';

/** Polish ADR-0038 P0057/P0058: the measured energy of the current mix is never drawn as a score
 * against the requested arc, and destination search tells no ready match apart from a failed search. */

const pick: VibeCard = {
  key: 'pick', name: 'SelectaDJ’s pick', group: '', family: null, blurb: 'words', songs: 40, ready: true, needs: 0,
  artists: ['Someone'], tempo: [100, 124], moves: 'Vocal rides', seconds: 3900,
};

function show(mix: MixItem[] = []) {
  const player = new SetPlayer(() => mix, () => {});
  render(
    <Mixes status={status()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}}
      refreshStatus={() => {}} player={player} now={player.state} setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />,
  );
}

afterEach(cleanup);

describe('P0057 requested versus achieved energy', () => {
  it('labels the measured curve as the current mix’s own relative range, not a score against the request', async () => {
    fakeBackend({ 'GET /vibes': [pick] });
    const mix = songs(undefined, undefined, undefined).map((item, index) => ({ ...item, energy: [0.2, 0.5, 0.9, 0.4][index] }));
    show(mix);
    fireEvent.click(await screen.findByRole('button', { name: /^Customize:/ }));
    expect(await screen.findByText('What your current mix measured')).toBeInTheDocument();
    expect(screen.getByText(/own range, so it is not a score against your requested arc/)).toBeInTheDocument();
  });

  it('draws no measured curve when a song’s energy is unknown', async () => {
    fakeBackend({ 'GET /vibes': [pick] });
    const mix = songs(undefined, undefined).map((item, index) => ({ ...item, energy: index === 1 ? undefined : 0.5 }));
    show(mix as MixItem[]);
    fireEvent.click(await screen.findByRole('button', { name: /^Customize:/ }));
    await screen.findByLabelText('Take me to');
    expect(screen.queryByText('What your current mix measured')).toBeNull();
  });
});

describe('P0058 destination search states', () => {
  it('says no ready song matches when the search worked', async () => {
    fakeBackend({ 'GET /vibes': [pick], 'GET /songs': [] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Customize:/ }));
    fireEvent.change(await screen.findByLabelText('Take me to'), { target: { value: 'nothing here' } });
    expect(await screen.findByText('No ready songs match yet.')).toBeInTheDocument();
    expect(screen.queryByText('Couldn’t search ready songs.')).toBeNull();
  });

  it('says the search failed, offers a retry, and does not claim there is no match', async () => {
    fakeBackend({ 'GET /vibes': [pick], 'GET /songs': new Reply(500, { detail: 'boom' }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Customize:/ }));
    fireEvent.change(await screen.findByLabelText('Take me to'), { target: { value: 'midnight' } });
    expect(await screen.findByText('Couldn’t search ready songs.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again|Retry/ })).toBeInTheDocument();
    expect(screen.queryByText('No ready songs match yet.')).toBeNull();
  });
});
