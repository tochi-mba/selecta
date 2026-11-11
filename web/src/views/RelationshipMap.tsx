import { useState } from 'react';
import type { Link } from '../api';

/** SF-0218-03: an optional map of the word connections the server actually returned. A song is a dot
 * only if a returned connection touches it, and a line is drawn only for a returned connection, keyed
 * by the two songs' library IDs in playing order. Nothing is inferred: no line between two songs that
 * merely share an artist, a key or a word nobody returned. The cards stay the full, readable list. */
export type MapNode = { id: number; title: string; x: number; y: number };
export type MapEdge = { key: string; from: number; into: number; phrase: string };

/** CI-0176-02: the map stays readable however dense the library's connections get. It draws at most this
 * many songs, keeping the most connected ones, and only the returned connections between songs it keeps.
 * The list under it is still the full set, and the map says how many it left out. */
export const MAP_CAPACITY = 24;

export function relationshipGraph(links: Link[], size = 320, capacity = MAP_CAPACITY): { nodes: MapNode[]; edges: MapEdge[]; songs: number; connections: number } {
  const titles = new Map<number, string>();
  const edges: MapEdge[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (!Number.isSafeInteger(link.a) || !Number.isSafeInteger(link.b) || link.a === link.b) continue;
    const key = `${link.a}>${link.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!titles.has(link.a)) titles.set(link.a, link.title_a);
    if (!titles.has(link.b)) titles.set(link.b, link.title_b);
    edges.push({ key, from: link.a, into: link.b, phrase: link.phrase });
  }
  const songs = titles.size;
  const connections = edges.length;
  if (titles.size > capacity) {
    const degree = new Map<number, number>();
    for (const edge of edges) for (const id of [edge.from, edge.into]) degree.set(id, (degree.get(id) ?? 0) + 1);
    const order = [...titles.keys()];
    // most connected first; a tie keeps the order the server returned them in
    const kept = new Set([...order].sort((a, b) => (degree.get(b)! - degree.get(a)!) || order.indexOf(a) - order.indexOf(b)).slice(0, capacity));
    for (const id of order) if (!kept.has(id)) titles.delete(id);
    const inside = edges.filter((edge) => kept.has(edge.from) && kept.has(edge.into));
    edges.splice(0, edges.length, ...inside);
  }
  const ids = [...titles.keys()];
  const count = [...titles.values()].reduce<Record<string, number>>((all, title) => ({ ...all, [title]: (all[title] ?? 0) + 1 }), {});
  const middle = size / 2;
  const radius = size / 2 - 40;
  const nodes = ids.map((id, index) => {
    const angle = (2 * Math.PI * index) / Math.max(ids.length, 1) - Math.PI / 2;
    const title = titles.get(id) ?? '';
    return {
      id,
      title: count[title] > 1 ? `${title} (song ${id})` : title,
      x: Math.round(middle + radius * Math.cos(angle)),
      y: Math.round(middle + radius * Math.sin(angle)),
    };
  });
  return { nodes, edges, songs, connections };
}

export function RelationshipMap({ links }: { links: Link[] }) {
  const { nodes, edges, songs, connections } = relationshipGraph(links);
  const [followed, setFollowed] = useState<number | null>(null);
  if (edges.length < 2) return null;
  const at = new Map(nodes.map((node) => [node.id, node]));
  const song = followed !== null ? at.get(followed) : undefined;
  const into = song ? edges.filter((edge) => edge.from === song.id) : [];
  const from = song ? edges.filter((edge) => edge.into === song.id) : [];
  const named = (edge: MapEdge, id: number) => `${at.get(id)!.title} on “${edge.phrase}”`;
  return (
    <details className="relationship-map">
      <summary>See these connections as a map</summary>
      <p className="hint">Only the connections listed below are drawn. The list stays the full, readable version.</p>
      {(songs > nodes.length || connections > edges.length) && (
        <p className="hint" data-map-bounded="">
          The map shows the {nodes.length} most connected of {songs} songs ({edges.length} of {connections} connections). Every connection is still in the list below.
        </p>
      )}
      <label>
        <span>Follow a song on the map</span>
        <select value={followed ?? ''} onChange={(event) => setFollowed(event.target.value === '' ? null : Number(event.target.value))}>
          <option value="">No song</option>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
        </select>
      </label>
      {song && (
        <p className="hint" role="status" data-map-followed={song.id}>
          {song.title}
          {into.length ? `: hands off into ${into.map((edge) => named(edge, edge.into)).join('; ')}` : ''}
          {from.length ? `${into.length ? '. It' : ':'} comes in from ${from.map((edge) => named(edge, edge.from)).join('; ')}` : ''}.
        </p>
      )}
      <svg viewBox="0 0 320 320" role="img" aria-label={`${nodes.length} songs joined by ${edges.length} word connections`} width={320} height={320} style={{ maxWidth: '100%', height: 'auto' }}>
        <g stroke="currentColor" strokeOpacity={song ? 0.2 : 0.45} strokeWidth={1.5}>
          {edges.map((edge) => {
            const a = at.get(edge.from)!;
            const b = at.get(edge.into)!;
            const lit = !!song && (edge.from === song.id || edge.into === song.id);
            return (
              <line key={edge.key} data-edge={edge.key} data-lit={lit ? '' : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeOpacity={lit ? 1 : undefined} strokeWidth={lit ? 2.5 : undefined}>
                <title>{`${a.title} into ${b.title} on “${edge.phrase}”`}</title>
              </line>
            );
          })}
        </g>
        {nodes.map((node) => (
          <g key={node.id} data-song={node.id}>
            <circle cx={node.x} cy={node.y} r={node.id === song?.id ? 7 : 5} fill="currentColor" />
            <text x={node.x} y={node.y - 9} textAnchor="middle" fontSize={10} fill="currentColor">{node.title}</text>
          </g>
        ))}
      </svg>
    </details>
  );
}
