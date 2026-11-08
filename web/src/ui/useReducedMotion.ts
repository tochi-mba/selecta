import { useEffect, useState } from 'react';
import { usePrefs } from '../state/prefs';

export function useReducedMotion() {
  const { motion } = usePrefs();
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const changed = () => setReduced(media.matches);
    changed();
    media.addEventListener?.('change', changed);
    return () => media.removeEventListener?.('change', changed);
  }, []);
  return reduced || motion === 'still';
}
