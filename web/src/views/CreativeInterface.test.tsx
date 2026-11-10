import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportJob, MixItem, SongDetail } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, status as appStatus } from '../test/backend';
import { EnergyThumb, FeelDiagram, LengthScale } from '../ui/MusicObjects';
import { SeamSegments } from './Drafts';
import { ExportJobs, exportStage } from './ExportJobs';
import { HarmonicDiscoveries, Links } from './Links';
import { Now } from './Now';

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
    expect(document.body.textContent).not.toMatch(/\b(confirmed|verified|approved)\b/i);
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
