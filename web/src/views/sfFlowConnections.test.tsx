import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Link } from '../api';
import { relationshipGraph, RelationshipMap } from './RelationshipMap';

const link = (a: number, b: number, phrase: string, titles: [string, string] = [`Song ${a}`, `Song ${b}`]): Link => ({
  phrase, kind: 'word', a, b, artist_a: 'A', title_a: titles[0], artist_b: 'B', title_b: titles[1], line_a: '', line_b: '',
  moves: [], move: 'word_blend', state: { status: 'none', key: `${a}-${b}`, passed: true }, worked: true,
} as unknown as Link);

// SF-0218-03: the optional map draws only returned connections, keyed by stable library IDs.
describe('SF-0218-03 sparse relationship map', () => {
  it('has a dot only for songs a returned connection touches, and a line only per returned pair', () => {
    const { nodes, edges } = relationshipGraph([link(3, 9, 'night'), link(9, 14, 'love'), link(3, 9, 'night again'), link(5, 5, 'self')]);
    expect(nodes.map((node) => node.id)).toEqual([3, 9, 14]);
    expect(edges.map((edge) => edge.key)).toEqual(['3>9', '9>14']);
    // no inferred line, such as 3 to 14 or 14 back to 9
    expect(edges.some((edge) => edge.key === '3>14' || edge.key === '14>9')).toBe(false);
  });

  it('keeps playing order: a link from 9 into 3 is a different pair from 3 into 9', () => {
    const { edges } = relationshipGraph([link(3, 9, 'night'), link(9, 3, 'day')]);
    expect(edges.map((edge) => edge.key)).toEqual(['3>9', '9>3']);
  });

  it('tells two songs with the same title apart by their IDs', () => {
    const { nodes } = relationshipGraph([link(1, 2, 'home', ['Echo', 'Echo']), link(2, 7, 'away', ['Echo', 'Far'])]);
    expect(nodes.map((node) => node.title)).toEqual(['Echo (song 1)', 'Echo (song 2)', 'Far']);
  });

  it('is optional and closed by default, and draws exactly the returned edges once opened', () => {
    const { container } = render(<RelationshipMap links={[link(3, 9, 'night'), link(9, 14, 'love')]} />);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText('See these connections as a map'));
    expect(screen.getByRole('img', { name: '3 songs joined by 2 word connections' })).toBeInTheDocument();
    expect([...container.querySelectorAll('[data-edge]')].map((line) => line.getAttribute('data-edge'))).toEqual(['3>9', '9>14']);
    expect([...container.querySelectorAll('[data-song]')].map((dot) => dot.getAttribute('data-song'))).toEqual(['3', '9', '14']);
  });

  it('shows nothing for a graph too sparse to be worth a map', () => {
    const { container } = render(<RelationshipMap links={[link(3, 9, 'night')]} />);
    expect(container.innerHTML).toBe('');
    expect(render(<RelationshipMap links={[]} />).container.innerHTML).toBe('');
  });
});
