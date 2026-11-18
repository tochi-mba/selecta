import { Icon } from '../../ui/Icon';
import { FallbackContext, fallbacksFor } from './fallback';

/** What a device that cannot be the venue player gets instead (ADR-0460, BF-0460-07): the recorded
 * reason, then the places it can still be useful. Never a dead end: when none of the places is
 * on for this account, it still says how to find a device that can play. */
export function VenueFallback({ reason, places, deepLinked }: { reason: string; places: FallbackContext; deepLinked: boolean }) {
  const options = fallbacksFor(places);
  return (
    <section className="cloud-spine-fork venue-fallback" aria-label="This device can be a controller" data-venue-fallback="">
      <h3><Icon name="warning" size="toolbar" /> This device can’t be the venue player</h3>
      {deepLinked && <p>The link you followed opens the venue player set-up, which needs a device that can play. Here is what this one can do instead.</p>}
      <p data-venue-reason="">{reason}</p>
      {options.length > 0 && (
        <ul className="venue-fallback-places">
          {options.map((place) => (
            <li key={place.id} data-fallback={place.id}>
              <a href={place.href}>{place.label}</a>
              <small> {place.about}</small>
            </li>
          ))}
        </ul>
      )}
      <p>To play the venue, open SelectaDJ on a tablet or computer whose browser passes this check. Opening it in the browser itself, rather than inside another app, often helps.</p>
    </section>
  );
}
