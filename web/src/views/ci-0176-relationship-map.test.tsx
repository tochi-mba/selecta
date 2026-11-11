import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Link } from '../api';
import { MAP_CAPACITY, relationshipGraph, RelationshipMap } from './RelationshipMap';

const link = (a: number, b: number, phrase: string): Link => ({
  phrase, kind: 'word', a, b, artist_a: 'A', title_a: `Song ${a}`, artist_b: 'B', title_b: `Song ${b}`, line_a: '', line_b: '',
  moves: [], move: 'word_blend', state: { status: 'none', key: `${a}-${b}`, passed: true }, worked: true,
} as unknown as Link);

/** A dense library: a hub song 1 linked into everything, plus a long chain of 2 into 3 into 4 and so on. */
const dense = (songs: number) => [
  ...Array.from({ length: songs - 1 }, (_, index) => link(1, index + 2, `hub ${index + 2}`)),
  ...Array.from({ length: songs - 2 }, (_, index) => link(index + 2, index + 3, `chain ${index + 2}`)),
];

describe('CI-0176-02 bounded song-neighbour graph', () => {
  it('draws at most its capacity of songs, the most connected, and only returned links between them', () => {
    const links = dense(80);
    const { nodes, edges, songs, connections } = relationshipGraph(links);
    expect(songs).toBe(80);
    expect(connections).toBe(links.length);
    expect(nodes).toHaveLength(MAP_CAPACITY);
    // the hub, linked to everything, is always kept
    expect(nodes.map((node) => node.id)).toContain(1);
    const kept = new Set(nodes.map((node) => node.id));
    const real = new Set(links.map((one) => `${one.a}>${one.b}`));
    for (const edge of edges) {
      expect(real.has(edge.key)).toBe(true);
      expect(kept.has(edge.from) && kept.has(edge.into)).toBe(true);
    }
    // nothing between two kept songs is dropped either
    const between = links.filter((one) => kept.has(one.a) && kept.has(one.b));
    expect(edges).toHaveLength(between.length);
  });

  it('keeps a small graph whole and in the order the server returned it', () => {
    const { nodes, edges, songs } = relationshipGraph(dense(6));
    expect(songs).toBe(6);
    expect(nodes.map((node) => node.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(edges).toHaveLength(5 + 4);
  });

  it('says how much a dense map left out, and the list stays the full version', () => {
    const { container } = render(<RelationshipMap links={dense(80)} />);
    fireEvent.click(screen.getByText('See these connections as a map'));
    expect(container.querySelector('[data-map-bounded]')).toHaveTextContent(
      `The map shows the ${MAP_CAPACITY} most connected of 80 songs`,
    );
    expect(container.querySelectorAll('[data-song]')).toHaveLength(MAP_CAPACITY);
  });

  it('a small map says nothing about leaving songs out', () => {
    const { container } = render(<RelationshipMap links={dense(6)} />);
    expect(container.querySelector('[data-map-bounded]')).toBeNull();
  });

  it('can be walked song by song from a keyboard control, lighting only that song’s real links', async () => {
    const user = userEvent.setup();
    const { container } = render(<RelationshipMap links={dense(80)} />);
    await user.click(screen.getByText('See these connections as a map'));
    const follow = screen.getByRole('combobox', { name: 'Follow a song on the map' });
    expect(follow.querySelectorAll('option')).toHaveLength(MAP_CAPACITY + 1);
    await user.tab();
    expect(follow).toHaveFocus();
    // a native select: arrow keys, Home, End and type-ahead walk every song the map draws
    const options = [...follow.querySelectorAll('option')].map((option) => option.value).filter(Boolean);
    await user.selectOptions(follow, options[0]);
    const first = Number((follow as HTMLSelectElement).value);
    expect(first).toBe(1);
    const lit = [...container.querySelectorAll('[data-lit]')].map((line) => line.getAttribute('data-edge')!);
    expect(lit.length).toBeGreaterThan(0);
    for (const key of lit) expect(key.split('>').map(Number)).toContain(first);
    expect(screen.getByRole('status')).toHaveTextContent(/^Song 1: hands off into Song 3 on “hub 3”/);
    await user.selectOptions(follow, options[1]);
    const second = Number((follow as HTMLSelectElement).value);
    expect(second).not.toBe(first);
    expect(container.querySelector('[data-map-followed]')).toHaveAttribute('data-map-followed', String(second));
    for (const line of container.querySelectorAll('[data-lit]')) {
      expect(line.getAttribute('data-edge')!.split('>').map(Number)).toContain(second);
    }
    // and back to no song, where nothing is lit
    fireEvent.change(follow, { target: { value: '' } });
    expect(container.querySelectorAll('[data-lit]')).toHaveLength(0);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
