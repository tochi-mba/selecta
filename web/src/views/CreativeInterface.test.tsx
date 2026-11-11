import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportJob, MixData, MixItem, SongDetail, Status, VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs, status as appStatus } from '../test/backend';
import { EnergyThumb, FeelDiagram, LengthScale } from '../ui/MusicObjects';
import { SeamSegments } from './Drafts';
import { ExportJobs, exportStage } from './ExportJobs';
import { HarmonicDiscoveries, Links } from './Links';
import { Mix } from './Mix';
import { Mixes } from './Mixes';
import { Now } from './Now';
import { Workshop } from './Workshop';

/** Creative-interface (CI, ADR-0165 to ADR-0184) acceptance checks that had no focused test before. */

describe('CI-0179-04 per-transition readiness on a draft', () => {
  it('draws one segment per transition from the server counts, with no invented percentage', () => {
    const { container } = render(<SeamSegments draft={{ seams: 6, ready: 3, failed: 1, waiting: 1 }} />);
    const graphic = screen.getByRole('img', { name: '3 of 6 transitions ready, 1 couldn’t be made, 1 waiting, 1 not started' });
    expect(graphic.textContent).not.toMatch(/%/);
    const kinds = [...container.querySelectorAll('.draft-seams i')].map((segment) => segment.className);
    expect(kinds).toEqual(['ready', 'ready', 'ready', 'failed', 'waiting', 'other']);
  });

  it('never shows more segments than transitions, whatever the counts say', () => {
    const { container } = render(<SeamSegments draft={{ seams: 2, ready: 5, failed: Number.NaN, waiting: -1 }} />);
    expect(container.querySelectorAll('.draft-seams i')).toHaveLength(2);
    expect(screen.getByRole('img', { name: '2 of 2 transitions ready' })).toBeInTheDocument();
  });
});

describe('CI-0179-02 truthful energy thumbnail', () => {
  it('keeps missing and non-numeric energy as unknown gaps and says how many', () => {
    const values = [0.2, null, Number.NaN, undefined, 0.8] as unknown as number[];
    const { container } = render(<EnergyThumb values={values} />);
    expect(container.querySelectorAll('.energy-thumb-unknown')).toHaveLength(3);
    expect(container.querySelectorAll('.energy-thumb-bar')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Measured energy rises; 3 songs unknown' })).toBeInTheDocument();
  });

  it('shows nothing for an empty mix and never draws a shape when nothing was measured', () => {
    const { container, rerender } = render(<EnergyThumb values={[]} />);
    expect(container.firstChild).toBeNull();
    rerender(<EnergyThumb values={[null, null]} />);
    expect(container.querySelectorAll('.energy-thumb-bar')).toHaveLength(0);
    expect(screen.getByRole('img', { name: 'Energy unknown for all 2 songs' })).toBeInTheDocument();
  });
});

describe('CI-0176-01 phrase bridges stay legible', () => {
  const link = {
    phrase: 'الليلة tonight', kind: 'x', a: 1, b: 2, artist_a: 'فنان', title_a: 'أغنية الليل', artist_b: 'B', title_b: 'Two',
    line_a: 'كل الليلة '.repeat(20), line_b: 'tonight we go '.repeat(20), moves: ['word_cut'], move: 'word_cut',
    state: { status: 'none', key: 'k' }, worked: true,
  };
  const props = () => ({ setMixData: vi.fn(), setView: vi.fn(), notify: vi.fn(), status: appStatus(), mix: [], tab: 'words' as const }) as unknown as Parameters<typeof Links>[0];

  it('shows the shared words and both songs and lines whole, each in its own direction', async () => {
    fakeBackend({ 'GET /links': { links: [link], prepared: 0, preparing: 0 }, 'GET /drafts': { drafts: [], current: {}, out_of_room: false } });
    render(<Links {...props()} />);
    const phrase = await screen.findByRole('heading', { name: '“الليلة tonight”' });
    expect(phrase).toHaveAttribute('dir', 'auto');
    const card = phrase.closest('article') as HTMLElement;
    for (const text of ['أغنية الليل', 'فنان', 'Two']) expect(within(card).getByText(text)).toHaveAttribute('dir', 'auto');
    const quotes = card.querySelectorAll('q');
    expect(quotes).toHaveLength(2);
    expect(quotes[0].textContent).toBe(link.line_a);
    expect(quotes[1].textContent).toBe(link.line_b);
    quotes.forEach((quote) => expect(quote).toHaveAttribute('dir', 'auto'));
  });
});

describe('CI-0176-04 a machine suggestion is a candidate until someone rates it', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('calls unrated harmony pairs possible, and says an answer changes no mix', async () => {
    fakeBackend({
      'GET /discoveries': [{
        id: 7, song_a: 71, song_b: 72, title_a: 'First', title_b: 'Second', artist_a: 'A', artist_b: 'B', status: 'new',
        payload: { a_at: 12, b_at: 30, a_end: 28, b_end: 46, bars: 8, transpose: 2 },
      }],
    });
    render(<HarmonicDiscoveries />);
    expect(await screen.findByRole('heading', { name: 'Songs that might share chords' })).toBeInTheDocument();
    expect(screen.getByText(/Your answer only teaches Selecta what you hear\. It never adds anything to a mix\./)).toBeInTheDocument();
  });
});

describe('CI-0181-03/04 export outcomes', () => {
  const job = (id: string, state: ExportJob['state'], more: Partial<ExportJob> = {}): ExportJob => ({
    id, state, scope: 'current', draft: null, mix_name: `Mix ${id}`, revision: `rev-${id}`,
    songs: [{ song_id: 1, title: 'One', artist: 'A' }, { song_id: 2, title: 'Two', artist: 'B' }],
    seams: [{ key: 'k1', from: 'One', to: 'Two' }], seams_total: 1, seams_ready: 0, seconds_estimate: 400,
    name: `mix-${id}.flac`, seconds: null, error: null, created_at: 1_700_000_000, can_cancel: false, quiet_seconds: 0, ...more,
  });

  it('tells cancelled, expired, failed and interrupted apart, and each can be made again', async () => {
    fakeBackend({ 'GET /exports/jobs': { jobs: [job('c', 'cancelled'), job('e', 'expired'), job('f', 'failed', { error: 'No room left on the drive.' }), job('i', 'interrupted')] } });
    render(<ExportJobs always />);
    const words = ['cancelled', 'expired', 'failed', 'interrupted'].map((state) => exportStage({ state: state as ExportJob['state'] }).words);
    expect(new Set(words).size).toBe(4);
    for (const said of words) expect(await screen.findByText(said)).toBeInTheDocument();
    expect(screen.getByText(/isn’t in Selecta’s exports folder any more/)).toBeInTheDocument();
    expect(screen.getByText('No room left on the drive.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/ })).toBeNull();
    expect(exportStage({ state: 'nonsense' as ExportJob['state'] }).words).toBe('State unknown');
  });

  it('shows the file name, length and download only once the file really exists', async () => {
    fakeBackend({ 'GET /exports/jobs': { jobs: [job('p', 'encoding'), job('r', 'ready', { seconds: 905 })] } });
    render(<ExportJobs always />);
    const link = await screen.findByRole('link', { name: 'download mix-r.flac' });
    expect(link).toHaveAttribute('href', '/api/exports/mix-r.flac');
    expect(screen.queryByRole('link', { name: 'download mix-p.flac' })).toBeNull();
    expect(screen.getByText('Creating the FLAC file')).toBeInTheDocument();
    expect(screen.getAllByText(/long$/)).toHaveLength(1);
  });
});

describe('CI-0171-01 lyric confidence levels', () => {
  const mix: MixItem[] = [{ position: 0, song_id: 1, artist: 'Test Artist', title: 'Test Song', duration: 20, bpm: 120, key: '8A', locked: false, seam: null }];
  const base: SongDetail = {
    id: 1, artist: 'Test Artist', title: 'Test Song', duration: 20, bpm: 120, key: '8A', peaks: [], bar_times: [0, 8, 16],
    beat_times: [0, 2, 4, 6, 8], beats_per_bar: 4, sections: [], lines: [],
  };
  const view = () => {
    const player = new SetPlayer(() => mix, () => {});
    return (
      <Now status={appStatus()} mix={mix} mixName="Test mix" canUndo={false} refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={{ ...player.state, phase: 'playing', position: 0, songTime: 2.5, duration: 20 }} setView={() => {}} notify={() => {}} stage toggleStage={() => {}} />
    );
  };

  it.each([
    ['word-timed', { lyric_status: 'synced', lines: [{ start: 1, end: 4, text: 'Hello there', words: [{ start: 1, end: 2 }, { start: 2, end: 4 }] }] }, /Word highlights follow stored lyric alignment; timing may be approximate\./],
    ['line-timed', { lyric_status: 'synced', lines: [{ start: 1, end: 4, text: 'Hello there' }] }, /Line-timed lyrics; individual word timing unavailable\./],
    ['plain', { lyric_status: 'plain', lines: [{ start: 1, end: 4, text: 'Hello there' }] }, /Untimed lyrics - word timing unavailable\./],
    ['missing', { lyric_status: 'none', lines: [] }, /No lyrics found for this song\./],
    ['instrumental', { lyric_status: 'instrumental', lines: [] }, /^Instrumental$/],
  ])('says what kind of lyrics a %s song has, without claiming more precision', async (_kind, more, said) => {
    fakeBackend({ 'GET /songs/1': { ...base, ...more } });
    render(view());
    expect((await screen.findAllByText(said)).length).toBeGreaterThan(0);
  });
});

describe('CI-0169-05 transition feel diagrams', () => {
  it('draws smooth, punchy and each-mix-chooses differently, as decoration only', () => {
    const drawn = ['seamless', 'punchy', 'balanced'].map((feel) => {
      const { container, unmount } = render(<FeelDiagram feel={feel} />);
      const svg = container.querySelector('svg') as SVGElement;
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('data-feel', feel);
      const html = svg.innerHTML;
      unmount();
      return html;
    });
    expect(new Set(drawn).size).toBe(3);
    const { container } = render(<FeelDiagram feel="something new" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-feel', 'balanced');
    expect(container.textContent).toBe('');
  });
});

describe('CI-0168-04 approximate-length graphic', () => {
  it('scales with the songs asked for and never states minutes', () => {
    const shares = [12, 24, 48].map((songs) => {
      const { container, unmount } = render(<LengthScale songs={songs} most={48} />);
      const scale = container.querySelector('.length-scale') as HTMLElement;
      expect(scale).toHaveAttribute('aria-hidden', 'true');
      expect(scale.textContent).toBe('');
      const share = scale.getAttribute('data-share');
      unmount();
      return share;
    });
    expect(shares).toEqual(['0.25', '0.50', '1.00']);
    const { container } = render(<LengthScale songs={Number.NaN} most={48} />);
    expect(container.querySelector('.length-scale')).toHaveAttribute('data-share', '0.00');
  });
});

const viewProps = (state: Status = appStatus()) => {
  const player = new SetPlayer(() => [], () => {});
  return {
    status: state, mix: [] as MixItem[], mixName: '', canUndo: false, refreshMix: () => {}, setMixData: () => {}, refreshStatus: () => {},
    player, now: player.state, setView: () => {}, notify: () => {}, stage: false, toggleStage: () => {},
  };
};

describe('CI-0172-04 a move that can’t be used says why', () => {
  function Harness({ start }: { start: MixItem[] }) {
    const [mix, setMix] = useState(start);
    const player = new SetPlayer(() => mix, () => {});
    return <Mix {...viewProps()} mix={mix} mixName="Test mix" setMixData={(data: MixData) => setMix(data.mix)} player={player} now={player.state} />;
  }
  const move = (name: string, label: string, reason: string | null) => ({
    name, label, description: '', available: reason === null, reason, blends: false, rides: false, uses_cues: true, uses_phrase: false,
  });

  it('greys out the move with its reason on hover and in a list the keyboard can reach', async () => {
    fakeBackend({
      'GET /mix/1/options': {
        moves: [move('auto', 'Let Selecta choose', null), move('vocal_ride', 'Vocal ride', 'Needs a vocal cue that this song doesn’t have'),
          move('bass_swap_blend', 'Bass swap', 'These two are too far apart in tempo')],
        exits: [], entries: [], lengths: [], links: [], studio: { available: true, reason: null }, tempo_gap: 14, keys: ['8A', '3B'],
      },
    });
    render(<Harness start={songs(seam('ready', 'a'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change' }));
    const group = await screen.findByRole('group', { name: 'How should this land?' });
    const ride = within(group).getByRole('button', { name: /Vocal ride/ });
    expect(ride).toBeDisabled();
    expect(ride).toHaveAttribute('title', 'Needs a vocal cue that this song doesn’t have');
    const why = screen.getByText('Why 2 moves are greyed out');
    fireEvent.click(why);
    const list = why.closest('details') as HTMLElement;
    expect(list).toHaveTextContent('Vocal ride: Needs a vocal cue that this song doesn’t have');
    expect(list).toHaveTextContent('Bass swap: These two are too far apart in tempo');
    expect(screen.getByText('14% tempo gap, keys 8A and 3B.')).toBeInTheDocument();
  });
});

describe('CI-0167-02 a chosen idea stays named in the mix it actually made', () => {
  it('names the idea with the server’s own song count, opens the editor, and claims nothing rendered', async () => {
    const card: VibeCard = {
      key: 'peak', name: 'Peak time', group: 'The moment', family: null, blurb: 'Peak words', songs: 40, ready: true, needs: 0,
      artists: ['Someone'], tempo: [100, 124], moves: 'Long blends', seconds: 3900,
    };
    const built = songs(seam('none', 'a'));
    fakeBackend({
      'GET /vibes': [card],
      'POST /vibes/peak/build': { mix: built, name: 'Peak time', can_undo: true },
      'GET /drafts': { drafts: [], current: { name: '', songs: 0, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
    });
    const notify = vi.fn();
    const setMixData = vi.fn();
    const setView = vi.fn();
    render(<Mixes {...viewProps()} notify={notify} setMixData={setMixData} setView={setView} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Shape first' }));
    await waitFor(() => expect(setView).toHaveBeenCalledWith('Edit'));
    expect(setMixData).toHaveBeenCalledWith(expect.objectContaining({ mix: built }));
    const said = notify.mock.calls[0][0] as string;
    expect(said).toMatch(/^Peak time: generated 2 of 12 requested songs, about .* of source audio before transitions\. Review the actual order in Edit\.$/);
    expect(said).not.toMatch(/ready|rendered/i);
  });
});

describe('CI-0180-03/04 Workspace explains priority and keeps music apart from cache', () => {
  it('shows analysis held back by a mix render as waiting, not stuck', async () => {
    fakeBackend({
      'GET /jobs': {
        worker: { running: true, rendering_the_mix: true }, mix: { queued: 1, rendering: 1, failed: 0, none: 0, ready: 3 }, drafts_in_line: 0,
        storage_full: false, analysis: { running: true, paused: false, asked_for: 0, left: 9 }, failed_seams: [], failed_songs: [], estimates: '',
      },
    });
    render(<Workshop {...viewProps(appStatus({ mix_rendering: true }))} tab="overview" />);
    const waiting = await screen.findByText('Waiting while your mix renders');
    expect(waiting.closest('.status')?.className ?? '').not.toMatch(/failed|blocked/);
    expect(screen.queryByText(/stuck/i)).toBeNull();
  });

  it('labels the cache as Selecta’s own and says the music files are never counted or touched', async () => {
    const GB = 1024 ** 3;
    fakeBackend({
      'GET /storage': {
        used_bytes: 4 * GB, kept_bytes: 3 * GB, cache_bytes: 1 * GB, free_bytes: 13 * GB, budget_bytes: 3 * GB,
        largest_budget_bytes: 13 * GB, smallest_budget_bytes: 0.5 * GB, total_bytes: 200 * GB,
      },
    });
    render(<Workshop {...viewProps()} tab="storage" />);
    expect(await screen.findByText('Made by Selecta, can be made again')).toBeInTheDocument();
    expect(screen.getByText(/Your music files aren’t counted here, because Selecta doesn’t copy them, and nothing here ever touches them\./)).toBeInTheDocument();
    expect(screen.getByText(/Your music is never touched\./)).toBeInTheDocument();
  });
});

describe('CI-0181-05 closing the exports list never restarts or loses a job', () => {
  it('finds the same job again after it is closed and reopened, without asking for a new one', async () => {
    const job: ExportJob = {
      id: 'x1', state: 'encoding', scope: 'current', draft: null, mix_name: 'Night', revision: 'rev-1', songs: [{ song_id: 1, title: 'One', artist: 'A' }],
      seams: [], seams_total: 0, seams_ready: 0, seconds_estimate: 200, name: 'night.flac', seconds: null, error: null, created_at: 1_700_000_000,
      can_cancel: true, quiet_seconds: 0,
    };
    const calls = fakeBackend({ 'GET /exports/jobs': { jobs: [job] } });
    const first = render(<ExportJobs always />);
    expect(await screen.findByText('Creating the FLAC file')).toBeInTheDocument();
    expect(screen.getByText(/These keep going if you close this or reload/)).toBeInTheDocument();
    first.unmount();
    render(<ExportJobs always />);
    expect(await screen.findByText('Night')).toBeInTheDocument();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });
});
