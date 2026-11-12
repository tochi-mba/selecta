import { useEffect, useState } from 'react';

/** Whether a CSS media query matches right now, kept up to date as the window changes. For the few
 * places where what's on the page, not only how it looks, follows the layout. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const changed = () => setMatches(media.matches);
    changed();
    media.addEventListener?.('change', changed);
    return () => media.removeEventListener?.('change', changed);
  }, [query]);
  return matches;
}
