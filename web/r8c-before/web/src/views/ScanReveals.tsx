import { useEffect, useRef, useState } from 'react';
import { get, type Link, type LinkList } from '../api';
import { flagOn } from '../flags';

/** CI-0178-04: while the first songs are being prepared, name the newest musical possibilities the
 * library has really found: word connections the server returned from the lyrics it has read. Nothing
 * is invented or guessed. Before the server has returned one, when it returns none, or when it can't
 * be asked, this shows nothing at all, so a reveal is always a real pair of songs with a real shared
 * phrase. It asks again only when the ready or lyric counts the server reports change. */

const SHOWN = 3;
const keyOf = (link: Link) => `${link.a}>${link.b}:${link.phrase}`;

export function ScanReveals({ ready, lyrics }: { ready: number; lyrics: number | undefined }) {
  const [found, setFound] = useState<Link[]>([]);
  const seen = useRef(new Set<string>());
  const on = flagOn('discover.scan_reveals') && flagOn('discover.word_links');

  useEffect(() => {
    if (!on) return;
    let live = true;
    get<LinkList>(`/links?limit=12`)
      .then((data) => {
        if (!live || !Array.isArray(data?.links)) return;
        const real = data.links.filter((link) => Number.isSafeInteger(link.a) && Number.isSafeInteger(link.b)
          && link.a !== link.b && !!link.phrase && !!link.title_a && !!link.title_b);
        const fresh = real.filter((link) => !seen.current.has(keyOf(link)));
        for (const link of fresh) seen.current.add(keyOf(link));
        // the newest first, then whatever was already showing, never more than a few
        if (fresh.length) setFound((before) => [...fresh, ...before].slice(0, SHOWN));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [on, ready, lyrics]);

  if (!on || !found.length) return null;
  return (
    <section className="scan-reveals" aria-labelledby="scan-reveals-title" data-scan-reveals="">
      <h2 id="scan-reveals-title" className="eyebrow">Found in your library so far</h2>
      <ul className="hint" aria-live="polite">
        {found.map((link) => (
          <li key={keyOf(link)} data-link={keyOf(link)}>
            <span dir="auto">{link.title_a}</span> can hand off into <span dir="auto">{link.title_b}</span> on “<span dir="auto">{link.phrase}</span>”.
          </li>
        ))}
      </ul>
      <p className="hint">These come from the lyrics read so far. Nothing has been added to a mix.</p>
    </section>
  );
}
