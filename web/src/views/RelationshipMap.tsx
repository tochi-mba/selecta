import type { Link } from '../api';

/** SF-0218-03: an optional map of the word connections the server actually returned. A song is a dot
 * only if a returned connection touches it, and a line is drawn only for a returned connection, keyed
 * by the two songs' library IDs in playing order. Nothing is inferred: no line between two songs that
 * merely share an artist, a key or a word nobody returned. The cards stay the full, readable list. */
export type MapNode = { id: number; title: string; x: number; y: number };
export type MapEdge = { key: string; from: number; into: number; phrase: string };

export function relationshipGraph(links: Link[], size = 320): { nodes: MapNode[]; edges: MapEdge[] } {
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
  return { nodes, edges };
}

export function RelationshipMap({ links }: { links: Link[] }) {
  const { nodes, edges } = relationshipGraph(links);
  if (edges.length < 2) return null;
  const at = new Map(nodes.map((node) => [node.id, node]));
  return (
    <details className="relationship-map">
      <summary>See these connections as a map</summary>
      <p className="hint">Only the connections listed below are drawn. The list stays the full, readable version.</p>
      <svg viewBox="0 0 320 320" role="img" aria-label={`${nodes.length} songs joined by ${edges.length} word connections`} width={320} height={320} style={{ maxWidth: '100%', height: 'auto' }}>
        <g stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.5}>
          {edges.map((edge) => {
            const from = at.get(edge.from)!;
            const into = at.get(edge.into)!;
            return (
              <line key={edge.key} data-edge={edge.key} x1={from.x} y1={from.y} x2={into.x} y2={into.y}>
                <title>{`${from.title} into ${into.title} on “${edge.phrase}”`}</title>
              </line>
            );
          })}
        </g>
        {nodes.map((node) => (
          <g key={node.id} data-song={node.id}>
            <circle cx={node.x} cy={node.y} r={5} fill="currentColor" />
            <text x={node.x} y={node.y - 9} textAnchor="middle" fontSize={10} fill="currentColor">{node.title}</text>
          </g>
        ))}
      </svg>
    </details>
  );
}
