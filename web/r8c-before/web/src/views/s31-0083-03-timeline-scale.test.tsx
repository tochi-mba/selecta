import { render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MixData, MixItem, SeamState } from '../api';
import { SetPlayer } from '../player';
import { seam, songs, status } from '../test/backend';
import { Mix } from './Mix';

/**
 * ADR-0083 (S31-0083-03): the creator timeline stays scannable at 2, 20 and 100 songs with long,
 * right-to-left, CJK and duplicate names. Every song row keeps its number, its full title (on hover
 * too), its artist, its own occurrence and its row actions named for that song; every transition row
 * keeps its status in words; and the page draws exactly one row per song and per transition.
 */

const STATUSES: SeamState['status'][] = ['ready', 'queued', 'rendering', 'none', 'failed'];
const LONG = 'A really quite long working title for a song that goes on and on ';
const NAMES = ['رحلة ليلية في المدينة', '東京の夜の音楽とその続き', LONG.repeat(3).trim(), 'Same Name', 'Same Name'];

function longMix(count: number): MixItem[] {
  const mix = songs(...Array.from({ length: count - 1 }, (_, index) => seam(STATUSES[index % STATUSES.length], `s${index}`, index % STATUSES.length === 4 ? { error: 'No safe vocal runway.' } : {})));
  return mix.map((item, index) => ({ ...item, title: NAMES[index % NAMES.length], artist: index % 2 ? 'مغني طويل الاسم جدا' : `Artist with a long name ${index}` }));
}

function Harness({ start }: { start: MixItem[] }) {
  const [mix, setMix] = useState(start);
  const player = new SetPlayer(() => mix, () => {});
  return (
    <Mix status={status()} mix={mix} mixName="Scale" canUndo={false} refreshMix={() => {}}
      setMixData={(data: MixData) => setMix(data.mix)} refreshStatus={() => {}} player={player} now={player.state}
      setView={() => {}} notify={() => {}} stage={false} toggleStage={() => {}} />
  );
}

describe('S31-0083-03 the timeline stays scannable at 2, 20 and 100 songs', () => {
  it.each([2, 20, 100])('%i songs: one row each, every one identified, every transition saying where it is', (count) => {
    const mix = longMix(count);
    render(<Harness start={mix} />);
    const rows = [...document.querySelectorAll<HTMLElement>('.timeline li.song')];
    const seams = [...document.querySelectorAll<HTMLElement>('.timeline li.seam')];
    expect(rows).toHaveLength(count);
    expect(seams).toHaveLength(count - 1);

    rows.forEach((row, index) => {
      const item = mix[index];
      expect(row.querySelector('.count')).toHaveTextContent(String(index + 1));
      const name = row.querySelector('.song-select b')!;
      expect(name).toHaveTextContent(item.title);
      expect(name).toHaveAttribute('title', item.title);
      expect(name).toHaveAttribute('dir', 'auto');
      expect(row.querySelector('.song-name > span[dir="auto"]')).toHaveTextContent(item.artist);
      expect(row.querySelector('.song-select')).toHaveAttribute('aria-description', `Song occurrence ${index + 1} of ${count}`);
      // the row's own actions are named for its song, so a long list never leaves a bare "Play"
      const actions = row.querySelector('.song-actions')!;
      expect(actions.querySelector(`[aria-label="Play from ${item.title}"]`)).not.toBeNull();
      expect(actions.querySelector(`[aria-label="Move ${item.title} up"]`)).not.toBeNull();
      expect(actions.querySelector(`[aria-label="Move ${item.title} down"]`)).not.toBeNull();
      expect(row.querySelector('.facts')).toHaveTextContent(/BPM .* · \d+:\d\d/);
    });

    seams.forEach((row, index) => {
      const pill = row.querySelector('.seam-name .pill')!;
      expect(pill).toHaveClass(STATUSES[index % STATUSES.length]);
      expect((pill.textContent ?? '').trim().length).toBeGreaterThan(2);
    });
    // a failed transition says why in words, wherever it falls in a long list
    const failed = seams.filter((row) => row.querySelector('.pill.failed'));
    expect(failed).toHaveLength(Math.floor((count - 1) / STATUSES.length));
    for (const row of failed) expect(row).toHaveTextContent('Remembered failed attempt: No safe vocal runway.');
  });

  it('duplicate names stay told apart by their own occurrence in a 100-song list', () => {
    render(<Harness start={longMix(100)} />);
    const same = [...document.querySelectorAll<HTMLElement>('.timeline li.song')].filter((row) => row.querySelector('.song-select b')?.textContent === 'Same Name');
    expect(same.length).toBe(40);
    const occurrences = same.map((row) => row.querySelector('.song-select')!.getAttribute('aria-description'));
    expect(new Set(occurrences).size).toBe(same.length);
  });
});
