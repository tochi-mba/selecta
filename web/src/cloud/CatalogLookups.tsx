import { useEffect, useState } from 'react';
import { useFlag } from '../flags';
import { Skeleton } from '../ui/controls';
import { Notice, SettingsCard } from './AccountLayout';

// Web lookups for covers and song details (ADR-0478, FL-0478-04, flag `library.art_lookup`). The
// person decides whether SelectaDJ may look a song up on the web; the card says plainly what leaves.
// The switch only ever shows what the server last said, so it never claims a choice that was not
// saved.

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type Settings = { lookups: boolean };

/** The words beside the switch: exactly what a lookup sends (ADR-0478 "What leaves"). */
export const LOOKUP_DISCLOSURE = 'Only the artist, title, album and length of a song are sent.';

export function CatalogLookups({ request }: { request: Request }) {
  const shown = useFlag('library.art_lookup');
  const [lookups, setLookups] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!shown) return undefined;
    let live = true;
    request<Settings>('/catalog/settings').then(
      (found) => { if (live) setLookups(found.lookups === true); },
      () => { if (live) setProblem('Your choice could not be read just now. Try again in a moment.'); },
    );
    return () => { live = false; };
  }, [request, shown]);

  if (!shown) return null;

  const change = async (next: boolean) => {
    setSaving(true);
    setProblem('');
    try {
      const saved = await request<Settings>('/catalog/settings', { method: 'PUT', body: JSON.stringify({ lookups: next }) });
      setLookups(saved.lookups === true);
    } catch {
      setProblem('Your choice was not saved. Nothing has changed. Try again in a moment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard id="cloud-catalog-lookups" title="Covers and song details" about="Where a song has no picture of its own, SelectaDJ can look for its cover and details on the web." busy={saving}>
      {lookups === null && !problem
        ? <Skeleton lines={1} label="Reading your choice" />
        : lookups !== null && (
          <label className="choice">
            <input type="checkbox" role="switch" checked={lookups} disabled={saving} aria-busy={saving || undefined} onChange={(event) => void change(event.target.checked)} aria-describedby="cloud-catalog-lookups-what" />
            Look up covers and song details on the web
          </label>
        )}
      <p className="acct-card-about" id="cloud-catalog-lookups-what">{LOOKUP_DISCLOSURE}</p>
      {problem && <Notice tone="danger" role="alert">{problem}</Notice>}
    </SettingsCard>
  );
}
